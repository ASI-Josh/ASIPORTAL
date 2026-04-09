/**
 * POST /api/apeax/trade-application
 * Public endpoint — trade installer account application from apeax.com.au.
 * Creates a Leads Register entry with source "apeax_portal_trade_app" for
 * SHIELD to vet. Includes exclusivity disclosure + sector declaration.
 *
 * No auth. Netlify Functions rate-limits upstream.
 */

import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface TradeApplicationPayload {
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

function validate(body: unknown): TradeApplicationPayload {
  if (!body || typeof body !== "object") throw new Error("Invalid request body.");
  const p = body as Record<string, unknown>;
  const required = ["businessName", "abn", "contactName", "contactEmail", "contactPhone", "sectorDeclaration"];
  for (const key of required) {
    if (!p[key] || typeof p[key] !== "string" || !(p[key] as string).trim()) {
      throw new Error(`Missing required field: ${key}`);
    }
  }
  if (p.exclusivityDisclosureAgreed !== true) {
    throw new Error("Exclusivity disclosure must be acknowledged.");
  }
  return p as TradeApplicationPayload;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const payload = validate(body);

    const db = admin.firestore();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const nowIso = new Date().toISOString();
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";

    // Check for vetting lockout (rejected in last 12 months)
    const email = String(payload.contactEmail || "").trim().toLowerCase();
    const lockoutSnap = await db.collection(COLLECTIONS.LEADS_REGISTER)
      .where("contact.email", "==", email)
      .where("source.type", "==", "apeax_portal_trade_app")
      .where("status", "==", "rejected")
      .limit(5)
      .get();
    for (const d of lockoutSnap.docs) {
      const data = d.data();
      if (typeof data.vettingLockoutUntil === "string" && data.vettingLockoutUntil > nowIso) {
        return NextResponse.json({
          error: "Your application cannot be submitted at this time. Please contact ASI Australia directly for further information.",
        }, { status: 403 });
      }
    }

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
        name: String(payload.businessName || "").trim(),
        website: payload.website || null,
        sector: "other",
        description: payload.tradeCredentials || null,
        location: [payload.suburb, payload.state, payload.postcode].filter(Boolean).join(" ") || payload.address || null,
        size: payload.numberOfInstallers ? `${payload.numberOfInstallers} installers` : null,
        abn: payload.abn || null,
        businessType: payload.businessType || null,
        yearsInBusiness: payload.yearsInBusiness || null,
        sectorDeclaration: payload.sectorDeclaration,
        exclusivityDisclosureText: payload.exclusivityDisclosureText || null,
        exclusivityDisclosureDate: nowIso,
        currentFilmBrandsCarried: payload.currentFilmBrandsCarried || [],
        credentials: payload.tradeCredentials || null,
      },
      contact: {
        name: String(payload.contactName || "").trim(),
        role: payload.contactRole || null,
        email,
        phone: payload.contactPhone || null,
        linkedin: null,
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
      notes: payload.referencedBy ? `Referenced by: ${payload.referencedBy}` : "",
      tags: ["apeax", "trade-application", "shield", "vetting-required"],
      shieldMetadata: {
        receivedAt: nowIso,
        receivedFrom: "apeax.com.au",
        ip,
        exclusivityDisclosureAgreed: true,
      },
      createdAt: now,
      updatedAt: now,
      createdBy: "apeax-portal",
    };

    const ref = await db.collection(COLLECTIONS.LEADS_REGISTER).add(entry);

    return NextResponse.json({
      ok: true,
      registerEntryId: ref.id,
      message: "Trade application received. SHIELD will vet your application and respond within 5 business days.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to submit trade application.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
