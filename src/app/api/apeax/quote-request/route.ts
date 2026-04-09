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

/**
 * Accepts both CIPHER's apeax.com.au shape (company, contactName, email,
 * phone, state, postcode, category, exclusivity, films[]) AND the flatter
 * portal-internal shape (companyName, contactEmail, contactPhone). Both are
 * normalised into the same Leads Register entry shape.
 */
interface QuoteRequestPayload {
  // CIPHER shape (from apeax.com.au Netlify function)
  company?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  role?: string;
  state?: string;
  postcode?: string;
  category?: string; // passenger | heavy | commercial
  films?: string[];
  quantity?: string;
  timeframe?: string;
  exclusivity?: boolean | string;
  submittedAt?: string;
  userAgent?: string;
  // Portal-internal shape (legacy)
  companyName?: string;
  contactEmail?: string;
  contactPhone?: string;
  businessType?: string;
  // Common
  abn?: string;
  location?: string;
  productsInterested?: string[];
  estimatedMonthlyVolume?: string;
  projectDescription?: string;
  notes?: string;
  howDidYouHearAboutUs?: string;
}

function validate(body: unknown): QuoteRequestPayload {
  if (!body || typeof body !== "object") throw new Error("Invalid request body.");
  const p = body as QuoteRequestPayload;
  // Accept either shape: company OR companyName, email OR contactEmail
  const company = p.company || p.companyName;
  const contactName = p.contactName;
  const email = p.email || p.contactEmail;
  if (!company || typeof company !== "string" || !company.trim()) {
    throw new Error("Missing required field: company (or companyName)");
  }
  if (!contactName || typeof contactName !== "string" || !contactName.trim()) {
    throw new Error("Missing required field: contactName");
  }
  if (!email || typeof email !== "string" || !email.trim()) {
    throw new Error("Missing required field: email (or contactEmail)");
  }
  return p;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const payload = validate(body);

    // Normalise across CIPHER's and portal-internal shapes
    const companyName = String(payload.company || payload.companyName || "").trim();
    const contactName = String(payload.contactName || "").trim();
    const contactEmail = String(payload.email || payload.contactEmail || "").trim().toLowerCase();
    const contactPhone = String(payload.phone || payload.contactPhone || "").trim() || null;
    const films = Array.isArray(payload.films) ? payload.films : (payload.productsInterested || []);
    const locationBits = [payload.state, payload.postcode].filter(Boolean).join(" ") || payload.location || null;

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
        name: companyName,
        website: null,
        sector: payload.category || "other",
        description: payload.notes || payload.projectDescription || null,
        location: locationBits,
        size: payload.quantity || payload.estimatedMonthlyVolume || null,
        abn: payload.abn || null,
        businessType: payload.businessType || payload.category || null,
      },
      contact: {
        name: contactName,
        role: payload.role || null,
        email: contactEmail,
        phone: contactPhone,
        linkedin: null,
      },
      opportunity: {
        description: payload.notes || payload.projectDescription || "APEAX product quote request",
        category: "customer",
        potentialValue: null,
        potentialValueNotes: payload.quantity || payload.estimatedMonthlyVolume || null,
        urgencyFlag: payload.timeframe === "immediate" || payload.timeframe === "urgent",
        urgencyReason: payload.timeframe || null,
      },
      roeScore: null,
      stockdaleAssessment: null,
      promotedToPipeline: false,
      promotedDate: null,
      pipelineLeadId: null,
      weeklyDecision: null,
      notes: [
        payload.notes || payload.projectDescription,
        films.length > 0 ? `Films of interest: ${films.join(", ")}` : null,
        payload.quantity ? `Quantity: ${payload.quantity}` : null,
        payload.timeframe ? `Timeframe: ${payload.timeframe}` : null,
        payload.howDidYouHearAboutUs ? `Source: ${payload.howDidYouHearAboutUs}` : null,
      ].filter(Boolean).join("\n\n") || "",
      tags: ["apeax", "quote-request", "shield", payload.category].filter(Boolean) as string[],
      shieldMetadata: {
        receivedAt: nowIso,
        receivedFrom: "apeax.com.au",
        ip,
        userAgent: payload.userAgent || null,
        films,
        category: payload.category || null,
        exclusivity: payload.exclusivity || null,
      },
      createdAt: now,
      updatedAt: now,
      createdBy: "apeax-portal",
    };

    const ref = await db.collection(COLLECTIONS.LEADS_REGISTER).add(entry);

    return NextResponse.json({
      ok: true,
      quoteId: ref.id, // CIPHER's Netlify function reads `quoteId || id`
      id: ref.id,
      registerEntryId: ref.id,
      message: "Quote request received. SHIELD will review and respond within 2 business days.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to submit quote request.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
