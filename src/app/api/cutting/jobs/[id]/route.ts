import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";
import { requireCuttingUser, cuttingErrorStatus } from "@/lib/server/cuttingAuth";
import type { CuttingJob } from "@/lib/types";

const EDITABLE_FIELDS = new Set([
  "vehicle",
  "patternSource",
  "patternReference",
  "patternUrl",
  "patternFileUrl",
  "filmStockItemId",
  "filmStockDescription",
  "rollConsumedMetres",
  "operatorId",
  "operatorName",
  "cutStartAt",
  "cutEndAt",
  "qcStatus",
  "issuesText",
  "issueTags",
  "notes",
  "materialProfileId",
  "photos",
  "jobId",
  "jobNumber",
]);

async function loadAndAuthorise(req: NextRequest, id: string) {
  const ctx = await requireCuttingUser(req);
  const ref = admin.firestore().collection(COLLECTIONS.CUTTING_JOBS).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Cutting job not found.");
  const job = snap.data() as CuttingJob;

  // Client can only touch their own records
  if (ctx.role === "client" && job.clientId !== ctx.userId) {
    throw new Error("Not authorised for this cutting job.");
  }
  return { ctx, ref, job };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { job } = await loadAndAuthorise(req, id);
    return NextResponse.json({ ok: true, job: { ...job, id } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ ok: false, error: msg }, { status: cuttingErrorStatus(msg) });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { ref } = await loadAndAuthorise(req, id);
    const body = await req.json();
    const updates: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body || {})) {
      if (EDITABLE_FIELDS.has(k)) updates[k] = v;
    }
    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    await ref.set(updates, { merge: true });
    const fresh = await ref.get();
    const data = fresh.data() ?? {};
    return NextResponse.json({ ok: true, job: { ...data, id: fresh.id } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ ok: false, error: msg }, { status: cuttingErrorStatus(msg) });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { ctx, ref } = await loadAndAuthorise(req, id);
    // Soft delete only — clients can't delete, admins/techs can
    if (ctx.role === "client") {
      throw new Error("Not authorised to delete cutting jobs.");
    }
    await ref.set(
      {
        isDeleted: true,
        deletedAt: admin.firestore.FieldValue.serverTimestamp(),
        deletedBy: ctx.userId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ ok: false, error: msg }, { status: cuttingErrorStatus(msg) });
  }
}
