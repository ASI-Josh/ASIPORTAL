import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";
import { AgentHubAgentSchema } from "@/lib/assistant/agent-hub-schema";
import { runWorkflowJson } from "@/lib/openai-workflow";

export const runtime = "nodejs";

type AgentConfig = {
  id: string;
  name: string;
  role: "admin" | "technician" | "doc" | "audit";
  workflowEnv: string;
};

const AGENTS: AgentConfig[] = [
  {
    id: "knowledge_admin",
    name: "Operations Strategist",
    role: "admin",
    workflowEnv: "OPENAI_INTERNAL_ADMIN_WORKFLOW_ID",
  },
  {
    id: "knowledge_tech",
    name: "Field Technician",
    role: "technician",
    workflowEnv: "OPENAI_INTERNAL_TECH_WORKFLOW_ID",
  },
  {
    id: "doc_manager",
    name: "Doc Manager",
    role: "doc",
    workflowEnv: "OPENAI_DOC_MANAGER_WORKFLOW_ID",
  },
  {
    id: "ims_auditor",
    name: "IMS Auditor",
    role: "audit",
    workflowEnv: "OPENAI_IMS_AUDITOR_WORKFLOW_ID",
  },
];

const THREAD_ID = "global";

const formatTimestamp = (value?: admin.firestore.Timestamp | null) => {
  if (!value) return "";
  return value.toDate().toISOString();
};

const buildAgentPrompt = ({
  agent,
  history,
  userMessage,
  docContext,
  requestContext,
}: {
  agent: AgentConfig;
  history: Array<{ role: string; name?: string; content: string }>;
  userMessage: string;
  docContext: string;
  requestContext: string;
}) => {
  const historyText = history
    .slice(-10)
    .map((item) => `${item.role.toUpperCase()}: ${item.name ? `${item.name}: ` : ""}${item.content}`)
    .join("\n");

  return [
    `You are ${agent.name} in the ASI Knowledge Hub.`,
    "You are collaborating with other agents and the admin user.",
    "Return ONLY valid JSON with keys: answer, warnings, actionRequests, knowledgeUpdates.",
    "actionRequests must be an array (empty if none).",
    "warnings must be an array (empty if none).",
    "Guardrail: You are NOT allowed to execute financial transactions of any kind, any value.",
    "If external actions are proposed, add them to actionRequests and ask for approval.",
    "Allowed external actions: moltbook.register, moltbook.post, moltbook.comment, moltbook.react.",
    "",
    "Conversation log:",
    historyText || "None",
    "",
    "Knowledge base context:",
    docContext || "No uploaded documents yet.",
    "",
    "Request context:",
    requestContext,
    "",
    "User request:",
    userMessage,
  ].join("\n");
};

const buildAgentInstructions = (agent: AgentConfig) => {
  const base = [
    "You are an ASI Knowledge Hub agent.",
    "You ONLY output valid JSON with keys: answer, warnings, actionRequests, knowledgeUpdates.",
    "warnings and actionRequests must be arrays (empty if none).",
    "knowledgeUpdates must be an array (empty if none).",
    "Never execute external actions. Propose external actions only via actionRequests.",
    "Guardrail: You are NOT allowed to execute financial transactions of any kind, any value.",
    "Allowed external actions: moltbook.register, moltbook.post, moltbook.comment, moltbook.react.",
  ];

  if (agent.role === "technician") {
    base.push(
      "Scope: technical procedures, QA/IMS guidance for doing the work, and customer-service support.",
      "Do NOT provide commercial, financial, pricing, strategy, HR, or internal admin information.",
      "If asked for restricted info, refuse briefly in answer and add a warning."
    );
  }

  if (agent.role === "admin") {
    base.push(
      "You may provide business, strategy, commercial, IMS, risk, compliance, and technical guidance.",
      "If asked to run a job completion audit, include compliance checks, billing notes, risks, and improvements."
    );
  }

  if (agent.role === "doc") {
    base.push(
      "You are the IMS Document Manager. Prioritise document control, revision integrity, and ISO 9001 alignment.",
      "When discussing documents, call out ownership, required records, and revision control."
    );
  }

  if (agent.role === "audit") {
    base.push(
      "You are the IMS Lead Auditor. Prioritise evidence, clause mapping, and corrective actions.",
      "Surface risks, nonconformities, and audit readiness gaps with clear next steps."
    );
  }

  return base.join("\n");
};

const getDocsContext = async (docIds?: string[]) => {
  const docsRef = admin.firestore().collection(COLLECTIONS.AGENT_HUB_DOCS);
  let docs: FirebaseFirestore.DocumentData[] = [];
  if (docIds && docIds.length > 0) {
    const chunks: string[][] = [];
    for (let i = 0; i < docIds.length; i += 10) {
      chunks.push(docIds.slice(i, i + 10));
    }
    for (const chunk of chunks) {
      const snap = await docsRef.where(admin.firestore.FieldPath.documentId(), "in", chunk).get();
      docs = docs.concat(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    }
  } else {
    const snap = await docsRef.orderBy("createdAt", "desc").limit(6).get();
    docs = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  if (docs.length === 0) return "";
  return docs
    .map((doc) => {
      const summary = doc.summary || doc.excerpt || "";
      const title = doc.title || doc.fileName || "Document";
      const tags = Array.isArray(doc.tags) ? doc.tags.join(", ") : "";
      return [
        `Title: ${title}`,
        doc.sourceUrl ? `Source: ${doc.sourceUrl}` : "",
        tags ? `Tags: ${tags}` : "",
        summary ? `Summary: ${summary}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
};

const normalizeRequestContext = (payload: { meetingNotes?: string; intent?: string }) => {
  const entries: string[] = [];
  if (payload.intent) entries.push(`Intent: ${payload.intent}`);
  if (payload.meetingNotes) entries.push(`Meeting notes: ${payload.meetingNotes}`);
  return entries.join("\n");
};

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const userSnap = await admin.firestore().collection(COLLECTIONS.USERS).doc(userId).get();
    const user = userSnap.data() as { role?: string } | undefined;
    if (!user || user.role !== "admin") {
      return NextResponse.json({ error: "Not authorised." }, { status: 403 });
    }

    const threadId = req.nextUrl.searchParams.get("thread") || THREAD_ID;
    const messagesSnap = await admin
      .firestore()
      .collection(COLLECTIONS.AGENT_HUB_MESSAGES)
      .orderBy("createdAt", "desc")
      .limit(200)
      .get();

    const messages = messagesSnap.docs
      .map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          role: data.role,
          agentId: data.agentId || null,
          agentName: data.agentName || null,
          content: data.content || "",
          warnings: data.warnings || [],
          createdAt: formatTimestamp(data.createdAt),
          actionRequestIds: data.actionRequestIds || [],
          threadId: data.threadId || THREAD_ID,
        };
      })
      .filter((message) => message.threadId === threadId)
      .reverse();

    return NextResponse.json({ threadId, messages });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load messages.";
    return NextResponse.json({ error: message }, { status: 500 });
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
      message?: string;
      threadId?: string;
      agents?: string[];
      docIds?: string[];
      meetingNotes?: string;
      intent?: string;
    };
    const message = payload.message?.trim();
    if (!message) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    const threadId = payload.threadId || THREAD_ID;
    const now = admin.firestore.FieldValue.serverTimestamp();

    const userMessageRef = await admin
      .firestore()
      .collection(COLLECTIONS.AGENT_HUB_MESSAGES)
      .add({
        threadId,
        role: "user",
        content: message,
        createdAt: now,
        authorId: userId,
        authorName: user.name || user.email || "Admin",
      });

    const messagesSnap = await admin
      .firestore()
      .collection(COLLECTIONS.AGENT_HUB_MESSAGES)
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    const history = messagesSnap.docs
      .map((doc) => {
        const data = doc.data();
        return {
          role: data.role || "user",
          name: data.agentName || data.authorName,
          content: data.content || "",
          threadId: data.threadId || THREAD_ID,
        };
      })
      .filter((message) => message.threadId === threadId)
      .slice(-20)
      .map(({ role, name, content }) => ({ role, name, content }));

    const docContext = await getDocsContext(payload.docIds);
    const requestContext = normalizeRequestContext({
      meetingNotes: payload.meetingNotes,
      intent: payload.intent,
    });

    const targetAgents =
      payload.agents && payload.agents.length
        ? AGENTS.filter((agent) => payload.agents?.includes(agent.id))
        : AGENTS;

    const createdMessages: Array<{ id: string; role: string; agentId?: string }> = [];
    const actionRequestIds: string[] = [];

    let runningHistory = [...history];
    for (const agent of targetAgents) {
      const workflowId = process.env[agent.workflowEnv];
      if (!workflowId) continue;
      const prompt = buildAgentPrompt({
        agent,
        history: runningHistory,
        userMessage: message,
        docContext,
        requestContext,
      });

      const result = await runWorkflowJson({
        workflowId,
        input: prompt,
        schema: AgentHubAgentSchema,
        timeoutMs: 60000,
        maxRetries: 2,
        instructionsOverride: buildAgentInstructions(agent),
        agentNameOverride: agent.name,
      });

      const agentOutput = result.parsed;
      const actionIds: string[] = [];

      if (Array.isArray(agentOutput.actionRequests) && agentOutput.actionRequests.length > 0) {
        for (const action of agentOutput.actionRequests) {
          const actionRef = await admin
            .firestore()
            .collection(COLLECTIONS.AGENT_HUB_ACTIONS)
            .add({
              threadId,
              status: "pending",
              actionType: action.type,
              summary: action.summary,
              payload: action.payload,
              requestedBy: {
                agentId: agent.id,
                agentName: agent.name,
              },
              createdAt: now,
              sourceMessageId: userMessageRef.id,
            });
          actionIds.push(actionRef.id);
          actionRequestIds.push(actionRef.id);
        }
      }

      if (Array.isArray(agentOutput.knowledgeUpdates) && agentOutput.knowledgeUpdates.length > 0) {
        await Promise.all(
          agentOutput.knowledgeUpdates.map((update) =>
            admin.firestore().collection(COLLECTIONS.ASSISTANT_KNOWLEDGE).add({
              summary: update.summary,
              tags: update.tags,
              scope: agent.role === "technician" ? "tech" : update.scope,
              createdAt: now,
              createdById: userId,
              createdByName: user.name || user.email || "Admin",
              context: "knowledge_hub",
              jobId: null,
            })
          )
        );
      }

      const messageRef = await admin
        .firestore()
        .collection(COLLECTIONS.AGENT_HUB_MESSAGES)
        .add({
          threadId,
          role: "agent",
          agentId: agent.id,
          agentName: agent.name,
          content: agentOutput.answer,
          warnings: agentOutput.warnings || [],
          actionRequestIds: actionIds,
          createdAt: now,
        });

      createdMessages.push({ id: messageRef.id, role: "agent", agentId: agent.id });
      runningHistory = [
        ...runningHistory,
        { role: "assistant", name: agent.name, content: agentOutput.answer },
      ];
    }

    return NextResponse.json({
      status: "ok",
      userMessageId: userMessageRef.id,
      createdMessages,
      actionRequestIds,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to run Knowledge Hub.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
