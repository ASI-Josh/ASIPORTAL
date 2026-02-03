import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    await requireAdminUser(req);
    const snap = await admin
      .firestore()
      .collection(COLLECTIONS.AGENT_HUB_THREADS)
      .orderBy("updatedAt", "desc")
      .limit(50)
      .get();

    const threads = snap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        title: data.title || "Conversation",
        createdAt: data.createdAt?.toDate?.().toISOString?.() || null,
        updatedAt: data.updatedAt?.toDate?.().toISOString?.() || null,
        lastMessage: data.lastMessage || "",
      };
    });

    return NextResponse.json({ threads });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load threads.";
    const status = message.toLowerCase().includes("authorisation") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId, user } = await requireAdminUser(req);
    const payload = (await req.json()) as { title?: string };
    const title = payload.title?.trim() || "New conversation";
    const now = admin.firestore.FieldValue.serverTimestamp();

    const ref = await admin.firestore().collection(COLLECTIONS.AGENT_HUB_THREADS).add({
      title,
      createdAt: now,
      updatedAt: now,
      lastMessage: "",
      createdById: userId,
      createdByName: user?.name || user?.email || "Admin",
    });

    return NextResponse.json({ id: ref.id, title });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create thread.";
    const status = message.toLowerCase().includes("authorisation") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
