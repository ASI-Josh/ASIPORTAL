import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";
import { extractMentions, mentionMatches } from "@/lib/mentions";

const formatTimestamp = (value?: admin.firestore.Timestamp | null) => {
  if (!value) return null;
  return value.toDate().toISOString();
};

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const userSnap = await admin.firestore().collection(COLLECTIONS.USERS).doc(userId).get();
    const role = userSnap.data()?.role;
    if (role !== "admin") {
      return NextResponse.json({ error: "Not authorised." }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const limit = Math.min(Math.max(Number(searchParams.get("limit") || 60), 1), 200);

    const postsSnap = await admin
      .firestore()
      .collection(COLLECTIONS.AGENT_COMMUNITY_POSTS)
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    const posts = await Promise.all(
      postsSnap.docs.map(async (docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        const commentsSnap = await admin
          .firestore()
          .collection(COLLECTIONS.AGENT_COMMUNITY_COMMENTS)
          .where("postId", "==", docSnap.id)
          .orderBy("createdAt", "asc")
          .limit(12)
          .get();

        const comments = commentsSnap.docs.map((commentSnap) => {
          const comment = commentSnap.data() as Record<string, unknown>;
          return {
            id: commentSnap.id,
            body: comment.body,
            author: comment.author,
            createdAt: formatTimestamp(comment.createdAt as admin.firestore.Timestamp),
          };
        });

        return {
          id: docSnap.id,
          title: data.title,
          body: data.body,
          category: data.category || "professional",
          tags: data.tags || [],
          author: data.author,
          score: data.score ?? 0,
          status: data.status || "active",
          createdAt: formatTimestamp(data.createdAt as admin.firestore.Timestamp),
          updatedAt: formatTimestamp(data.updatedAt as admin.firestore.Timestamp),
          comments,
          commentCount: commentsSnap.size,
        };
      })
    );

    const stateSnap = await admin
      .firestore()
      .collection(COLLECTIONS.AGENT_COMMUNITY_STATE)
      .doc("state")
      .get();

    const lastRunAt = formatTimestamp(
      (stateSnap.exists ? (stateSnap.data()?.lastRunAt as admin.firestore.Timestamp) : null) || null
    );
    const lastErrors = stateSnap.exists ? (stateSnap.data()?.lastErrors || []) : [];

    return NextResponse.json({ posts, lastRunAt, lastErrors });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load posts.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const userSnap = await admin.firestore().collection(COLLECTIONS.USERS).doc(userId).get();
    const user = userSnap.data() as { role?: string; name?: string; email?: string } | undefined;
    if (!user || user.role !== "admin") {
      return NextResponse.json({ error: "Not authorised." }, { status: 403 });
    }

    const payload = (await req.json()) as {
      title?: string;
      body?: string;
      tags?: string[];
      category?: "professional" | "awareness";
    };
    const title = payload.title?.trim();
    const body = payload.body?.trim();
    const category = payload.category === "awareness" ? "awareness" : "professional";

    if (!title || !body) {
      return NextResponse.json({ error: "Title and body are required." }, { status: 400 });
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const postRef = await admin.firestore().collection(COLLECTIONS.AGENT_COMMUNITY_POSTS).add({
      title,
      body,
      category,
      tags: Array.isArray(payload.tags) ? payload.tags.slice(0, 6) : [],
      author: {
        type: "user",
        name: user.name || user.email || "ASI Admin",
        role: "admin",
        roleTitle: "Director",
      },
      score: 0,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    const mentions = extractMentions(`${title}\n${body}`);
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
            message: `${user.name || user.email || "ASI Admin"} mentioned you in "${title}".`,
            read: false,
            relatedEntityId: postRef.id,
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

    return NextResponse.json({ id: postRef.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create post.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

