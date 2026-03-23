import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";
import type { OutreachEvent } from "@/lib/types";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireUserId(req);
    const { id } = await params;
    const body = (await req.json()) as Omit<OutreachEvent, "id" | "loggedBy">;

    const event: OutreachEvent = {
      id: crypto.randomUUID(),
      loggedBy: userId,
      ...body,
    };

    const db = admin.firestore();
    const ref = db.collection(COLLECTIONS.LEADS).doc(id);

    const updates: Record<string, unknown> = {
      outreachHistory: admin.firestore.FieldValue.arrayUnion(event),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      "outreachStatus.lastContactDate": event.date,
      "outreachStatus.emailsSent": admin.firestore.FieldValue.increment(
        event.type === "email" ? 1 : 0
      ),
    };

    if (event.type === "linkedin_connect") updates["outreachStatus.linkedInConnected"] = true;
    if (event.type === "linkedin_message") updates["outreachStatus.linkedInMessageSent"] = true;
    if (event.type === "meeting") updates["outreachStatus.meetingScheduled"] = true;
    if (body.response) {
      updates["outreachStatus.responseReceived"] = true;
      updates["outreachStatus.lastResponseDate"] = event.date;
    }

    await ref.set(updates, { merge: true });
    return NextResponse.json({ ok: true, event });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 400 });
  }
}
