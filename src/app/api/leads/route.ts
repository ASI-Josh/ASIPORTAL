import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";
import type { Lead, PipelineStage, StreamType } from "@/lib/types";

function calcGrade(bantScore: number): Lead["leadGrade"] {
  if (bantScore >= 80) return "A";
  if (bantScore >= 65) return "B";
  if (bantScore >= 50) return "C";
  if (bantScore >= 35) return "D";
  return "E";
}

async function nextLeadNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const db = admin.firestore();
  const counterRef = db.collection("counters").doc("leads");
  let num = 1;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const data = snap.data() as { seq?: number; year?: number } | undefined;
    if (!snap.exists || data?.year !== year) {
      tx.set(counterRef, { seq: 1, year });
      num = 1;
    } else {
      num = (data?.seq || 0) + 1;
      tx.update(counterRef, { seq: num });
    }
  });
  return `LD-${year}-${String(num).padStart(4, "0")}`;
}

// ─── GET — list leads ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    await requireUserId(req);
    const { searchParams } = new URL(req.url);
    const stage = searchParams.get("stage") as PipelineStage | null;
    const grade = searchParams.get("grade");
    const streamType = searchParams.get("streamType") as StreamType | null;
    const limit = Math.min(parseInt(searchParams.get("limit") || "200", 10), 200);

    const db = admin.firestore();
    const snap = await db
      .collection(COLLECTIONS.LEADS)
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();
    let leads = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((l) => !(l as Record<string, unknown>).isDeleted) as Lead[];

    if (streamType) leads = leads.filter((l) => (l.streamType || "sales") === streamType);
    if (stage) leads = leads.filter((l) => l.stage === stage);
    if (grade) leads = leads.filter((l) => l.leadGrade === grade);

    return NextResponse.json({ leads });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 400 });
  }
}

// ─── POST — create lead ───────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const db = admin.firestore();
    const userSnap = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    const user = userSnap.data() as { name?: string; role?: string } | undefined;

    const body = (await req.json()) as Partial<Lead>;
    if (!body.companyName) {
      return NextResponse.json({ error: "companyName is required." }, { status: 400 });
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const bantBreakdown = body.bantBreakdown || { budget: 0, authority: 0, need: 0, timing: 0, fit: 0 };
    const bantScore = body.bantScore ?? Object.values(bantBreakdown).reduce((a, b) => a + b, 0);
    const leadNumber = await nextLeadNumber();

    const payload: Omit<Lead, "id"> = {
      leadNumber,
      streamType: body.streamType || "sales",
      companyName: body.companyName,
      companyWebsite: body.companyWebsite,
      companyLinkedIn: body.companyLinkedIn,
      sector: body.sector || "other",
      companySize: body.companySize,
      existingOrganizationId: body.existingOrganizationId,
      isExistingClient: body.isExistingClient ?? false,
      contacts: body.contacts || [],
      primaryContactId: body.primaryContactId,
      bantScore,
      bantBreakdown,
      leadGrade: calcGrade(bantScore),
      stage: body.stage || "identified",
      stageHistory: [],
      stageEnteredAt: new Date().toISOString(),
      source: body.source || { type: "manual" },
      estimatedValue: body.estimatedValue,
      estimatedServices: body.estimatedServices || [],
      painPoints: body.painPoints || [],
      asiSolutionFit: body.asiSolutionFit || [],
      outreachSequence: body.outreachSequence || null,
      outreachStatus: body.outreachStatus || {
        linkedInConnected: false, linkedInMessageSent: false, emailsSent: 0,
        responseReceived: false, meetingScheduled: false,
      },
      outreachHistory: [],
      marketMode: body.marketMode || "neutral",
      nextActionDate: body.nextActionDate,
      nextAction: body.nextAction,
      notes: body.notes || "",
      tags: body.tags || [],
      createdAt: now as unknown as import("firebase/firestore").Timestamp,
      updatedAt: now as unknown as import("firebase/firestore").Timestamp,
      createdBy: userId,
      createdByName: user?.name,
      isDeleted: false,
    };

    const ref = await db.collection(COLLECTIONS.LEADS).add(payload);
    return NextResponse.json({ id: ref.id, ...payload });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 400 });
  }
}
