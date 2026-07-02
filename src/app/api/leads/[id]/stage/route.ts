import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";
import {
  isClosedDealStage,
  normaliseOptionalString,
  runClosedLeadAutomation,
  type ClosedLeadAutomationResult,
} from "@/lib/server/leadConversion";
import type { Lead, PipelineStage, StageChange } from "@/lib/types";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireUserId(req);
    const { id } = await params;
    const { stage, reason } = (await req.json()) as { stage: PipelineStage; reason?: string | null };

    const db = admin.firestore();
    const ref = db.collection(COLLECTIONS.LEADS).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const lead = snap.data() as Lead;
    const now = new Date().toISOString();
    const normalisedReason = normaliseOptionalString(reason);
    const closesDeal = isClosedDealStage(lead.streamType, stage);

    const change: StageChange = {
      fromStage: lead.stage,
      toStage: stage,
      changedAt: now,
      changedBy: userId,
      ...(normalisedReason ? { reason: normalisedReason } : {}),
    };

    await ref.set({
      stage,
      stageEnteredAt: now,
      stageHistory: admin.firestore.FieldValue.arrayUnion(change),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastStageChangeReason: normalisedReason,
      ...(closesDeal ? { contactSync: { status: "pending", error: null } } : {}),
    }, { merge: true });

    let syncResult: ClosedLeadAutomationResult | null = null;
    if (closesDeal) {
      try {
        syncResult = await runClosedLeadAutomation(db, id, { ...lead, stage } as Lead, userId);
      } catch (syncError) {
        const message = syncError instanceof Error ? syncError.message : "Failed to sync closed lead to Contacts.";
        await ref.set({
          contactSync: {
            status: "failed",
            error: message,
            failedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        }, { merge: true });
        throw syncError;
      }
    }

    return NextResponse.json({ ok: true, stage, contactSync: syncResult });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 400 });
  }
}
