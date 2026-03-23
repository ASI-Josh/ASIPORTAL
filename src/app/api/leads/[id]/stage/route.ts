import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";
import type { Lead, PipelineStage, StageChange } from "@/lib/types";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireUserId(req);
    const { id } = await params;
    const { stage, reason } = (await req.json()) as { stage: PipelineStage; reason?: string };

    const db = admin.firestore();
    const ref = db.collection(COLLECTIONS.LEADS).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const lead = snap.data() as Lead;
    const now = new Date().toISOString();

    const change: StageChange = {
      fromStage: lead.stage,
      toStage: stage,
      changedAt: now,
      changedBy: userId,
      reason,
    };

    await ref.set({
      stage,
      stageEnteredAt: now,
      stageHistory: admin.firestore.FieldValue.arrayUnion(change),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return NextResponse.json({ ok: true, stage });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 400 });
  }
}
