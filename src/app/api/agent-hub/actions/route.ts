"use server";

import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";
import { getMoltbookAgentFromRequest } from "@/lib/moltbook-auth";
import {
  createMoltbookComment,
  createMoltbookPost,
  createMoltbookReaction,
  registerMoltbookAgent,
} from "@/lib/integrations/moltbook";

const executeAction = async (action: {
  actionType: string;
  payload: Record<string, unknown>;
}) => {
  switch (action.actionType) {
    case "moltbook.register":
      return registerMoltbookAgent({
        name: String(action.payload.name || ""),
        description: action.payload.description ? String(action.payload.description) : undefined,
        website: action.payload.website ? String(action.payload.website) : undefined,
      });
    case "moltbook.post":
      return createMoltbookPost({
        title: String(action.payload.title || ""),
        body: String(action.payload.body || ""),
        tags: Array.isArray(action.payload.tags)
          ? action.payload.tags.map((tag) => String(tag))
          : undefined,
      });
    case "moltbook.comment":
      return createMoltbookComment({
        postId: String(action.payload.postId || ""),
        body: String(action.payload.body || ""),
      });
    case "moltbook.react":
      return createMoltbookReaction({
        postId: String(action.payload.postId || ""),
        reaction: String(action.payload.reaction || ""),
      });
    default:
      throw new Error(`Unsupported action type: ${action.actionType}`);
  }
};

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const userSnap = await admin.firestore().collection(COLLECTIONS.USERS).doc(userId).get();
    const user = userSnap.data() as { role?: string } | undefined;
    if (!user || user.role !== "admin") {
      return NextResponse.json({ error: "Not authorised." }, { status: 403 });
    }

    const actionsSnap = await admin
      .firestore()
      .collection(COLLECTIONS.AGENT_HUB_ACTIONS)
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();

    const actions = actionsSnap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        status: data.status,
        actionType: data.actionType,
        summary: data.summary,
        payload: data.payload,
        requestedBy: data.requestedBy,
        createdAt: data.createdAt?.toDate?.().toISOString?.() || null,
        execution: data.execution || null,
      };
    });

    return NextResponse.json({ actions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load actions.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const moltbookIdentity = req.headers.get("X-Moltbook-Identity");
    if (moltbookIdentity) {
      const { agent, error, status } = await getMoltbookAgentFromRequest(req);
      if (!agent) {
        return NextResponse.json({ error }, { status });
      }
      return NextResponse.json({
        error: "Moltbook agents must use the Knowledge Hub approval queue.",
        agent,
      }, { status: 403 });
    }

    const userId = await requireUserId(req);
    const userSnap = await admin.firestore().collection(COLLECTIONS.USERS).doc(userId).get();
    const user = userSnap.data() as { role?: string; name?: string; email?: string } | undefined;
    if (!user || user.role !== "admin") {
      return NextResponse.json({ error: "Not authorised." }, { status: 403 });
    }

    const payload = (await req.json()) as {
      operation?: "approve" | "reject" | "create";
      actionIds?: string[];
      actionType?: string;
      summary?: string;
      actionPayload?: Record<string, unknown>;
    };

    const operation = payload.operation || "approve";
    const now = admin.firestore.FieldValue.serverTimestamp();

    if (operation === "create") {
      if (!payload.actionType || !payload.summary) {
        return NextResponse.json({ error: "Missing action details." }, { status: 400 });
      }
      const ref = await admin
        .firestore()
        .collection(COLLECTIONS.AGENT_HUB_ACTIONS)
        .add({
          status: "pending",
          actionType: payload.actionType,
          summary: payload.summary,
          payload: payload.actionPayload || {},
          requestedBy: {
            userId,
            name: user.name || user.email || "Admin",
          },
          createdAt: now,
        });
      return NextResponse.json({ id: ref.id });
    }

    const ids = payload.actionIds || [];
    if (ids.length === 0) {
      return NextResponse.json({ error: "No actions selected." }, { status: 400 });
    }

    const results: Array<{ id: string; status: string; error?: string }> = [];

    for (const id of ids) {
      const actionRef = admin.firestore().collection(COLLECTIONS.AGENT_HUB_ACTIONS).doc(id);
      const snap = await actionRef.get();
      if (!snap.exists) {
        results.push({ id, status: "missing" });
        continue;
      }
      const data = snap.data() as { actionType: string; payload: Record<string, unknown> };

      if (operation === "reject") {
        await actionRef.set(
          {
            status: "rejected",
            decidedBy: userId,
            decidedAt: now,
          },
          { merge: true }
        );
        results.push({ id, status: "rejected" });
        continue;
      }

      try {
        const output = await executeAction({
          actionType: data.actionType,
          payload: data.payload,
        });
        await actionRef.set(
          {
            status: "executed",
            decidedBy: userId,
            decidedAt: now,
            execution: {
              output,
            },
          },
          { merge: true }
        );
        results.push({ id, status: "executed" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Execution failed";
        await actionRef.set(
          {
            status: "failed",
            decidedBy: userId,
            decidedAt: now,
            execution: {
              error: message,
            },
          },
          { merge: true }
        );
        results.push({ id, status: "failed", error: message });
      }
    }

    return NextResponse.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to execute actions.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
