import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";
import { extractMentions, mentionMatches } from "@/lib/mentions";

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



    const mentions = extractMentions(body);
    if (mentions.length > 0) {
      const notifyAllAdmins = mentions.some((mention) =>
        ["all", "admins", "everyone", "team"].some((keyword) => mentionMatches(mention, keyword))
      );
      const adminsSnap = await admin
        .firestore()
        .collection(COLLECTIONS.USERS)
        .where("role", "==", "admin")
        .get();

      const notifications = adminsSnap.docs
        .map((docSnap) => {
          if (!docSnap.id) return null;
          const data = docSnap.data() as { name?: string; email?: string };
          const aliases = [
            data.name || "",
            data.email || "",
            (data.email || "").split("@")[0] || "",
          ];
          const isMentioned = notifyAllAdmins
            ? true
            : mentions.some((mention) => aliases.some((alias) => mentionMatches(mention, alias)));
          if (!isMentioned) return null;
          if (docSnap.id === userId) return null;
          return {
            userId: docSnap.id,
            type: "agent_mention",
            title: "You were mentioned",
            message: `${user.name || user.email || "ASI Admin"} mentioned you in a thread reply.`,
            read: false,
            relatedEntityId: postId,
            relatedEntityType: "agent_thread",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          };
        })
        .filter(Boolean);

      if (notifications.length > 0) {
        const batch = admin.firestore().batch();
        notifications.forEach((payload) => {
          const ref = admin.firestore().collection(COLLECTIONS.NOTIFICATIONS).doc();
          batch.set(ref, payload);
        });
        await batch.commit();
      }
    }

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to post comment.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

