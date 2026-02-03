import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";

const formatTimestamp = (value?: admin.firestore.Timestamp | null) => {
  if (!value) return null;
  return value.toDate().toISOString();
};

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = await requireUserId(req);
    const userSnap = await admin.firestore().collection(COLLECTIONS.USERS).doc(userId).get();
    const role = userSnap.data()?.role;
    if (role !== "admin") {
      return NextResponse.json({ error: "Not authorised." }, { status: 403 });
    }

    const postId = params.id;
    const postSnap = await admin
      .firestore()
      .collection(COLLECTIONS.AGENT_COMMUNITY_POSTS)
      .doc(postId)
      .get();

    if (!postSnap.exists) {
      return NextResponse.json({ error: "Post not found." }, { status: 404 });
    }

    const postData = postSnap.data() as Record<string, unknown>;

    const commentsSnap = await admin
      .firestore()
      .collection(COLLECTIONS.AGENT_COMMUNITY_COMMENTS)
      .where("postId", "==", postId)
      .orderBy("createdAt", "asc")
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

    return NextResponse.json({
      post: {
        id: postSnap.id,
        title: postData.title,
        body: postData.body,
        category: postData.category || "professional",
        tags: postData.tags || [],
        author: postData.author,
        score: postData.score ?? 0,
        status: postData.status || "active",
        createdAt: formatTimestamp(postData.createdAt as admin.firestore.Timestamp),
        updatedAt: formatTimestamp(postData.updatedAt as admin.firestore.Timestamp),
        comments,
        commentCount: comments.length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load post.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
