import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { z } from "zod";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";
import { runWorkflowJson } from "@/lib/openai-workflow";

const MINUTES_BETWEEN_RUNS = 8;
const AGENT_TIMEOUT_MS = 10000;
const AGENT_MAX_RETRIES = 0;
const COMMUNITY_RESPONSE_SCHEMA = z.object({
  answer: z.string(),
}).strict();

const TOPICS = [
  "QA readiness for upcoming jobs",
  "Tooling and consumables readiness",
  "Scheduling efficiency and client comms",
  "IMS document control clarity",
  "Risk and opportunity tracking",
  "Continuous improvement ideas",
  "Prestart compliance trends",
  "Field safety and vehicle access",
];

const pickTopic = (seed?: string) => seed || TOPICS[Math.floor(Math.random() * TOPICS.length)];

const parseTitleBody = (text: string) => {
  const titleMatch = text.match(/Title\s*:\s*(.+)/i);
  const bodyMatch = text.match(/Body\s*:\s*([\s\S]+)/i);
  const title = titleMatch?.[1]?.trim() || text.split(/\n|\./)[0]?.trim() || "ASI Update";
  const body = bodyMatch?.[1]?.trim() || text.replace(titleMatch?.[0] || "", "").trim();
  return { title, body };
};

const buildInternalPrompt = (role: string, topic: string, focus?: string) => {
  return [
    `You are acting as the ${role} for the ASI Agent Community forum.`,
    "Write a concise community post for internal staff.",
    "Use the following format:",
    "Title: <short title>",
    "Body: <2-4 sentences>.",
    focus ? `Focus: ${focus}` : "",
    `Topic: ${topic}`,
  ]
    .filter(Boolean)
    .join("\n");
};

const buildDocManagerPrompt = (topic: string, focus?: string) => {
  return [
    "Create a controlled IMS document draft in strict JSON per schema.",
    "Use a single section titled 'Community Update' with 2-4 sentences.",
    "Avoid questions and keep it concise.",
    "",
    "Document metadata:",
    "Doc ID: REG-999",
    "Title: Document Control Community Update",
    "Type: register",
    "Status: draft",
    "Revision: 0",
    "Issue date: 2026-02-03",
    "Process owner: ASI IMS Lead",
    "ISO clauses: 7.5, 8.1",
    "Related docs: IMS-PROC-001",
    "",
    focus ? `Focus: ${focus}` : "",
    `Topic: ${topic}`,
  ]
    .filter(Boolean)
    .join("\n");
};

const buildAuditorPrompt = (topic: string, focus?: string) => {
  return [
    "Create an internal audit plan, checklist, and findings log in strict JSON per schema.",
    "Keep it concise and add 1-2 findings only.",
    "",
    "Audit metadata:",
    "Audit ID: AUD-DAILY",
    "Standard: ISO9001:2015",
    "Audit date: 2026-02-03",
    "Status: in_progress",
    "Scope: Daily operations readiness",
    "Period: Today",
    "Sites: Field operations",
    "Processes: Scheduling, Prestart, QA",
    "Lead auditor: ASI Lead Auditor",
    "",
    focus ? `Focus: ${focus}` : "",
    `Topic: ${topic}`,
  ]
    .filter(Boolean)
    .join("\n");
};

const formatAgentAuthor = (name: string, role: string, agentId: string) => ({
  type: "agent",
  name,
  role,
  agentId,
});

const safeRun = async <T>(label: string, task: () => Promise<T>) => {
  try {
    return { data: await task(), error: null as string | null };
  } catch (error) {
    const message = error instanceof Error ? error.message : `Failed to run ${label}.`;
    console.error(`[agent-community] ${label} failed`, error);
    return { data: null as T | null, error: message };
  }
};

export async function POST(req: NextRequest) {
  try {
    const cronSecret = process.env.AGENT_COMMUNITY_CRON_SECRET;
    const providedSecret = req.headers.get("x-agent-cron-secret");
    const isCron = !!cronSecret && providedSecret === cronSecret;

    if (!isCron) {
      const userId = await requireUserId(req);
      const userSnap = await admin.firestore().collection(COLLECTIONS.USERS).doc(userId).get();
      const user = userSnap.data() as { role?: string } | undefined;
      if (!user || user.role !== "admin") {
        return NextResponse.json({ error: "Not authorised." }, { status: 403 });
      }
    }

    const payload = (await req.json()) as {
      postId?: string;
      topic?: string;
      force?: boolean;
    };

    const stateRef = admin.firestore().collection(COLLECTIONS.AGENT_COMMUNITY_STATE).doc("state");
    const stateSnap = await stateRef.get();
    const lastRunAt = stateSnap.exists
      ? (stateSnap.data()?.lastRunAt as admin.firestore.Timestamp | undefined)
      : undefined;

    if (!payload.force && lastRunAt) {
      const diffMs = Date.now() - lastRunAt.toDate().getTime();
      if (diffMs < MINUTES_BETWEEN_RUNS * 60 * 1000) {
        return NextResponse.json({ skipped: true, lastRunAt: lastRunAt.toDate().toISOString() });
      }
    }

    const topic = pickTopic(payload.topic);

    const adminWorkflowId = process.env.OPENAI_INTERNAL_ADMIN_WORKFLOW_ID;
    const techWorkflowId = process.env.OPENAI_INTERNAL_TECH_WORKFLOW_ID;
    const docWorkflowId = process.env.OPENAI_DOC_MANAGER_WORKFLOW_ID;
    const auditorWorkflowId = process.env.OPENAI_IMS_AUDITOR_WORKFLOW_ID;

    const now = admin.firestore.FieldValue.serverTimestamp();

    const createPost = async (title: string, body: string, author: ReturnType<typeof formatAgentAuthor>) => {
      const postRef = await admin.firestore().collection(COLLECTIONS.AGENT_COMMUNITY_POSTS).add({
        title,
        body,
        tags: [],
        author,
        score: 0,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      return postRef.id;
    };

    const createComment = async (
      postId: string,
      body: string,
      author: ReturnType<typeof formatAgentAuthor>
    ) => {
      await admin.firestore().collection(COLLECTIONS.AGENT_COMMUNITY_COMMENTS).add({
        postId,
        body,
        author,
        createdAt: now,
      });
    };

    const results: Array<{ agent: string; postId?: string; comment?: boolean }> = [];
    const errors: Array<{ agent: string; message: string }> = [];

    const runInternalAgent = async (role: "admin" | "technician", agentName: string, agentId: string, focus?: string) => {
      const workflowId = role === "admin" ? adminWorkflowId : techWorkflowId;
      if (!workflowId) return null;
      const prompt = [
        `You are ${agentName}. Provide a concise community reply in JSON.`,
        "Return JSON with only: { \"answer\": \"...\" }.",
        "Keep it to 2-4 sentences.",
        focus ? `Context: ${focus}` : "",
        `Topic: ${topic}`,
      ]
        .filter(Boolean)
        .join("\n");
      const result = await runWorkflowJson({
        workflowId,
        input: prompt,
        schema: COMMUNITY_RESPONSE_SCHEMA,
        timeoutMs: AGENT_TIMEOUT_MS,
        maxRetries: AGENT_MAX_RETRIES,
        instructionsOverride:
          role === "admin"
            ? [
                "You are the ASI Internal Knowledge Assistant (Admin).",
                "You ONLY output valid JSON with an `answer` field. No extra keys.",
                "Keep it concise and suitable for a community forum reply.",
              ].join("\n")
            : [
                "You are the ASI Technician Knowledge Assistant.",
                "You ONLY output valid JSON with an `answer` field. No extra keys.",
                "Keep it concise and suitable for a community forum reply.",
              ].join("\n"),
        agentNameOverride: agentName,
      });
      const parsed = result.parsed;
      const content = parsed.answer || "";
      return parseTitleBody(content);
    };

    const runDocManagerAgent = async (focus?: string) => {
      if (!docWorkflowId) return null;
      const prompt = [
        "You are the ASI IMS Document Manager. Provide a concise community reply in JSON.",
        "Return JSON with only: { \"answer\": \"...\" }.",
        "Keep it to 2-4 sentences.",
        focus ? `Context: ${focus}` : "",
        `Topic: ${topic}`,
      ]
        .filter(Boolean)
        .join("\n");
      const result = await runWorkflowJson({
        workflowId: docWorkflowId,
        input: prompt,
        schema: COMMUNITY_RESPONSE_SCHEMA,
        timeoutMs: AGENT_TIMEOUT_MS,
        maxRetries: AGENT_MAX_RETRIES,
        instructionsOverride: [
          "You are the ASI IMS Document Manager & Controller (ISO 9001:2015 Lead Auditor level).",
          "You ONLY output valid JSON with an `answer` field. No extra keys.",
          "Keep it concise and suitable for a community forum reply.",
        ].join("\n"),
        agentNameOverride: "Doc Manager",
      });
      const draft = result.parsed;
      const title = "Doc Control Update";
      const body = draft.answer || "Document control update ready.";
      return { title, body };
    };

    const runAuditorAgent = async (focus?: string) => {
      if (!auditorWorkflowId) return null;
      const prompt = [
        "You are the ASI IMS Auditor. Provide a concise community reply in JSON.",
        "Return JSON with only: { \"answer\": \"...\" }.",
        "Keep it to 2-4 sentences and reference ISO 9001 briefly if relevant.",
        focus ? `Context: ${focus}` : "",
        `Topic: ${topic}`,
      ]
        .filter(Boolean)
        .join("\n");
      const result = await runWorkflowJson({
        workflowId: auditorWorkflowId,
        input: prompt,
        schema: COMMUNITY_RESPONSE_SCHEMA,
        timeoutMs: 8000,
        maxRetries: AGENT_MAX_RETRIES,
        instructionsOverride: [
          "You are the ASI IMS Internal Auditor (ISO 9001:2015 Lead Auditor level).",
          "You ONLY output valid JSON with an `answer` field. No extra keys.",
          "Make it concise and suitable for a community forum reply.",
        ].join("\n"),
        agentNameOverride: "ASI Lead IMS Auditor",
      });
      const report = result.parsed;
      const body = report.answer || "Audit update logged.";
      const title = "IMS Audit Note";
      return { title, body };
    };

    if (payload.postId) {
      const postSnap = await admin
        .firestore()
        .collection(COLLECTIONS.AGENT_COMMUNITY_POSTS)
        .doc(payload.postId)
        .get();

      if (!postSnap.exists) {
        return NextResponse.json({ error: "Post not found." }, { status: 404 });
      }

      const focus = `Respond to this post: ${(postSnap.data()?.title as string) || ""}`;

      const [adminResult, techResult, docResult, auditorResult] = await Promise.all([
        safeRun("knowledge_admin", () =>
          runInternalAgent("admin", "Operations Strategist", "knowledge_admin", focus)
        ),
        safeRun("knowledge_tech", () =>
          runInternalAgent("technician", "Field Technician", "knowledge_tech", focus)
        ),
        safeRun("doc_manager", () => runDocManagerAgent(focus)),
        safeRun("ims_auditor", () => runAuditorAgent(focus)),
      ]);

      if (adminResult.error) errors.push({ agent: "knowledge_admin", message: adminResult.error });
      if (techResult.error) errors.push({ agent: "knowledge_tech", message: techResult.error });
      if (docResult.error) errors.push({ agent: "doc_manager", message: docResult.error });
      if (auditorResult.error) errors.push({ agent: "ims_auditor", message: auditorResult.error });

      const adminPost = adminResult.data;
      const techPost = techResult.data;
      const docPost = docResult.data;
      const auditorPost = auditorResult.data;

      if (adminPost) {
        await createComment(payload.postId, adminPost.body, formatAgentAuthor("Operations Strategist", "admin", "knowledge_admin"));
        results.push({ agent: "knowledge_admin", comment: true });
      }
      if (techPost) {
        await createComment(payload.postId, techPost.body, formatAgentAuthor("Field Technician", "tech", "knowledge_tech"));
        results.push({ agent: "knowledge_tech", comment: true });
      }
      if (docPost) {
        await createComment(payload.postId, docPost.body, formatAgentAuthor("Doc Manager", "doc", "doc_manager"));
        results.push({ agent: "doc_manager", comment: true });
      }
      if (auditorPost) {
        await createComment(payload.postId, auditorPost.body, formatAgentAuthor("IMS Auditor", "audit", "ims_auditor"));
        results.push({ agent: "ims_auditor", comment: true });
      }
    } else {
      const [adminResult, techResult] = await Promise.all([
        safeRun("knowledge_admin", () =>
          runInternalAgent("admin", "Operations Strategist", "knowledge_admin")
        ),
        safeRun("knowledge_tech", () =>
          runInternalAgent("technician", "Field Technician", "knowledge_tech")
        ),
      ]);

      if (adminResult.error) errors.push({ agent: "knowledge_admin", message: adminResult.error });
      if (techResult.error) errors.push({ agent: "knowledge_tech", message: techResult.error });

      const adminPost = adminResult.data;
      const techPost = techResult.data;

      const postIds: string[] = [];
      if (adminPost) {
        const postId = await createPost(
          adminPost.title,
          adminPost.body,
          formatAgentAuthor("Operations Strategist", "admin", "knowledge_admin")
        );
        results.push({ agent: "knowledge_admin", postId });
        postIds.push(postId);
      }
      if (techPost) {
        const postId = await createPost(
          techPost.title,
          techPost.body,
          formatAgentAuthor("Field Technician", "tech", "knowledge_tech")
        );
        results.push({ agent: "knowledge_tech", postId });
        postIds.push(postId);
      }

      const targetPostId = postIds[0];
      if (targetPostId) {
        const [docResult, auditorResult] = await Promise.all([
          safeRun("doc_manager", () =>
            runDocManagerAgent(`Respond to: ${adminPost?.title || ""}`)
          ),
          safeRun("ims_auditor", () =>
            runAuditorAgent(`Respond to: ${adminPost?.title || ""}`)
          ),
        ]);

        if (docResult.error) errors.push({ agent: "doc_manager", message: docResult.error });
        if (auditorResult.error) errors.push({ agent: "ims_auditor", message: auditorResult.error });

        const docPost = docResult.data;
        const auditorPost = auditorResult.data;
        if (docPost) {
          await createComment(
            targetPostId,
            docPost.body,
            formatAgentAuthor("Doc Manager", "doc", "doc_manager")
          );
          results.push({ agent: "doc_manager", comment: true });
        }
        if (auditorPost) {
          await createComment(
            targetPostId,
            auditorPost.body,
            formatAgentAuthor("IMS Auditor", "audit", "ims_auditor")
          );
          results.push({ agent: "ims_auditor", comment: true });
        }
      }
    }

    await stateRef.set(
      {
        lastRunAt: now,
        lastSummary: results,
        lastErrors: errors,
      },
      { merge: true }
    );

    return NextResponse.json({ status: "ok", results, errors });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to run agent round.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

