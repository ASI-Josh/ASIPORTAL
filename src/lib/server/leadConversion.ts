/**
 * Closed-deal automation for CRM pipeline leads.
 *
 * When a lead reaches its stream's closed-won stage (sales → "won",
 * supply_chain → "onboarded"), this module:
 *   1. Identifies whether the lead is a new customer/supplier or an
 *      existing organisation (by explicit link, name, or email domain).
 *   2. If new — creates the organisation in the Contacts module and the
 *      human point of contact inside it. If existing — reuses the org
 *      and only adds the contact person when they aren't already there.
 *   3. Creates a pending booking in the scheduling chain so the deal
 *      flows into bookings → job → works register once confirmed.
 *
 * All Firestore payloads are stripped of undefined values before write:
 * the Admin SDK rejects any document containing undefined ("Cannot use
 * 'undefined' as a Firestore value"), which previously made stage
 * progression fail whenever optional lead fields (phone, website, job
 * title) were empty.
 */

import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";
import type { BookingType, Lead, PipelineStage, StreamType } from "@/lib/types";

type Db = FirebaseFirestore.Firestore;

// ─── Small helpers ────────────────────────────────────────────────────────────

export function normaliseOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normaliseEmail(value: unknown): string | null {
  const normalised = normaliseOptionalString(value);
  return normalised ? normalised.toLowerCase() : null;
}

function normaliseDomain(value: string | null): string | null {
  if (!value || !value.includes("@")) return null;
  return value.split("@").pop()?.toLowerCase() ?? null;
}

function splitName(fullName: string | null) {
  if (!fullName) return { firstName: "", lastName: "" };
  const parts = fullName.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80) || "record";
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as T;
}

function buildAddress(lead: Lead) {
  const source = lead as unknown as Record<string, unknown>;
  const street =
    normaliseOptionalString(source.address) ??
    normaliseOptionalString(source.streetAddress) ?? "";
  const suburb = normaliseOptionalString(source.suburb) ?? "";
  const state = normaliseOptionalString(source.state) ?? "";
  const postcode = normaliseOptionalString(source.postcode) ?? "";
  const country = normaliseOptionalString(source.country) ?? "Australia";
  return { street, suburb, state, postcode, country };
}

// ─── Stage gate ───────────────────────────────────────────────────────────────

/** True when `stage` is the closed-won terminal stage for the lead's stream. */
export function isClosedDealStage(
  streamType: StreamType | undefined,
  stage: PipelineStage | string
): boolean {
  const stream = streamType || "sales";
  if (stream === "sales") return stage === "won";
  if (stream === "supply_chain") return stage === "onboarded";
  // trade_distribution onboarding runs through the trade application
  // approval flow, which already creates the organisation.
  return false;
}

// ─── Booking helpers ──────────────────────────────────────────────────────────

async function nextBookingNumber(db: Db): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `BK-${year}-`;
  const snap = await db
    .collection(COLLECTIONS.BOOKINGS)
    .where("bookingNumber", ">=", prefix)
    .where("bookingNumber", "<", `BK-${year + 1}-`)
    .orderBy("bookingNumber", "desc")
    .limit(1)
    .get();
  if (snap.empty) return `${prefix}0001`;
  const last = parseInt(String(snap.docs[0].data().bookingNumber || "").split("-")[2] || "", 10);
  const next = (Number.isFinite(last) ? last + 1 : 1).toString().padStart(4, "0");
  return `${prefix}${next}`;
}

/** Best-effort service type from the lead's estimated services / notes. */
function inferBookingType(lead: Lead): BookingType {
  const haystack = [...(lead.estimatedServices || []), lead.notes || ""]
    .join(" ")
    .toLowerCase();
  if (haystack.includes("windscreen") || haystack.includes("chip")) return "windscreen_crack_chip_repair";
  if (haystack.includes("graffiti") || haystack.includes("scratch")) return "scratch_graffiti_removal";
  if (haystack.includes("film")) return "film_installation";
  if (haystack.includes("interior")) return "trim_restoration_interior";
  if (haystack.includes("trim")) return "trim_restoration_exterior";
  if (haystack.includes("lens") || haystack.includes("polymer")) return "polymer_lens_restoration";
  if (haystack.includes("glass")) return "glass_replacement";
  return "windscreen_crack_chip_repair";
}

function defaultScheduledDate(lead: Lead): Date {
  const candidate = normaliseOptionalString(lead.nextActionDate);
  if (candidate) {
    const parsed = new Date(`${candidate}T09:00:00`);
    if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > Date.now()) {
      return parsed;
    }
  }
  const fallback = new Date();
  fallback.setDate(fallback.getDate() + 7);
  fallback.setHours(9, 0, 0, 0);
  return fallback;
}

// ─── Main automation ──────────────────────────────────────────────────────────

export interface ClosedLeadAutomationResult {
  organizationId: string;
  contactId: string | null;
  isNewCustomer: boolean;
  bookingId: string | null;
  bookingNumber: string | null;
}

export async function runClosedLeadAutomation(
  db: Db,
  leadId: string,
  lead: Lead,
  changedBy: string
): Promise<ClosedLeadAutomationResult> {
  const streamType: StreamType = lead.streamType || "sales";
  const organisationName = normaliseOptionalString(lead.companyName);
  if (!organisationName) {
    throw new Error(`Closed lead ${leadId} cannot sync to Contacts: missing organisation name.`);
  }

  const primaryContact = lead.contacts?.find((c) => c.isPrimary) ?? lead.contacts?.[0] ?? null;
  const contactName = primaryContact ? normaliseOptionalString(primaryContact.name) : null;
  const email = primaryContact ? normaliseEmail(primaryContact.email) : null;
  const phone = primaryContact ? normaliseOptionalString(primaryContact.phone) : null;
  const domain = normaliseDomain(email);

  const organisationsRef = db.collection(COLLECTIONS.CONTACT_ORGANIZATIONS);
  const contactsRef = db.collection(COLLECTIONS.ORGANIZATION_CONTACTS);
  const timestampNow = admin.firestore.Timestamp.now();

  // ── 1. Identify: new customer or existing? ─────────────────────────────────
  let organisationSnap: FirebaseFirestore.DocumentSnapshot | null = null;

  const explicitOrgId = normaliseOptionalString(lead.existingOrganizationId);
  if (explicitOrgId) {
    const explicit = await organisationsRef.doc(explicitOrgId).get();
    if (explicit.exists) organisationSnap = explicit;
  }
  if (!organisationSnap) {
    organisationSnap =
      (await organisationsRef.where("name", "==", organisationName).limit(1).get()).docs[0] ?? null;
  }
  if (!organisationSnap && domain) {
    organisationSnap =
      (await organisationsRef.where("domains", "array-contains", domain).limit(1).get()).docs[0] ?? null;
  }

  const isNewCustomer = !organisationSnap;
  const address = buildAddress(lead);
  let organisationId: string;
  let organisationData: Record<string, unknown> = {};

  // ── 2. Create the organisation if it's a new customer/supplier ────────────
  if (organisationSnap) {
    organisationId = organisationSnap.id;
    organisationData = (organisationSnap.data() as Record<string, unknown>) || {};
  } else {
    const isSupplier = streamType === "supply_chain";
    const organisationPayload = stripUndefined({
      name: organisationName,
      category: isSupplier ? "supplier_vendor" : "trade_client",
      type: isSupplier ? "supplier" : "customer",
      status: "active",
      abn: normaliseOptionalString((lead as unknown as Record<string, unknown>).abn) ?? "",
      domains: domain ? [domain] : [],
      ...(isSupplier ? {} : { portalRole: "client" }),
      address,
      sites: [{
        id: `${slugify(organisationName)}-primary`,
        name: address.suburb || organisationName,
        address,
        isDefault: true,
      }],
      phone: phone ?? "",
      email: email ?? "",
      website: normaliseOptionalString(lead.companyWebsite) ?? undefined,
      createdAt: timestampNow,
      updatedAt: timestampNow,
      sourceLeadId: leadId,
    });
    const newOrgRef = organisationsRef.doc();
    organisationId = newOrgRef.id;
    organisationData = organisationPayload;
    await newOrgRef.set(organisationPayload);
  }

  // ── 3. Ensure the human point of contact exists in that organisation ──────
  let contactId: string | null = null;
  if (contactName || email) {
    let contactSnap = email
      ? (await contactsRef.where("email", "==", email).limit(1).get()).docs[0] ?? null
      : null;

    if (!contactSnap && contactName) {
      const { firstName, lastName } = splitName(contactName);
      const byName = await contactsRef
        .where("organizationId", "==", organisationId)
        .where("firstName", "==", firstName)
        .where("lastName", "==", lastName)
        .limit(1)
        .get();
      contactSnap = byName.docs[0] ?? null;
    }

    if (contactSnap) {
      contactId = contactSnap.id;
    } else {
      const { firstName, lastName } = splitName(contactName);
      const contactPayload = stripUndefined({
        organizationId: organisationId,
        firstName,
        lastName,
        email: email ?? "",
        phone: phone ?? undefined,
        mobile: phone ?? undefined,
        role: "primary",
        jobTitle:
          normaliseOptionalString(primaryContact?.title) ??
          normaliseOptionalString((lead as unknown as Record<string, unknown>).position) ??
          undefined,
        status: "active",
        isPrimary: true,
        hasPortalAccess: false,
        createdAt: timestampNow,
        updatedAt: timestampNow,
        sourceLeadId: leadId,
      });
      const newContactRef = contactsRef.doc();
      contactId = newContactRef.id;
      await newContactRef.set(contactPayload);
    }
  }

  // ── 4. Create the deal as a pending booking in the scheduling chain ───────
  let bookingId: string | null = null;
  let bookingNumber: string | null = null;

  const existingBooking = await db
    .collection(COLLECTIONS.BOOKINGS)
    .where("sourceLeadId", "==", leadId)
    .limit(1)
    .get();

  if (!existingBooking.empty) {
    bookingId = existingBooking.docs[0].id;
    bookingNumber = String(existingBooking.docs[0].data().bookingNumber || "") || null;
  } else {
    bookingNumber = await nextBookingNumber(db);
    const scheduledAt = defaultScheduledDate(lead);
    const orgAddress = (organisationData.address as typeof address | undefined) ?? address;
    const orgSites = organisationData.sites as
      | { id?: string; name?: string; address?: typeof address; isDefault?: boolean }[]
      | undefined;
    const defaultSite = orgSites?.find((s) => s.isDefault) ?? orgSites?.[0];

    const streamLabel = streamType === "supply_chain" ? "supply chain" : "sales";
    const bookingPayload = stripUndefined({
      bookingNumber,
      bookingType: inferBookingType(lead),
      resourceDurationTemplate: "na",
      organizationId: organisationId,
      organizationName: organisationName,
      contactId: contactId ?? "",
      contactName: contactName ?? "",
      contactEmail: email ?? String(organisationData.email || ""),
      contactPhone: phone ?? undefined,
      siteLocation: {
        ...(defaultSite?.id ? { id: defaultSite.id } : {}),
        name: defaultSite?.name || organisationName,
        address: defaultSite?.address || orgAddress,
      },
      scheduledDate: admin.firestore.Timestamp.fromDate(scheduledAt),
      scheduledTime: "09:00",
      allocatedStaff: [],
      allocatedStaffIds: [],
      notes: [
        `Auto-created from closed ${streamLabel} deal ${lead.leadNumber || leadId} (${organisationName}).`,
        `Confirm service type, date/time and staff allocation before converting to a job.`,
        lead.estimatedValue ? `Estimated deal value: $${lead.estimatedValue}.` : null,
      ].filter(Boolean).join(" "),
      status: "pending",
      sourceLeadId: leadId,
      createdAt: timestampNow,
      createdBy: changedBy,
      updatedAt: timestampNow,
    });

    const bookingRef = db.collection(COLLECTIONS.BOOKINGS).doc();
    bookingId = bookingRef.id;
    await bookingRef.set(bookingPayload);
  }

  // ── 5. Record the outcome on the lead ──────────────────────────────────────
  await db.collection(COLLECTIONS.LEADS).doc(leadId).set({
    existingOrganizationId: organisationId,
    contactSync: {
      status: "synced",
      organizationId: organisationId,
      contactId: contactId ?? null,
      isNewCustomer,
      syncedAt: admin.firestore.FieldValue.serverTimestamp(),
      error: null,
    },
    bookingSync: {
      status: "created",
      bookingId,
      bookingNumber,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  }, { merge: true });

  return { organizationId: organisationId, contactId, isNewCustomer, bookingId, bookingNumber };
}
