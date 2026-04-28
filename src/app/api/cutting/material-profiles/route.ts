import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";
import { requireCuttingUser, cuttingErrorStatus } from "@/lib/server/cuttingAuth";

const DEFAULT_TENANT = "asi";

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireCuttingUser(req);
    const tenantId = (user.jvPartnerOrg as string) || DEFAULT_TENANT;
    const snap = await admin
      .firestore()
      .collection(COLLECTIONS.CUTTING_MATERIAL_PROFILES)
      .where("tenantId", "==", tenantId)
      .where("isActive", "==", true)
      .get();
    const profiles = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ ok: true, profiles });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ ok: false, error: msg }, { status: cuttingErrorStatus(msg) });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireCuttingUser(req);
    if (ctx.role !== "admin") throw new Error("Only admins can manage material profiles.");
    const tenantId = (ctx.user.jvPartnerOrg as string) || DEFAULT_TENANT;
    const body = await req.json();

    const now = admin.firestore.Timestamp.now();
    const doc = {
      tenantId,
      name: String(body.name || "").trim(),
      filmType: body.filmType ?? null,
      stockItemId: body.stockItemId ?? null,
      cuttingForceGrams: Number(body.cuttingForceGrams ?? 100),
      speedMmPerSec: Number(body.speedMmPerSec ?? 400),
      bladeDepthMm: body.bladeDepthMm != null ? Number(body.bladeDepthMm) : null,
      passCount: Math.max(1, Number(body.passCount ?? 1)),
      toolNumber: body.toolNumber != null ? Number(body.toolNumber) : 1,
      notes: body.notes ?? null,
      isActive: body.isActive !== false,
      createdAt: now,
      updatedAt: now,
    };
    if (!doc.name) throw new Error("Profile name required.");

    const ref = await admin
      .firestore()
      .collection(COLLECTIONS.CUTTING_MATERIAL_PROFILES)
      .add(doc);
    return NextResponse.json({ ok: true, profile: { id: ref.id, ...doc } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ ok: false, error: msg }, { status: cuttingErrorStatus(msg) });
  }
}
