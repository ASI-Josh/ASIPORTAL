/**
 * POST /api/apeax/trade-application/:id/reject
 * SHIELD-only. Rejects a trade application. Logs reason and sets
 * vettingLockoutUntil to NOW + 12 months to prevent immediate resubmission.
 *
 * Auth: SHIELD_API_KEY via x-shield-api-key header.
 */

import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";
import { requireShieldServiceAuth } from "@/lib/server/shieldAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RejectPayload {
  reason?: string;
  rejectedBy?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireShieldServiceAuth(req);
    const { id } = await params;
    if (!id) throw new Error("Missing register entry id.");

    const body = (await req.json().catch(() => ({}))) as RejectPayload;
    const reason = (body.reason || "").trim();
    if (!reason) throw new Error("reason is required for audit trail.");
    const rejectedBy = body.rejectedBy || "shield-agent";

    const db = admin.firestore();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const nowIso = new Date().toISOString();
    const lockoutUntil = new Date(Date.now() + 365 * 86400000).toISOString();

    const regRef = db.collection(COLLECTIONS.LEADS_REGISTER).doc(id);
    const regSnap = await regRef.get();
    if (!regSnap.exists) throw new Error("Trade application not found.");
    const regData = regSnap.data()!;
    if (regData.source?.type !== "apeax_portal_trade_app") {
      throw new Error("Not an APEAX trade application.");
    }
    if (regData.status === "promoted") {
      throw new Error("Trade application was already approved.");
    }

    await regRef.set({
      status: "rejected",
      rejectionReason: reason,
      rejectedAt: nowIso,
      rejectedBy,
      vettingLockoutUntil: lockoutUntil,
      updatedAt: now,
    }, { merge: true });

    return NextResponse.json({
      ok: true,
      registerEntryId: id,
      rejectedAt: nowIso,
      rejectedBy,
      vettingLockoutUntil: lockoutUntil,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reject trade application.";
    const status = message.includes("SHIELD") || message.includes("credentials") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
