import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  try {
    await requireUserId(req);
    const { date } = await params;
    const snap = await admin.firestore().collection(COLLECTIONS.OSINT_SCANS).doc(date).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Scan not found." }, { status: 404 });
    }
    return NextResponse.json(snap.data());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load scan.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
