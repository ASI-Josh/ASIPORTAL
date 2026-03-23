import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";
import type { Lead, PipelineStage } from "@/lib/types";

export async function GET(req: NextRequest) {
  try {
    await requireUserId(req);
    const db = admin.firestore();
    const snap = await db.collection(COLLECTIONS.LEADS).where("isDeleted", "!=", true).get();
    const leads = snap.docs.map((d) => d.data() as Lead);

    const byStage: Record<string, number> = {};
    const byGrade: Record<string, number> = {};
    const bySector: Record<string, number> = {};
    let totalEstimatedValue = 0;
    let overdueFollowUps = 0;
    const today = new Date().toISOString().split("T")[0];

    leads.forEach((l) => {
      byStage[l.stage] = (byStage[l.stage] || 0) + 1;
      byGrade[l.leadGrade] = (byGrade[l.leadGrade] || 0) + 1;
      bySector[l.sector] = (bySector[l.sector] || 0) + 1;
      totalEstimatedValue += l.estimatedValue || 0;
      if (l.nextActionDate && l.nextActionDate < today && l.stage !== "won" && l.stage !== "lost") {
        overdueFollowUps += 1;
      }
    });

    const hotLeads = (byGrade["A"] || 0) + (byGrade["B"] || 0);
    const totalActive = leads.filter((l) => l.stage !== "won" && l.stage !== "lost").length;

    return NextResponse.json({
      total: leads.length,
      totalActive,
      hotLeads,
      overdueFollowUps,
      totalEstimatedValue,
      byStage,
      byGrade,
      bySector,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 400 });
  }
}
