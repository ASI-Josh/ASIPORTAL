import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase/firestore";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";
import type { ContactOrganization, Lead, OrganizationContact, PipelineStage, StageChange } from "@/lib/types";

function normaliseOptionalString(value: unknown): string | null {
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

function buildAddress(lead: Lead) {
  const street = normaliseOptionalString((lead as any).address) ?? normaliseOptionalString((lead as any).streetAddress) ?? "";
  const suburb = normaliseOptionalString((lead as any).suburb) ?? "";
  const state = normaliseOptionalString((lead as any).state) ?? "";
  const postcode = normaliseOptionalString((lead as any).postcode) ?? "";
  const country = normaliseOptionalString((lead as any).country) ?? "Australia";
  return { street, suburb, state, postcode, country };
}

async function syncWonLeadToContacts(db: FirebaseFirestore.Firestore, leadId: string, lead: Lead) {
  // If the lead is already flagged as an existing client, skip the sync.
  if (lead.isExistingClient) {
    await db.collection(COLLECTIONS.LEADS).doc(leadId).set({
      contactSync: { status: "skipped", reason: "existing_client", syncedAt: admin.firestore.FieldValue.serverTimestamp() },
    }, { merge: true });
    return null;
  }

  const organisationName = normaliseOptionalString(lead.companyName);

  // Resolve contact details from the contacts array (primary first, then first entry).
  const primaryContact = lead.contacts?.find((c) => c.isPrimary) ?? lead.contacts?.[0] ?? null;
  const contactName = primaryContact ? normaliseOptionalString(primaryContact.name) : null;
  const email = primaryContact ? normaliseEmail(primaryContact.email) : null;
  const phone = primaryContact ? normaliseOptionalString(primaryContact.phone) : null;

  if (!organisationName) {
    throw new Error(`Won lead ${leadId} cannot sync to Contacts: missing organisation name.`);
  }

  const domain = normaliseDomain(email);
  const organisationsRef = db.collection(COLLECTIONS.CONTACT_ORGANIZATIONS);
  const contactsRef = db.collection(COLLECTIONS.ORGANIZATION_CONTACTS);
  const timestampNow = Timestamp.now();
  const serverNow = admin.firestore.FieldValue.serverTimestamp();

  let organisationSnap = (await organisationsRef.where("name", "==", organisationName).limit(1).get()).docs[0] ?? null;
  if (!organisationSnap && domain) {
    organisationSnap = (await organisationsRef.where("domains", "array-contains", domain).limit(1).get()).docs[0] ?? null;
  }

  const address = buildAddress(lead);
  let organisationId = organisationSnap?.id;
  const organisationPayload = {
    name: organisationName,
    category: "trade_client",
    type: "customer",
    status: "active",
    abn: normaliseOptionalString((lead as any).abn) ?? "",
    domains: domain ? [domain] : [],
    portalRole: "client",
    address,
    sites: [{ id: `${slugify(organisationName)}-primary`, name: address.suburb || organisationName, address, isDefault: true }],
    phone: phone ?? "",
    email: email ?? "",
    updatedAt: timestampNow,
    sourceLeadId: leadId,
  } satisfies Partial<ContactOrganization> & { sourceLeadId: string };

  if (!organisationId) {
    const newOrgRef = organisationsRef.doc();
    organisationId = newOrgRef.id;
    await newOrgRef.set({ ...organisationPayload, createdAt: timestampNow });
  } else {
    await organisationsRef.doc(organisationId).set(organisationPayload, { merge: true });
  }

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

  const { firstName, lastName } = splitName(contactName);
  const contactPayload = {
    organizationId: organisationId,
    firstName,
    lastName,
    email: email ?? "",
    phone: phone ?? undefined,
    mobile: phone ?? undefined,
    role: "primary",
    jobTitle: normaliseOptionalString((lead as any).position ?? (lead as any).jobTitle) ?? undefined,
    status: "active",
    isPrimary: true,
    hasPortalAccess: false,
    updatedAt: timestampNow,
    sourceLeadId: leadId,
  } satisfies Partial<OrganizationContact> & { sourceLeadId: string };

  let contactId = contactSnap?.id;
  if (!contactId) {
    const newContactRef = contactsRef.doc();
    contactId = newContactRef.id;
    await newContactRef.set({ ...contactPayload, createdAt: timestampNow });
  } else {
    await contactsRef.doc(contactId).set(contactPayload, { merge: true });
  }

  await db.collection(COLLECTIONS.LEADS).doc(leadId).set({
    contactSync: {
      status: "synced",
      organizationId: organisationId,
      contactId,
      syncedAt: serverNow,
      error: null,
    },
  }, { merge: true });

  return { organizationId: organisationId, contactId };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireUserId(req);
    const { id } = await params;
    const { stage, reason } = (await req.json()) as { stage: PipelineStage; reason?: string | null };

    const db = admin.firestore();
    const ref = db.collection(COLLECTIONS.LEADS).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const lead = snap.data() as Lead;
    const now = new Date().toISOString();
    const normalisedReason = normaliseOptionalString(reason);

    const change: StageChange = {
      fromStage: lead.stage,
      toStage: stage,
      changedAt: now,
      changedBy: userId,
      ...(normalisedReason ? { reason: normalisedReason } : {}),
    };

    await ref.set({
      stage,
      stageEnteredAt: now,
      stageHistory: admin.firestore.FieldValue.arrayUnion(change),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastStageChangeReason: normalisedReason,
      ...(stage === "won" ? { contactSync: { status: "pending", error: null } } : {}),
    }, { merge: true });

    let syncResult: { organizationId: string; contactId: string } | null = null;
    if (stage === "won") {
      try {
        syncResult = await syncWonLeadToContacts(db, id, { ...lead, stage } as Lead);
      } catch (syncError) {
        const message = syncError instanceof Error ? syncError.message : "Failed to sync won lead to Contacts.";
        await ref.set({
          contactSync: {
            status: "failed",
            error: message,
            failedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        }, { merge: true });
        throw syncError;
      }
    }

    return NextResponse.json({ ok: true, stage, contactSync: syncResult });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 400 });
  }
}
