import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";
import { requireUserId } from "@/lib/server/firebaseAuth";

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    await admin.firestore().collection(COLLECTIONS.CALENDAR_TOKENS).doc(userId).delete();
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to disconnect.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
