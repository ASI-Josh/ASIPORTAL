import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";
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

const formatTimestamp = (value?: admin.firestore.Timestamp | string | Date | null) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof (value as admin.firestore.Timestamp).toDate === "function") {
    return (value as admin.firestore.Timestamp).toDate().toISOString();
  }
  return "";
};

const buildAgentPrompt = ({
  agent,
  history,
  userMessage,
  docContext,
  requestContext,
  imsContext,
}: {
  agent: AgentConfig;
  history: Array<{ role: string; name?: string; content: string }>;
  userMessage: string;
  docContext: string;
  requestContext: string;
  imsContext: string;
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
    "Only propose external actionRequests if the user explicitly asks and the intent is Awareness/non-work.",
    "For IMS drafting, you may propose: ims.document.create_draft, ims.document.update_draft, ims.document.request_review (approval required).",
    "If you include actionRequests, include all payload fields. Use empty strings or null for non-applicable values. Use [] for tags.",
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
    "IMS register context:",
    imsContext || "No IMS register data loaded.",
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
    "Only propose external actionRequests if the user explicitly asks and the intent is Awareness/non-work.",
    "For IMS drafting, you may propose: ims.document.create_draft, ims.document.update_draft, ims.document.request_review (approval required).",
    "If you include actionRequests, include all payload fields. Use empty strings or null for non-applicable values. Use [] for tags.",
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

const IMS_POLICIES = ["Quality Policy", "Environmental Policy", "Safety Policy"];

const IMS_PROCEDURES = [
  "Context & Interested Parties",
  "Scope & Process Mapping",
  "Leadership & Commitment",
  "Risk & Opportunity Management",
  "Quality Objectives & Planning",
  "Document Control",
  "Control of Records",
  "Competence, Training & Awareness",
  "Communication",
  "Operational Planning & Control",
  "Customer Requirements Review",
  "Design & Development (if applicable)",
  "Control of External Providers",
  "Production & Service Provision",
  "Identification & Traceability",
  "Property Belonging to Customers",
  "Preservation & Handling",
  "Monitoring & Measurement Resources",
  "Release of Products & Services",
  "Nonconforming Outputs",
  "Performance Evaluation & KPI Review",
  "Internal Audit",
  "Management Review",
  "Corrective Action",
  "Continual Improvement",
  "Change Management",
];

const TECHNICAL_PROCEDURES = [
  "Crack Repair",
  "Scratch Removal",
  "Trim Repair",
  "Film Installation",
  "Lens Restoration",
];

const getImsContext = async () => {
  const docsSnap = await admin
    .firestore()
    .collection(COLLECTIONS.IMS_DOCUMENTS)
    .orderBy("docNumber", "asc")
    .get();

  const docs = docsSnap.docs.map((doc) => doc.data() as any);
  const counts = {
    total: docs.length,
    draft: docs.filter((d) => d.status === "draft").length,
    active: docs.filter((d) => d.status === "active").length,
    obsolete: docs.filter((d) => d.status === "obsolete").length,
  };

  const registeredTitles = new Set(
    docs.map((doc) => String(doc.title || "").toLowerCase().trim())
  );

  const expected = [
    ...IMS_POLICIES.map((title) => ({ type: "policy", title })),
    ...IMS_PROCEDURES.map((title) => ({ type: "ims_procedure", title })),
    ...TECHNICAL_PROCEDURES.map((title) => ({ type: "technical_procedure", title })),
  ];

  const missing = expected.filter(
    (item) => !registeredTitles.has(item.title.toLowerCase())
  );

  const registerLines = docs.slice(0, 60).map((doc) => {
    const iso = Array.isArray(doc.isoClauses) ? doc.isoClauses.join(", ") : "";
    const owner = doc.owner?.name || doc.owner?.email || "";
    const revision = doc.currentRevisionNumber ?? "-";
    return `- ${doc.docNumber} | ${doc.title} | ${doc.docType} | ${doc.status} | Rev ${revision} | Owner: ${owner} | ISO: ${iso}`;
  });

  return [
    `IMS Register summary: total ${counts.total}, draft ${counts.draft}, active ${counts.active}, obsolete ${counts.obsolete}.`,
    "Existing documents:",
    registerLines.length ? registerLines.join("\n") : "None yet.",
    "",
    "Expected (from IMS hub structure):",
    expected.map((item) => `- ${item.type}: ${item.title}`).join("\n"),
    "",
    "Missing (not found in register):",
    missing.length ? missing.map((item) => `- ${item.type}: ${item.title}`).join("\n") : "None.",
    "",
    "IMS Doc Manager location: /dashboard/ims/doc-manager",
  ].join("\n");
};

const normalizeRequestContext = (payload: { meetingNotes?: string; intent?: string }) => {
  const entries: string[] = [];
  if (payload.intent) entries.push(`Intent: ${payload.intent}`);
  if (payload.meetingNotes) entries.push(`Meeting notes: ${payload.meetingNotes}`);
  return entries.join("\n");
};

export async function GET(req: NextRequest) {
  try {
    await requireAdminUser(req);

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
    const status = message.toLowerCase().includes("authorization") ? 401 : 500;
    console.error("Knowledge hub GET failed", error);
    return NextResponse.json(
      { error: message, detail: error instanceof Error ? error.stack : null },
      { status }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId, user } = await requireAdminUser(req);

    let payload: {
      message?: string;
      threadId?: string;
      threadTitle?: string;
      agents?: string[];
      docIds?: string[];
      meetingNotes?: string;
      intent?: string;
      allowExternalActions?: boolean;
    };
    try {
      payload = (await req.json()) as typeof payload;
    } catch (error) {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }
    const message = payload.message?.trim();
    if (!message) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    let threadId = payload.threadId || THREAD_ID;
    const now = admin.firestore.FieldValue.serverTimestamp();
    const allowExternalActions = Boolean(payload.allowExternalActions);
    const intentText = `${payload.intent || ""} ${message}`.toLowerCase();
    const isAwareness = intentText.includes("awareness") || intentText.includes("non-work") || intentText.includes("personal");

    if (threadId === THREAD_ID) {
      const title = payload.threadTitle?.trim() || message.slice(0, 60) || "New conversation";
      const threadRef = await admin.firestore().collection(COLLECTIONS.AGENT_HUB_THREADS).add({
        title,
        createdAt: now,
        updatedAt: now,
        lastMessage: "",
        createdById: userId,
        createdByName: user?.name || user?.email || "Admin",
      });
      threadId = threadRef.id;
    }

    const userMessageRef = await admin
      .firestore()
      .collection(COLLECTIONS.AGENT_HUB_MESSAGES)
      .add({
        threadId,
        role: "user",
        content: message,
        createdAt: now,
        authorId: userId,
        authorName: user?.name || user?.email || "Admin",
      });
    await admin.firestore().collection(COLLECTIONS.AGENT_HUB_THREADS).doc(threadId).set(
      {
        updatedAt: now,
        lastMessage: message,
      },
      { merge: true }
    );

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
    const imsContext = await getImsContext();
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

    const agentTimeoutMs = Number(process.env.AGENT_HUB_TIMEOUT_MS || "60000");
    const agentRetries = Number(process.env.AGENT_HUB_MAX_RETRIES || "2");

    const agentTasks = targetAgents.map(async (agent) => {
      const workflowId = process.env[agent.workflowEnv];
      if (!workflowId) return;
      try {
        const prompt = buildAgentPrompt({
          agent,
          history,
          userMessage: message,
          docContext,
          requestContext,
          imsContext,
        });

        const [{ runWorkflowJson }, { AgentHubAgentSchema }] = await Promise.all([
          import("@/lib/openai-workflow"),
          import("@/lib/assistant/agent-hub-schema"),
        ]);

        const result = await runWorkflowJson({
          workflowId,
          input: prompt,
          schema: AgentHubAgentSchema,
          timeoutMs: agentTimeoutMs,
          maxRetries: agentRetries,
          instructionsOverride: buildAgentInstructions(agent),
          agentNameOverride: agent.name,
        });

        const agentOutput = result.parsed;
        const actionIds: string[] = [];

        const shouldAllowActions = allowExternalActions && isAwareness;
        if (Array.isArray(agentOutput.actionRequests) && agentOutput.actionRequests.length > 0) {
          if (!shouldAllowActions) {
            const warning = allowExternalActions
              ? "External actions are restricted to Awareness/non-work rounds."
              : "External actions are disabled for this round.";
            agentOutput.warnings = Array.isArray(agentOutput.warnings)
              ? [...agentOutput.warnings, warning]
              : [warning];
          }
        }

        if (Array.isArray(agentOutput.actionRequests) && agentOutput.actionRequests.length > 0 && shouldAllowActions) {
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
                createdByName: user?.name || user?.email || "Admin",
                context: "knowledge_hub",
                jobId: null,
              })
            )
          );
        }

        const answer = typeof agentOutput.answer === "string" ? agentOutput.answer : "Agent response unavailable.";
        const messageRef = await admin
          .firestore()
          .collection(COLLECTIONS.AGENT_HUB_MESSAGES)
          .add({
            threadId,
            role: "agent",
            agentId: agent.id,
            agentName: agent.name,
            content: answer,
            warnings: agentOutput.warnings || [],
            actionRequestIds: actionIds,
            createdAt: now,
          });

        createdMessages.push({ id: messageRef.id, role: "agent", agentId: agent.id });
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Agent request failed.";
        const messageRef = await admin
          .firestore()
          .collection(COLLECTIONS.AGENT_HUB_MESSAGES)
          .add({
            threadId,
            role: "agent",
            agentId: agent.id,
            agentName: agent.name,
            content: `Agent request failed: ${messageText}`,
            warnings: [messageText],
            actionRequestIds: [],
            createdAt: now,
          });
        createdMessages.push({ id: messageRef.id, role: "agent", agentId: agent.id });
      }
    });

    await Promise.allSettled(agentTasks);

    return NextResponse.json({
      status: "ok",
      userMessageId: userMessageRef.id,
      createdMessages,
      actionRequestIds,
      threadId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to run Knowledge Hub.";
    const status = message.toLowerCase().includes("authorization") ? 401 : 500;
    console.error("Knowledge hub POST failed", error);
    return NextResponse.json(
      { error: message, detail: error instanceof Error ? error.stack : null },
      { status }
    );
  }
}
