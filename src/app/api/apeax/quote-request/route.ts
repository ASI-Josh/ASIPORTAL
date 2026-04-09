/**
 * POST /api/apeax/quote-request
 * Public endpoint — accepts quote requests from the apeax.com.au public form.
 * Creates a Leads Register entry with source "apeax_portal_quote" for SHIELD to triage.
 *
 * No auth. Netlify Functions layer handles rate limiting + IP logging upstream.
 */

import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface QuoteRequestPayload {
  companyName?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  businessType?: string; // installer, glazier, tinter, fleet manager, etc
  abn?: string;
  location?: string;
  productsInterested?: string[];
  estimatedMonthlyVolume?: string;
  projectDescription?: string;
  howDidYouHearAboutUs?: string;
}

function validate(body: unknown): QuoteRequestPayload {
  if (!body || typeof body !== "object") throw new Error("Invalid request body.");
  const p = body as Record<string, unknown>;
  const required = ["companyName", "contactName", "contactEmail"];
  for (const key of required) {
    if (!p[key] || typeof p[key] !== "string" || !(p[key] as string).trim()) {
      throw new Error(`Missing required field: ${key}`);
    }
  }
  return p as QuoteRequestPayload;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const payload = validate(body);

    const db = admin.firestore();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const nowIso = new Date().toISOString();
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";

    const entry = {
      streamType: "sales",
      status: "identified",
      source: {
        type: "apeax_portal_quote",
        scanDate: null,
        scanId: null,
        findingId: null,
        notes: `Public quote request from apeax.com.au. IP: ${ip}`,
      },
      company: {
        name: String(payload.companyName || "").trim(),
        website: null,
        sector: "other",
        description: payload.projectDescription || null,
        location: payload.location || null,
        size: payload.estimatedMonthlyVolume || null,
        abn: payload.abn || null,
        businessType: payload.businessType || null,
      },
      contact: {
        name: String(payload.contactName || "").trim(),
        role: null,
        email: String(payload.contactEmail || "").trim().toLowerCase(),
        phone: payload.contactPhone || null,
        linkedin: null,
      },
      opportunity: {
        description: payload.projectDescription || "APEAX product quote request",
        category: "customer",
        potentialValue: null,
        potentialValueNotes: payload.estimatedMonthlyVolume || null,
        urgencyFlag: false,
        urgencyReason: null,
      },
      roeScore: null,
      stockdaleAssessment: null,
      promotedToPipeline: false,
      promotedDate: null,
      pipelineLeadId: null,
      weeklyDecision: null,
      notes: [
        payload.projectDescription,
        payload.productsInterested ? `Products: ${payload.productsInterested.join(", ")}` : null,
        payload.howDidYouHearAboutUs ? `Source: ${payload.howDidYouHearAboutUs}` : null,
      ].filter(Boolean).join("\n\n") || "",
      tags: ["apeax", "quote-request", "shield"],
      shieldMetadata: {
        receivedAt: nowIso,
        receivedFrom: "apeax.com.au",
        ip,
        productsInterested: payload.productsInterested || [],
      },
      createdAt: now,
      updatedAt: now,
      createdBy: "apeax-portal",
    };

    const ref = await db.collection(COLLECTIONS.LEADS_REGISTER).add(entry);

    return NextResponse.json({
      ok: true,
      registerEntryId: ref.id,
      message: "Quote request received. SHIELD will review and respond within 2 business days.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to submit quote request.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
