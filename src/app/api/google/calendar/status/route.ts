import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";
import { requireUserId } from "@/lib/server/firebaseAuth";

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const tokenSnap = await admin.firestore().collection(COLLECTIONS.CALENDAR_TOKENS).doc(userId).get();
    if (!tokenSnap.exists) {
      return NextResponse.json({ connected: false });
    }

    return NextResponse.json({ connected: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to check status.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
