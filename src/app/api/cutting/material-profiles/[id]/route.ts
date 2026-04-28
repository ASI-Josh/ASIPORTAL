import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";
import { requireCuttingUser, cuttingErrorStatus } from "@/lib/server/cuttingAuth";

const EDITABLE = new Set([
  "name",
  "filmType",
  "stockItemId",
  "cuttingForceGrams",
  "speedMmPerSec",
  "bladeDepthMm",
  "passCount",
  "toolNumber",
  "notes",
  "isActive",
]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireCuttingUser(req);
    if (ctx.role !== "admin") throw new Error("Only admins can manage material profiles.");
    const { id } = await params;
    const body = await req.json();
    const updates: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body || {})) {
      if (EDITABLE.has(k)) updates[k] = v;
    }
    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    await admin
      .firestore()
      .collection(COLLECTIONS.CUTTING_MATERIAL_PROFILES)
      .doc(id)
      .set(updates, { merge: true });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ ok: false, error: msg }, { status: cuttingErrorStatus(msg) });
  }
}
