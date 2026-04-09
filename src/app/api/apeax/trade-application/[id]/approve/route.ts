/**
 * POST /api/apeax/trade-application/:id/approve
 * SHIELD-only. Approves a trade application — promotes the Leads Register
 * entry to a ContactOrganization with is_apeax_trade_installer=true, sets
 * trade_discount_band, and creates a credentialed installer user.
 *
 * Auth: SHIELD_API_KEY via x-shield-api-key header.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";
import { requireShieldServiceAuth } from "@/lib/server/shieldAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ApprovePayload {
  tradeDiscountBand?: "A" | "B" | "C";
  approvedBy?: string;
  notes?: string;
  paymentTerms?: string;
  creditLimit?: number;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireShieldServiceAuth(req);
    const { id } = await params;
    if (!id) throw new Error("Missing register entry id.");

    const body = (await req.json().catch(() => ({}))) as ApprovePayload;
    const tradeDiscountBand = body.tradeDiscountBand || "C";
    if (!["A", "B", "C"].includes(tradeDiscountBand)) {
      throw new Error("tradeDiscountBand must be A, B, or C.");
    }
    const approvedBy = body.approvedBy || "shield-agent";

    const db = admin.firestore();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const nowIso = new Date().toISOString();

    const regRef = db.collection(COLLECTIONS.LEADS_REGISTER).doc(id);
    const regSnap = await regRef.get();
    if (!regSnap.exists) throw new Error("Trade application not found.");
    const regData = regSnap.data()!;
    if (regData.source?.type !== "apeax_portal_trade_app") {
      throw new Error("Not an APEAX trade application.");
    }
    if (regData.status === "promoted") {
      throw new Error("Trade application already approved.");
    }
    if (regData.status === "rejected") {
      throw new Error("Trade application was rejected.");
    }

    const company = (regData.company || {}) as Record<string, unknown>;
    const contact = (regData.contact || {}) as Record<string, unknown>;

    // Generate initial login credentials for the installer
    const installerPassword = crypto.randomBytes(16).toString("base64url").slice(0, 16);
    const passwordSalt = crypto.randomBytes(16).toString("hex");
    const passwordHash = crypto
      .createHmac("sha256", passwordSalt)
      .update(installerPassword)
      .digest("hex");

    const orgRef = await db.collection(COLLECTIONS.CONTACT_ORGANIZATIONS).add({
      name: String(company.name || "Unknown"),
      category: "trade_client",
      type: "customer",
      status: "active",
      abn: company.abn || null,
      industry: company.sector || "other",
      address: company.location ? { street: company.location } : null,
      sites: [],
      phone: contact.phone || null,
      email: contact.email || null,
      website: company.website || null,
      isApeaxTradeInstaller: true,
      tradeAccount: {
        sectorDeclaration: company.sectorDeclaration || null,
        exclusivityDisclosureText: company.exclusivityDisclosureText || null,
        exclusivityDisclosureDate: company.exclusivityDisclosureDate || null,
        tradeDiscountBand,
        approvedAt: nowIso,
        approvedBy,
        vettingLockoutUntil: null,
        credentials: company.credentials || null,
        approvalNotes: body.notes || null,
        isActive: true,
        paymentTerms: body.paymentTerms || "Net 14",
        creditLimit: typeof body.creditLimit === "number" ? body.creditLimit : 5000,
      },
      installerAuth: {
        email: String(contact.email || ""),
        contactName: String(contact.name || ""),
        passwordHash,
        passwordSalt,
        mustChangePassword: true,
        lastLoginAt: null,
      },
      createdAt: now,
      updatedAt: now,
    });

    // Update the register entry → promoted
    await regRef.set({
      status: "promoted",
      promotedToPipeline: true,
      promotedDate: nowIso,
      pipelineLeadId: orgRef.id,
      approvedBy,
      approvalNotes: body.notes || null,
      updatedAt: now,
    }, { merge: true });

    return NextResponse.json({
      ok: true,
      organizationId: orgRef.id,
      organizationName: company.name,
      tradeDiscountBand,
      approvedAt: nowIso,
      approvedBy,
      installerLoginCredentials: {
        email: contact.email,
        temporaryPassword: installerPassword,
        loginUrl: "https://apeax.com.au/trade/login",
        mustChangePassword: true,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to approve trade application.";
    const status = message.includes("SHIELD") || message.includes("credentials") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
