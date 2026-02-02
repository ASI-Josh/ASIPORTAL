import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const userSnap = await admin.firestore().collection(COLLECTIONS.USERS).doc(userId).get();
    const user = userSnap.data() as { role?: string; name?: string; email?: string } | undefined;
    if (!user || user.role !== "admin") {
      return NextResponse.json({ error: "Not authorised." }, { status: 403 });
    }

    const payload = (await req.json()) as { postId?: string; body?: string };
    const postId = payload.postId?.trim();
    const body = payload.body?.trim();

    if (!postId || !body) {
      return NextResponse.json({ error: "Post and comment body are required." }, { status: 400 });
    }

    const postSnap = await admin
      .firestore()
      .collection(COLLECTIONS.AGENT_COMMUNITY_POSTS)
      .doc(postId)
      .get();

    if (!postSnap.exists) {
      return NextResponse.json({ error: "Post not found." }, { status: 404 });
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    await admin.firestore().collection(COLLECTIONS.AGENT_COMMUNITY_COMMENTS).add({
      postId,
      body,
      author: {
        type: "user",
        name: user.name || user.email || "ASI Admin",
        role: "admin",
      },
      createdAt: now,
    });

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to post comment.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

