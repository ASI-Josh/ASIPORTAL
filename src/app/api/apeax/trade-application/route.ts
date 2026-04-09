/**
 * POST /api/apeax/trade-application
 * Public endpoint — trade installer account application from apeax.com.au.
 * Creates a Leads Register entry with source "apeax_portal_trade_app" for
 * SHIELD to vet.
 *
 * Accepts BOTH shapes:
 *   1. CIPHER's apeax.com.au Netlify function shape — nested primaryContact,
 *      accountsContact, workshop, experience, attestations
 *   2. Portal-internal flat shape — businessName, contactEmail, contactPhone,
 *      sectorDeclaration, exclusivityDisclosureAgreed
 *
 * Both are normalised into the same Leads Register entry.
 *
 * No auth. Netlify Functions rate-limits upstream.
 */

import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface CipherPayload {
  legalName?: string;
  tradingAs?: string;
  abn?: string;
  yearsTrading?: number | string;
  website?: string;
  primaryContact?: {
    fullName?: string;
    position?: string;
    email?: string;
    phone?: string;
  };
  accountsContact?: {
    email?: string | null;
    phone?: string | null;
  };
  workshop?: {
    address?: string;
    suburb?: string;
    state?: string;
    postcode?: string;
    bays?: number | string;
  };
  experience?: {
    currentBrands?: string | null;
    sectorFocus?: string;
    narrative?: string;
  };
  attestations?: {
    exclusivity?: boolean;
    competency?: boolean;
    warrantyRegistration?: boolean;
    pricingConfidentiality?: boolean;
    brandRepresentation?: boolean;
    attestedAt?: string;
  };
  submittedAt?: string;
  userAgent?: string;
  sourceIp?: string;
}

interface FlatPayload {
  businessName?: string;
  abn?: string;
  businessType?: string;
  yearsInBusiness?: number;
  numberOfInstallers?: number;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  contactRole?: string;
  address?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  sectorDeclaration?: string;
  exclusivityDisclosureText?: string;
  exclusivityDisclosureAgreed?: boolean;
  currentFilmBrandsCarried?: string[];
  tradeCredentials?: string;
  website?: string;
  referencedBy?: string;
}

type Payload = CipherPayload & FlatPayload;

interface NormalisedApplication {
  businessName: string;
  tradingAs: string | null;
  abn: string;
  contactName: string;
  contactRole: string | null;
  contactEmail: string;
  contactPhone: string;
  accountsEmail: string | null;
  accountsPhone: string | null;
  address: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  bays: number | null;
  yearsTrading: number | null;
  website: string | null;
  sectorFocus: string;
  currentBrands: string | null;
  experience: string;
  exclusivityAcknowledged: boolean;
  allAttestationsConfirmed: boolean;
}

function normalise(body: unknown): NormalisedApplication {
  if (!body || typeof body !== "object") throw new Error("Invalid request body.");
  const p = body as Payload;

  // Detect shape: CIPHER has `primaryContact` object, flat has `contactEmail`
  const isCipherShape = !!p.primaryContact;

  let normalised: NormalisedApplication;

  if (isCipherShape) {
    const pc = p.primaryContact || {};
    const ac = p.accountsContact || {};
    const ws = p.workshop || {};
    const exp = p.experience || {};
    const att = p.attestations || {};

    if (!p.legalName) throw new Error("Missing required field: legalName");
    if (!p.abn) throw new Error("Missing required field: abn");
    if (!pc.fullName) throw new Error("Missing required field: primaryContact.fullName");
    if (!pc.email) throw new Error("Missing required field: primaryContact.email");
    if (!pc.phone) throw new Error("Missing required field: primaryContact.phone");
    if (!ws.address) throw new Error("Missing required field: workshop.address");
    if (!exp.sectorFocus) throw new Error("Missing required field: experience.sectorFocus");
    if (!exp.narrative) throw new Error("Missing required field: experience.narrative");

    const allAttConfirmed = att.exclusivity === true
      && att.competency === true
      && att.warrantyRegistration === true
      && att.pricingConfidentiality === true
      && att.brandRepresentation === true;

    if (!allAttConfirmed) {
      throw new Error("All 5 attestations must be confirmed.");
    }

    normalised = {
      businessName: String(p.legalName).trim(),
      tradingAs: p.tradingAs ? String(p.tradingAs).trim() : null,
      abn: String(p.abn).replace(/\s+/g, ""),
      contactName: String(pc.fullName).trim(),
      contactRole: pc.position ? String(pc.position).trim() : null,
      contactEmail: String(pc.email).trim().toLowerCase(),
      contactPhone: String(pc.phone).trim(),
      accountsEmail: ac.email ? String(ac.email).trim().toLowerCase() : null,
      accountsPhone: ac.phone ? String(ac.phone).trim() : null,
      address: String(ws.address).trim(),
      suburb: ws.suburb ? String(ws.suburb).trim() : null,
      state: ws.state ? String(ws.state).toUpperCase() : null,
      postcode: ws.postcode ? String(ws.postcode).trim() : null,
      bays: ws.bays != null ? Number(ws.bays) : null,
      yearsTrading: p.yearsTrading != null ? Number(p.yearsTrading) : null,
      website: p.website ? String(p.website).trim() : null,
      sectorFocus: String(exp.sectorFocus),
      currentBrands: exp.currentBrands ? String(exp.currentBrands).trim() : null,
      experience: String(exp.narrative).trim(),
      exclusivityAcknowledged: true,
      allAttestationsConfirmed: true,
    };
  } else {
    // Flat shape
    if (!p.businessName) throw new Error("Missing required field: businessName");
    if (!p.abn) throw new Error("Missing required field: abn");
    if (!p.contactName) throw new Error("Missing required field: contactName");
    if (!p.contactEmail) throw new Error("Missing required field: contactEmail");
    if (!p.contactPhone) throw new Error("Missing required field: contactPhone");
    if (!p.sectorDeclaration) throw new Error("Missing required field: sectorDeclaration");
    if (p.exclusivityDisclosureAgreed !== true) {
      throw new Error("Exclusivity disclosure must be acknowledged.");
    }

    normalised = {
      businessName: String(p.businessName).trim(),
      tradingAs: null,
      abn: String(p.abn).replace(/\s+/g, ""),
      contactName: String(p.contactName).trim(),
      contactRole: p.contactRole || null,
      contactEmail: String(p.contactEmail).trim().toLowerCase(),
      contactPhone: String(p.contactPhone).trim(),
      accountsEmail: null,
      accountsPhone: null,
      address: p.address || null,
      suburb: p.suburb || null,
      state: p.state ? String(p.state).toUpperCase() : null,
      postcode: p.postcode || null,
      bays: null,
      yearsTrading: p.yearsInBusiness || null,
      website: p.website || null,
      sectorFocus: p.sectorDeclaration,
      currentBrands: Array.isArray(p.currentFilmBrandsCarried)
        ? p.currentFilmBrandsCarried.join(", ")
        : null,
      experience: p.tradeCredentials || "",
      exclusivityAcknowledged: true,
      allAttestationsConfirmed: true,
    };
  }

  return normalised;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const app = normalise(body);

    const db = admin.firestore();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const nowIso = new Date().toISOString();
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";

    // Check for vetting lockout (rejected in last 12 months)
    const lockoutSnap = await db.collection(COLLECTIONS.LEADS_REGISTER)
      .where("contact.email", "==", app.contactEmail)
      .where("source.type", "==", "apeax_portal_trade_app")
      .where("status", "==", "rejected")
      .limit(5)
      .get();
    for (const d of lockoutSnap.docs) {
      const data = d.data();
      if (typeof data.vettingLockoutUntil === "string" && data.vettingLockoutUntil > nowIso) {
        // CIPHER's trade-application.js reads `result.lockedOut` and `result.lockoutExpiresAt`
        return NextResponse.json({
          lockedOut: true,
          lockoutExpiresAt: data.vettingLockoutUntil,
          error: "Your application cannot be submitted at this time. Please contact SHIELD directly if circumstances have changed.",
          message: "Your application cannot be submitted at this time. Please contact SHIELD directly if circumstances have changed.",
        }, { status: 200 }); // Return 200 so CIPHER's function can read the body
      }
    }

    const locationStr = [app.suburb, app.state, app.postcode].filter(Boolean).join(" ")
      || app.address
      || null;

    const entry = {
      streamType: "sales",
      status: "identified",
      source: {
        type: "apeax_portal_trade_app",
        scanDate: null,
        scanId: null,
        findingId: null,
        notes: `Trade installer application from apeax.com.au. IP: ${ip}`,
      },
      company: {
        name: app.businessName,
        tradingAs: app.tradingAs,
        website: app.website,
        sector: app.sectorFocus,
        description: app.experience,
        location: locationStr,
        size: app.bays ? `${app.bays} bays` : null,
        abn: app.abn,
        businessType: null,
        yearsInBusiness: app.yearsTrading,
        sectorDeclaration: app.sectorFocus,
        exclusivityDisclosureText: "All 5 trade attestations confirmed (exclusivity, competency, warranty registration, pricing confidentiality, brand representation).",
        exclusivityDisclosureDate: nowIso,
        currentFilmBrandsCarried: app.currentBrands ? [app.currentBrands] : [],
        credentials: app.experience,
        bays: app.bays,
      },
      contact: {
        name: app.contactName,
        role: app.contactRole,
        email: app.contactEmail,
        phone: app.contactPhone,
        linkedin: null,
      },
      accountsContact: {
        email: app.accountsEmail,
        phone: app.accountsPhone,
      },
      workshop: {
        address: app.address,
        suburb: app.suburb,
        state: app.state,
        postcode: app.postcode,
        bays: app.bays,
      },
      opportunity: {
        description: "APEAX trade installer account application",
        category: "partner",
        potentialValue: null,
        potentialValueNotes: null,
        urgencyFlag: false,
        urgencyReason: null,
      },
      roeScore: null,
      stockdaleAssessment: null,
      promotedToPipeline: false,
      promotedDate: null,
      pipelineLeadId: null,
      weeklyDecision: null,
      notes: "",
      tags: ["apeax", "trade-application", "shield", "vetting-required"],
      shieldMetadata: {
        receivedAt: nowIso,
        receivedFrom: "apeax.com.au",
        ip,
        allAttestationsConfirmed: true,
      },
      createdAt: now,
      updatedAt: now,
      createdBy: "apeax-portal",
    };

    const ref = await db.collection(COLLECTIONS.LEADS_REGISTER).add(entry);

    return NextResponse.json({
      ok: true,
      applicationId: ref.id,  // CIPHER's Netlify function reads this
      id: ref.id,
      registerEntryId: ref.id,
      status: "pending_vetting",
      message: "Trade application received. SHIELD will vet your application within 3 business days.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to submit trade application.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
