import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";
import type { Lead } from "@/lib/types";

function calcGrade(s: number): Lead["leadGrade"] {
  if (s >= 80) return "A";
  if (s >= 65) return "B";
  if (s >= 50) return "C";
  if (s >= 35) return "D";
  return "E";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireUserId(req);
    const { id } = await params;
    const snap = await admin.firestore().collection(COLLECTIONS.LEADS).doc(id).get();
    if (!snap.exists) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json({ id: snap.id, ...snap.data() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 400 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireUserId(req);
    const { id } = await params;
    const body = (await req.json()) as Partial<Lead>;
    const now = admin.firestore.FieldValue.serverTimestamp();

    const updates: Record<string, unknown> = { ...body, updatedAt: now };
    delete updates.id;
    delete updates.leadNumber;
    delete updates.createdAt;
    delete updates.createdBy;
    delete updates.stageHistory;

    // Recalculate grade if bantBreakdown or bantScore updated
    if (updates.bantBreakdown || updates.bantScore !== undefined) {
      const ref = await admin.firestore().collection(COLLECTIONS.LEADS).doc(id).get();
      const existing = ref.data() as Lead | undefined;
      const breakdown = (updates.bantBreakdown || existing?.bantBreakdown) as Lead["bantBreakdown"];
      const score = (updates.bantScore as number) ?? Object.values(breakdown).reduce((a, b) => a + b, 0);
      updates.bantScore = score;
      updates.bantGrade = calcGrade(score);
      updates.leadGrade = calcGrade(score);
    }

    await admin.firestore().collection(COLLECTIONS.LEADS).doc(id).set(updates, { merge: true });
    const updated = await admin.firestore().collection(COLLECTIONS.LEADS).doc(id).get();
    return NextResponse.json({ id: updated.id, ...updated.data() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 400 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireUserId(req);
    const { id } = await params;
    await admin.firestore().collection(COLLECTIONS.LEADS).doc(id).set(
      { isDeleted: true, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 400 });
  }
}
