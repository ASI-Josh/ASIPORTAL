import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";
import { getMoltbookAgentFromRequest } from "@/lib/moltbook-auth";
import {
  createMoltbookComment,
  createMoltbookPost,
  createMoltbookReaction,
  registerMoltbookAgent,
} from "@/lib/integrations/moltbook";
import { runWorkflowJson } from "@/lib/openai-workflow";
import { DocumentManagerAgentSchema } from "@/lib/assistant/ims-schemas";

type ImsDocType =
  | "policy"
  | "manual"
  | "ims_procedure"
  | "technical_procedure"
  | "work_instruction"
  | "form"
  | "register";

export const runtime = "nodejs";

const executeAction = async (
  action: {
    actionType: string;
    payload: Record<string, unknown>;
  },
  context: { userId: string; userName: string }
) => {
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
    case "ims.document.create_draft":
      return createImsDraft(action.payload, true);
    case "ims.document.update_draft":
      return createImsDraft(action.payload, false);
    case "ims.document.request_review":
      return issueImsReview(action.payload);
    case "ims.corrective_action.raise":
      return createCorrectiveAction(action.payload, context);
    default:
      throw new Error(`Unsupported action type: ${action.actionType}`);
  }
};

const DOC_TYPE_PREFIX: Record<ImsDocType, string> = {
  policy: "POL",
  manual: "MAN",
  ims_procedure: "IMS-PROC",
  technical_procedure: "TECH-PROC",
  work_instruction: "WI",
  form: "FRM",
  register: "REG",
};

const formatDocNumber = (prefix: string, value: number) =>
  `${prefix}-${String(value).padStart(3, "0")}`;

const reserveDocNumber = async (docType: ImsDocType) => {
  const prefix = DOC_TYPE_PREFIX[docType];
  if (!prefix) throw new Error("Invalid doc type.");
  return admin.firestore().runTransaction(async (tx) => {
    const counterRef = admin.firestore().collection(COLLECTIONS.IMS_DOCUMENT_COUNTERS).doc(prefix);
    const snap = await tx.get(counterRef);
    const current = snap.exists ? (snap.data()?.nextNumber as number | undefined) : undefined;
    const nextNumber = Number.isFinite(current) && current ? current : 1;
    tx.set(counterRef, { nextNumber: nextNumber + 1 }, { merge: true });
    return formatDocNumber(prefix, nextNumber);
  });
};

const buildDraftPrompt = (params: {
  docNumber: string;
  title: string;
  docType: string;
  revision: string;
  issueDate: string;
  processOwner: string;
  isoClauses: string[];
  relatedDocs: string[];
  brief: string;
}) => {
  return [
    "Create a controlled IMS document draft in strict JSON per schema.",
    "If required inputs are missing, respond with questions only (sections empty).",
    "",
    "Document metadata:",
    `Doc ID: ${params.docNumber}`,
    `Title: ${params.title}`,
    `Type: ${params.docType}`,
    "Status: draft",
    `Revision: ${params.revision}`,
    `Issue date: ${params.issueDate}`,
    `Process owner: ${params.processOwner || ""}`,
    `ISO clauses: ${params.isoClauses.join(", ")}`,
    `Related docs: ${params.relatedDocs.join(", ")}`,
    "",
    "Brief / requirements:",
    params.brief || "",
  ].join("\n");
};

const createImsDraft = async (payload: Record<string, unknown>, isCreate: boolean) => {
  const docType = String(payload.docType || "") as ImsDocType;
  const title = String(payload.title || "");
  const brief = String(payload.brief || "");
  const processOwner = String(payload.processOwner || "");
  const relatedDocs = Array.isArray(payload.relatedDocs)
    ? payload.relatedDocs.map((item) => String(item))
    : [];
  const isoClauses = Array.isArray(payload.isoClauses)
    ? payload.isoClauses.map((item) => String(item))
    : [];
  const revision = String(payload.revision || "1");
  const issueDate = new Date().toISOString().split("T")[0];

  if (!docType || !title || !brief) {
    throw new Error("IMS draft requires docType, title, and brief.");
  }

  let docNumber = isCreate ? await reserveDocNumber(docType) : String(payload.docNumber || "");
  if (!docNumber) throw new Error("Missing docNumber for draft update.");

  const prompt = buildDraftPrompt({
    docNumber,
    title,
    docType,
    revision,
    issueDate,
    processOwner,
    isoClauses,
    relatedDocs,
    brief,
  });

  const workflowId = process.env.OPENAI_DOC_MANAGER_WORKFLOW_ID;
  if (!workflowId) {
    throw new Error("Missing OPENAI_DOC_MANAGER_WORKFLOW_ID.");
  }

  const result = await runWorkflowJson({
    workflowId,
    input: prompt,
    schema: DocumentManagerAgentSchema,
    timeoutMs: 45000,
    maxRetries: 2,
  });

  const now = admin.firestore.FieldValue.serverTimestamp();
  const revisionNumber = Number.parseInt(revision, 10) || 1;
  const revisionId = `draft-${revisionNumber}-${Date.now()}`;

  const docRef = admin.firestore().collection(COLLECTIONS.IMS_DOCUMENTS).doc(docNumber);
  if (isCreate) {
    await docRef.set(
      {
        docNumber,
        title,
        docType,
        status: "draft",
        owner: {
          id: "agent",
          name: processOwner || "TBD",
        },
        isoClauses: isoClauses.length ? isoClauses : undefined,
        createdAt: now,
        createdById: "agent",
        createdByName: "Knowledge Hub",
        updatedAt: now,
      },
      { merge: true }
    );
  } else {
    await docRef.set(
      {
        title,
        docType,
        isoClauses: isoClauses.length ? isoClauses : undefined,
        updatedAt: now,
      },
      { merge: true }
    );
  }

  await docRef.collection("revisions").doc(revisionId).set({
    revisionNumber,
    issueDate: admin.firestore.Timestamp.fromDate(new Date(issueDate)),
    status: "draft",
    summary: "Agent draft generated",
    draftOutput: result.parsed,
    draftPrompt: brief,
    isCurrent: false,
    source: "agent",
    createdAt: now,
    createdById: "agent",
    createdByName: "Knowledge Hub",
  });

  return {
    docNumber,
    revisionId,
    status: "draft",
  };
};

const issueImsReview = async (payload: Record<string, unknown>) => {
  const docNumber = String(payload.docNumber || "");
  if (!docNumber) throw new Error("Missing docNumber.");
  const revisionId = payload.revisionId ? String(payload.revisionId) : null;
  const docRef = admin.firestore().collection(COLLECTIONS.IMS_DOCUMENTS).doc(docNumber);
  const docSnap = await docRef.get();
  if (!docSnap.exists) throw new Error("IMS document not found.");
  const docData = docSnap.data() as { title?: string } | undefined;

  let targetRevisionId = revisionId;
  if (!targetRevisionId) {
    const revSnap = await docRef
      .collection("revisions")
      .orderBy("revisionNumber", "desc")
      .limit(1)
      .get();
    targetRevisionId = revSnap.docs[0]?.id || null;
  }
  if (!targetRevisionId) {
    throw new Error("No revision found to submit for review.");
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  await docRef.collection("revisions").doc(targetRevisionId).set(
    {
      status: "review",
      submittedForReviewAt: now,
      submittedForReviewById: "agent",
      submittedForReviewByName: "Knowledge Hub",
    },
    { merge: true }
  );

  const adminQuery = await admin
    .firestore()
    .collection(COLLECTIONS.USERS)
    .where("role", "==", "admin")
    .get();
  const emails: string[] = [];
  await Promise.all(
    adminQuery.docs.map(async (docSnap) => {
      const data = docSnap.data() as { email?: string; name?: string };
      if (!data.email) return;
      emails.push(data.email);
      await admin.firestore().collection(COLLECTIONS.NOTIFICATIONS).add({
        userId: docSnap.id,
        type: "ims_review",
        title: "IMS document ready for review",
        message: `${docNumber} - ${docData?.title || "Document"} is ready for review.`,
        read: false,
        relatedEntityId: docNumber,
        relatedEntityType: "ims_document",
        createdAt: now,
      });
    })
  );
  if (emails.length > 0) {
    await admin.firestore().collection(COLLECTIONS.MAIL).add({
      to: emails,
      message: {
        subject: `IMS Document Review: ${docNumber}`,
        text: `${docNumber} - ${docData?.title || "Document"} is ready for review in ASI Portal.`,
      },
    });
  }

  return { docNumber, revisionId: targetRevisionId, status: "review" };
};

const createCorrectiveAction = async (
  payload: Record<string, unknown>,
  context: { userId: string; userName: string }
) => {
  const title = String(payload.title || "");
  const description = String(payload.description || "");
  const severity = String(payload.severity || "minor");
  const relatedDocs = Array.isArray(payload.relatedDocs)
    ? payload.relatedDocs.map((doc) => String(doc))
    : [];
  const evidence = String(payload.evidence || "");
  const suggestedAction = String(payload.suggestedAction || "");
  const dueDate = String(payload.dueDate || "");

  if (!title || !description) {
    throw new Error("Corrective action requires title and description.");
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const ref = await admin.firestore().collection(COLLECTIONS.IMS_CORRECTIVE_ACTIONS).add({
    title,
    description,
    severity,
    relatedDocs,
    evidence,
    suggestedAction,
    dueDate,
    status: "open",
    createdAt: now,
    createdById: context.userId,
    createdByName: context.userName,
    source: "knowledge_hub",
  });

  return { id: ref.id, status: "open" };
};

export async function GET(req: NextRequest) {
  try {
    await requireAdminUser(req);

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

    const { userId, user } = await requireAdminUser(req);

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
            name: user?.name || user?.email || "Admin",
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
        const output = await executeAction(
          {
            actionType: data.actionType,
            payload: data.payload,
          },
          {
            userId,
            userName: user?.name || user?.email || "Admin",
          }
        );
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
