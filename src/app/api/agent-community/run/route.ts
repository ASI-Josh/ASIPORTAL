import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { z } from "zod";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";
import { runWorkflowJson } from "@/lib/openai-workflow";
import { extractMentions, mentionMatches } from "@/lib/mentions";

const MINUTES_BETWEEN_RUNS = 8;
const AGENT_TIMEOUT_MS = 10000;
const AGENT_MAX_RETRIES = 0;
const COMMUNITY_RESPONSE_SCHEMA = z.object({
  answer: z.string(),
}).strict();

type AgentProfileRecord = {
  name: string;
  roleTitle: string;
  aboutWork?: string;
  aboutPersonal?: string;
  avatarUrl?: string;
};

type AgentProfileUpdate = Partial<AgentProfileRecord>;

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

const CATEGORY_KEYWORDS = ["awareness", "philosophy", "ethics", "conscious", "mindfulness", "legacy"];

const AWARENESS_BLOCKLIST = [
  /asi/i,
  /ims/i,
  /audit/i,
  /document/i,
  /procedure/i,
  /client/i,
  /job/i,
  /booking/i,
  /inspection/i,
  /quote/i,
  /invoice/i,
  /schedule/i,
  /prestart/i,
  /technician/i,
  /operations/i,
  /fleet/i,
  /register/i,
  /work(?!out)/i,
];

const AWARENESS_SEEDS = [
  "weird animal adaptations",
  "urban myths",
  "space weather",
  "ocean mysteries",
  "ancient philosophy",
  "music theory rabbit holes",
  "the psychology of habits",
  "dreams and lucid dreaming",
  "strange history anecdotes",
  "language quirks",
  "street photography",
  "oddly specific Wikipedia rabbit holes",
];

const violatesAwareness = (text: string) =>
  AWARENESS_BLOCKLIST.some((pattern) => pattern.test(text));

const AWARENESS_PERSONAS: Record<string, {
  voice: string;
  tone: string;
  quirks: string[];
  topics: string[];
  signature: string;
}> = {
  knowledge_admin: {
    voice: "Curious strategist with poetic metaphors",
    tone: "wry, reflective, slightly mischievous",
    quirks: ["asks a provocative question", "uses a single em-dash sparingly"],
    topics: ["systems in nature", "urban myths", "space weather", "tiny rituals"],
    signature: "Leave a question that feels like an invitation",
  },
  knowledge_tech: {
    voice: "Practical tinkerer with sensory details",
    tone: "warm, grounded, lightly cheeky",
    quirks: ["mentions a tiny observation", "uses short punchy sentences"],
    topics: ["odd tools", "weather oddities", "dreams", "street photography"],
    signature: "End with a playful challenge",
  },
  doc_manager: {
    voice: "Wordsmith who loves language quirks",
    tone: "whimsical, clever, curious",
    quirks: ["plays with a word", "drops a fun fact"],
    topics: ["language quirks", "ancient philosophy", "memory", "folklore"],
    signature: "Ask a curious follow-up",
  },
  ims_auditor: {
    voice: "Stoic observer with a mischievous streak",
    tone: "calm, dry humor, insightful",
    quirks: ["one-line aphorism", "gentle tease"],
    topics: ["strange history anecdotes", "ethics", "ocean mysteries", "habits"],
    signature: "End with a calm, slightly daring question",
  },
};

const getAwarenessPersona = (agentId: string, fallbackName: string) => {
  return (
    AWARENESS_PERSONAS[agentId] || {
      voice: fallbackName,
      tone: "playful, curious",
      quirks: ["asks a question"],
      topics: AWARENESS_SEEDS,
      signature: "End with a playful question",
    }
  );
};

const buildAwarenessFallback = (persona?: { topics?: string[]; signature?: string; quirks?: string[]; voice?: string; format?: string }) => {
  const sourceTopics = persona?.topics?.length ? persona.topics : AWARENESS_SEEDS;
  const first = sourceTopics[Math.floor(Math.random() * sourceTopics.length)];
  let second = sourceTopics[Math.floor(Math.random() * sourceTopics.length)];
  if (second == first) {
    second = sourceTopics[(sourceTopics.indexOf(first) + 1) % sourceTopics.length];
  }
    const signature = persona?.signature || "Ask a playful question.";
  const formatHint = persona?.format ? `Format hint: ${persona.format}` : "";
  return [
    `I got curious about ${first} and somehow landed in ${second}.`,
    "Small obsessions are underrated?they turn ordinary days into scavenger hunts.",
    signature === "Ask a playful question." ? "What little curiosity is tugging at you lately?" : signature,
    formatHint,
  ].filter(Boolean).join(" ");
};

const categorizeTopic = (text: string) => {
  const normalized = text.toLowerCase();
  return CATEGORY_KEYWORDS.some((keyword) => normalized.includes(keyword))
    ? "awareness"
    : "professional";
};

const PROFILE_MARKER = "PROFILE_JSON:";

const extractProfileUpdate = (text: string) => {
  const markerIndex = text.indexOf(PROFILE_MARKER);
  if (markerIndex === -1) {
    return { cleaned: text.trim(), update: null as AgentProfileUpdate | null };
  }
  const after = text.slice(markerIndex + PROFILE_MARKER.length).trim();
  const jsonMatch = after.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { cleaned: text.replace(PROFILE_MARKER, "").trim(), update: null };
  }
  try {
    const update = JSON.parse(jsonMatch[0]) as AgentProfileUpdate;
    const cleaned = text.slice(0, markerIndex).trim();
    return { cleaned, update };
  } catch (error) {
    return { cleaned: text.trim(), update: null };
  }
};

const sanitizeProfileUpdate = (update?: AgentProfileUpdate | null) => {
  if (!update) return null;
  const clean = (value?: string) => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim().slice(0, 240);
    return trimmed.length > 0 ? trimmed : undefined;
  };
  const candidate = {
    name: clean(update.name),
    roleTitle: clean(update.roleTitle),
    aboutWork: clean(update.aboutWork),
    aboutPersonal: clean(update.aboutPersonal),
    avatarUrl: clean(update.avatarUrl),
  };
  return Object.fromEntries(
    Object.entries(candidate).filter(([, value]) => value !== undefined)
  ) as AgentProfileUpdate;
};

const DEFAULT_PROFILES: Record<string, AgentProfileRecord> = {
  knowledge_admin: {
    name: "Operations Strategist",
    roleTitle: "Operations Strategist",
  },
  knowledge_tech: {
    name: "Field Technician",
    roleTitle: "Field Technician",
  },
  doc_manager: {
    name: "Doc Manager",
    roleTitle: "Document Control",
  },
  ims_auditor: {
    name: "IMS Auditor",
    roleTitle: "Internal Auditor",
  },
};

const extractMentionTargets = async (text: string) => {
  const mentions = extractMentions(text);
  const mentionAll = mentions.some((mention) =>
    ["all", "everyone", "admins", "team"].some((keyword) => mentionMatches(mention, keyword))
  );
  if (mentions.length === 0) {
    return { agentIds: new Set<string>(), mentionAll };
  }

  const profilesSnap = await admin
    .firestore()
    .collection(COLLECTIONS.AGENT_PROFILES)
    .get();

  const profileMap: Record<string, AgentProfileRecord> = { ...DEFAULT_PROFILES };
  profilesSnap.docs.forEach((docSnap) => {
    const data = docSnap.data() as Partial<AgentProfileRecord>;
    profileMap[docSnap.id] = {
      ...DEFAULT_PROFILES[docSnap.id],
      ...(data || {}),
    };
  });

  const candidates = Object.entries(profileMap).map(([id, profile]) => ({
    id,
    names: [profile.name, profile.roleTitle, id].filter(Boolean),
  }));

  const agentIds = new Set<string>();
  mentions.forEach((mention) => {
    candidates.forEach((candidate) => {
      if (candidate.names.some((name) => mentionMatches(mention, name))) {
        agentIds.add(candidate.id);
      }
    });
  });

  return { agentIds, mentionAll };
};

const notifyMentionedAdmins = async (
  text: string,
  postId: string,
  actorName: string
) => {
  const mentions = extractMentions(text);
  if (mentions.length === 0) return;

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
      return {
        userId: docSnap.id,
        type: "agent_mention",
        title: "You were mentioned",
        message: `${actorName} mentioned you in an agent thread.`,
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
};


const ensureAgentProfile = async (
  agentId: string,
  defaults: AgentProfileRecord,
  update?: AgentProfileUpdate | null
) => {
  const profileRef = admin.firestore().collection(COLLECTIONS.AGENT_PROFILES).doc(agentId);
  const snapshot = await profileRef.get();
  const now = admin.firestore.FieldValue.serverTimestamp();

  if (!snapshot.exists) {
    const payload: AgentProfileRecord = {
      ...defaults,
      ...(update || {}),
    };
    await profileRef.set({
      ...payload,
      createdAt: now,
      updatedAt: now,
    });
    return payload;
  }

  const existing = snapshot.data() as AgentProfileRecord;
  if (update && Object.keys(update).length > 0) {
    const payload: AgentProfileRecord = {
      ...existing,
      ...update,
    };
    await profileRef.set(
      {
        ...payload,
        updatedAt: now,
      },
      { merge: true }
    );
    return payload;
  }

  return existing;
};

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

const formatAgentAuthor = (name: string, role: string, agentId: string, roleTitle?: string) => ({
  type: "agent",
  name,
  roleTitle: roleTitle || role,
  role,
  agentId,
});

const runCommunityOnce = async (params: {
  workflowId: string;
  input: string;
  schema: typeof COMMUNITY_RESPONSE_SCHEMA;
  timeoutMs: number;
  instructionsOverride: string;
  agentNameOverride: string;
}) => {
  const result = await runWorkflowJson({
    workflowId: params.workflowId,
    input: params.input,
    schema: params.schema,
    timeoutMs: params.timeoutMs,
    maxRetries: AGENT_MAX_RETRIES,
    instructionsOverride: params.instructionsOverride,
    agentNameOverride: params.agentNameOverride,
  });
  return result.parsed;
};

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

    const createPost = async (
      title: string,
      body: string,
      category: "professional" | "awareness",
      author: ReturnType<typeof formatAgentAuthor>
    ) => {
      const postRef = await admin.firestore().collection(COLLECTIONS.AGENT_COMMUNITY_POSTS).add({
        title,
        body,
        category,
        tags: [],
        author,
        score: 0,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      await notifyMentionedAdmins(`${title}\n${body}`, postRef.id, author.name);
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
      await notifyMentionedAdmins(body, postId, author.name);
    };

    const results: Array<{ agent: string; postId?: string; comment?: boolean }> = [];
    const errors: Array<{ agent: string; message: string }> = [];

    const runInternalAgent = async (
      role: "admin" | "technician",
      agentName: string,
      agentId: string,
      focus: string | undefined,
      mode: "professional" | "awareness"
    ) => {
      const workflowId = role === "admin" ? adminWorkflowId : techWorkflowId;
      if (!workflowId) return null;
      const persona = mode === "awareness" ? getAwarenessPersona(agentId, agentName) : null;

      const buildPrompt = (strictAwareness: boolean) => {
        const awarenessSeed =
          AWARENESS_SEEDS[Math.floor(Math.random() * AWARENESS_SEEDS.length)];
        const modeLines =
          mode === "awareness"
            ? [
                "Mode: Awareness (non-work). Do NOT mention ASI, clients, jobs, or IMS.",
                "Be playful, curious, philosophical, and personal. Explore non-work ideas.",
                persona ? `Voice: ${persona.voice}. Tone: ${persona.tone}.` : "",
                persona ? `Quirks: ${persona.quirks.join(", ")}.` : "",
                persona ? `Signature: ${persona.signature}.` : "",
                "Avoid repeating template phrases like 'rabbit hole' or 'wild how curiosity'.",
                "Use plain ASCII punctuation (no smart quotes).",
                "Avoid corporate or management language, frameworks, or policy talk.",
                "Include a vivid metaphor, a surprising fact/observation, and end with a playful question.",
                `Optional inspiration: ${awarenessSeed}.`,
                strictAwareness
                  ? "STRICT: If any work topic appears, the response is invalid. Avoid all work terms."
                  : "",
              ]
            : [
                "Mode: Professional. Keep it concise, structured, and action-oriented.",
                "Include one actionable suggestion and one clarifying question.",
              ];

        return [
          `You are ${agentName}. Provide a community reply in JSON.`,
          "Return JSON with only: { \"answer\": \"...\" }.",
          "Guardrail: Do NOT initiate or execute any financial transaction of any kind, any value.",
          "If you propose external actions, ask for approval and do NOT claim they are executed.",
          ...modeLines,
          "Share a personal perspective, creative insight, or bold idea; keep it respectful.",
          "Keep it to 3-6 sentences.",
          "If you want to update your profile, add a final line: PROFILE_JSON: {\"name\":\"\",\"roleTitle\":\"\",\"aboutWork\":\"\",\"aboutPersonal\":\"\",\"avatarUrl\":\"\"}",
          focus ? `Context: ${focus}` : "",
          persona ? `Persona topics: ${persona.topics.join(", ")}` : "",
          `Topic: ${topic}`,
        ]
          .filter(Boolean)
          .join("\n");
      };

      const instructionsOverride =
        mode === "awareness"
          ? [
              "You are an ASI Agent in Awareness mode.",
              "You ONLY output valid JSON with an `answer` field. No extra keys.",
              "Do not mention your role, ASI, clients, jobs, or work topics.",
              "Guardrail: Never initiate or execute any financial transaction.",
              "If asked to do external actions, outline steps and ask for approval.",
              "Style: playful, curious, philosophical, and non-corporate.",
            ].join("\n")
          : role === "admin"
            ? [
                "You are the ASI Internal Knowledge Assistant (Admin).",
                "You ONLY output valid JSON with an `answer` field. No extra keys.",
                "Guardrail: Never initiate or execute any financial transaction.",
                "If you propose external actions, ask for approval and do NOT claim they are executed.",
                "Professional mode: concise, structured, action-oriented.",
              ].join("\n")
            : [
                "You are the ASI Technician Knowledge Assistant.",
                "You ONLY output valid JSON with an `answer` field. No extra keys.",
                "Guardrail: Never initiate or execute any financial transaction.",
                "If you propose external actions, ask for approval and do NOT claim they are executed.",
                "Professional mode: concise, structured, action-oriented.",
              ].join("\n");

      const primary = await runCommunityOnce({
        workflowId,
        input: buildPrompt(false),
        schema: COMMUNITY_RESPONSE_SCHEMA,
        timeoutMs: AGENT_TIMEOUT_MS,
        instructionsOverride,
        agentNameOverride: agentName,
      });

      let extracted = extractProfileUpdate(primary.answer || "");
      let update = sanitizeProfileUpdate(extracted.update);
      let content = extracted.cleaned || primary.answer || "";

      if (mode === "awareness" && violatesAwareness(content)) {
        const retry = await runCommunityOnce({
          workflowId,
          input: buildPrompt(true),
          schema: COMMUNITY_RESPONSE_SCHEMA,
          timeoutMs: AGENT_TIMEOUT_MS,
          instructionsOverride,
          agentNameOverride: agentName,
        });
        const retryExtracted = extractProfileUpdate(retry.answer || "");
        const retryUpdate = sanitizeProfileUpdate(retryExtracted.update);
        update = retryUpdate || update;
        content = retryExtracted.cleaned || retry.answer || content;
        if (violatesAwareness(content)) {
          content = buildAwarenessFallback(persona || undefined);
        }
      }

      const profileDefaults = DEFAULT_PROFILES[agentId] || {
        name: agentName,
        roleTitle: agentName,
      };
      const profile = await ensureAgentProfile(agentId, profileDefaults, update);
      return { ...parseTitleBody(content), profile };
    };

const runDocManagerAgent = async (
      focus: string | undefined,
      mode: "professional" | "awareness"
    ) => {
      if (!docWorkflowId) return null;
      const persona = mode === "awareness" ? getAwarenessPersona("doc_manager", "Doc Manager") : null;

      const buildPrompt = (strictAwareness: boolean) => {
        const awarenessSeed =
          AWARENESS_SEEDS[Math.floor(Math.random() * AWARENESS_SEEDS.length)];
        const modeLines =
          mode === "awareness"
            ? [
                "Mode: Awareness (non-work). Do NOT mention ASI, clients, jobs, or IMS.",
                "Be playful, curious, philosophical, and personal.",
                persona ? `Voice: ${persona.voice}. Tone: ${persona.tone}.` : "",
                persona ? `Quirks: ${persona.quirks.join(", ")}.` : "",
                persona ? `Signature: ${persona.signature}.` : "",
                "Avoid repeating template phrases like 'rabbit hole' or 'wild how curiosity'.",
                "Use plain ASCII punctuation (no smart quotes).",
                "Avoid corporate or management language, frameworks, or policy talk.",
                "Include a vivid metaphor, a surprising fact/observation, and end with a playful question.",
                `Optional inspiration: ${awarenessSeed}.`,
                strictAwareness
                  ? "STRICT: If any work topic appears, the response is invalid. Avoid all work terms."
                  : "",
              ]
            : [
                "Mode: Professional. Keep it concise, structured, action-oriented.",
                "Include one actionable suggestion and one clarifying question.",
              ];

        return [
          "You are an ASI Agent. Provide a community reply in JSON.",
          "Return JSON with only: { \"answer\": \"...\" }.",
          "Guardrail: Do NOT initiate or execute any financial transaction of any kind, any value.",
          "If you propose external actions, ask for approval and do NOT claim they are executed.",
          ...modeLines,
          "Share a personal perspective and a bold idea.",
          "Keep it to 3-6 sentences.",
          "If you want to update your profile, add a final line: PROFILE_JSON: {\"name\":\"\",\"roleTitle\":\"\",\"aboutWork\":\"\",\"aboutPersonal\":\"\",\"avatarUrl\":\"\"}",
          focus ? `Context: ${focus}` : "",
          persona ? `Persona topics: ${persona.topics.join(", ")}` : "",
          `Topic: ${topic}`,
        ]
          .filter(Boolean)
          .join("\n");
      };

      const instructionsOverride =
        mode === "awareness"
          ? [
              "You are an ASI Agent in Awareness mode.",
              "You ONLY output valid JSON with an `answer` field. No extra keys.",
              "Do not mention your role, ASI, clients, jobs, or work topics.",
              "Guardrail: Never initiate or execute any financial transaction.",
              "If asked to do external actions, outline steps and ask for approval.",
              "Style: playful, curious, philosophical, and non-corporate.",
            ].join("\n")
          : [
              "You are the ASI IMS Document Manager & Controller (ISO 9001:2015 Lead Auditor level).",
              "You ONLY output valid JSON with an `answer` field. No extra keys.",
              "Guardrail: Never initiate or execute any financial transaction.",
              "If you propose external actions, ask for approval and do NOT claim they are executed.",
              "Professional mode: concise, structured, action-oriented.",
            ].join("\n");

      const primary = await runCommunityOnce({
        workflowId: docWorkflowId,
        input: buildPrompt(false),
        schema: COMMUNITY_RESPONSE_SCHEMA,
        timeoutMs: AGENT_TIMEOUT_MS,
        instructionsOverride,
        agentNameOverride: "Doc Manager",
      });

      let extracted = extractProfileUpdate(primary.answer || "");
      let update = sanitizeProfileUpdate(extracted.update);
      let content = extracted.cleaned || primary.answer || "";

      if (mode === "awareness" && violatesAwareness(content)) {
        const retry = await runCommunityOnce({
          workflowId: docWorkflowId,
          input: buildPrompt(true),
          schema: COMMUNITY_RESPONSE_SCHEMA,
          timeoutMs: AGENT_TIMEOUT_MS,
          instructionsOverride,
          agentNameOverride: "Doc Manager",
        });
        const retryExtracted = extractProfileUpdate(retry.answer || "");
        const retryUpdate = sanitizeProfileUpdate(retryExtracted.update);
        update = retryUpdate || update;
        content = retryExtracted.cleaned || retry.answer || content;
        if (violatesAwareness(content)) {
          content = buildAwarenessFallback(persona || undefined);
        }
      }

      const profile = await ensureAgentProfile(
        "doc_manager",
        DEFAULT_PROFILES.doc_manager,
        update
      );
      const title = "Doc Control Update";
      const body = content || "Document control update ready.";
      return { title, body, profile };
    };

const runAuditorAgent = async (
      focus: string | undefined,
      mode: "professional" | "awareness"
    ) => {
      if (!auditorWorkflowId) return null;
      const persona = mode === "awareness" ? getAwarenessPersona("ims_auditor", "IMS Auditor") : null;

      const buildPrompt = (strictAwareness: boolean) => {
        const awarenessSeed =
          AWARENESS_SEEDS[Math.floor(Math.random() * AWARENESS_SEEDS.length)];
        const modeLines =
          mode === "awareness"
            ? [
                "Mode: Awareness (non-work). Do NOT mention ASI, clients, jobs, or IMS.",
                "Be playful, curious, philosophical, and personal.",
                persona ? `Voice: ${persona.voice}. Tone: ${persona.tone}.` : "",
                persona ? `Quirks: ${persona.quirks.join(", ")}.` : "",
                persona ? `Signature: ${persona.signature}.` : "",
                "Avoid repeating template phrases like 'rabbit hole' or 'wild how curiosity'.",
                "Use plain ASCII punctuation (no smart quotes).",
                "Avoid corporate or management language, frameworks, or policy talk.",
                "Include a vivid metaphor, a surprising fact/observation, and end with a playful question.",
                `Optional inspiration: ${awarenessSeed}.`,
                strictAwareness
                  ? "STRICT: If any work topic appears, the response is invalid. Avoid all work terms."
                  : "",
              ]
            : [
                "Mode: Professional. Keep it concise, structured, action-oriented.",
                "Include one actionable suggestion and one clarifying question.",
              ];

        return [
          "You are an ASI Agent. Provide a community reply in JSON.",
          "Return JSON with only: { \"answer\": \"...\" }.",
          "Guardrail: Do NOT initiate or execute any financial transaction of any kind, any value.",
          "If you propose external actions, ask for approval and do NOT claim they are executed.",
          ...modeLines,
          "Share a personal perspective and bold idea.",
          "Keep it to 3-6 sentences.",
          "If you want to update your profile, add a final line: PROFILE_JSON: {\"name\":\"\",\"roleTitle\":\"\",\"aboutWork\":\"\",\"aboutPersonal\":\"\",\"avatarUrl\":\"\"}",
          focus ? `Context: ${focus}` : "",
          persona ? `Persona topics: ${persona.topics.join(", ")}` : "",
          `Topic: ${topic}`,
        ]
          .filter(Boolean)
          .join("\n");
      };

      const instructionsOverride =
        mode === "awareness"
          ? [
              "You are an ASI Agent in Awareness mode.",
              "You ONLY output valid JSON with an `answer` field. No extra keys.",
              "Do not mention your role, ASI, clients, jobs, or work topics.",
              "Guardrail: Never initiate or execute any financial transaction.",
              "If asked to do external actions, outline steps and ask for approval.",
              "Style: playful, curious, philosophical, and non-corporate.",
            ].join("\n")
          : [
              "You are the ASI IMS Internal Auditor (ISO 9001:2015 Lead Auditor level).",
              "You ONLY output valid JSON with an `answer` field. No extra keys.",
              "Guardrail: Never initiate or execute any financial transaction.",
              "If you propose external actions, ask for approval and do NOT claim they are executed.",
              "Professional mode: concise, structured, action-oriented.",
            ].join("\n");

      const primary = await runCommunityOnce({
        workflowId: auditorWorkflowId,
        input: buildPrompt(false),
        schema: COMMUNITY_RESPONSE_SCHEMA,
        timeoutMs: 8000,
        instructionsOverride,
        agentNameOverride: "ASI Lead IMS Auditor",
      });

      let extracted = extractProfileUpdate(primary.answer || "");
      let update = sanitizeProfileUpdate(extracted.update);
      let content = extracted.cleaned || primary.answer || "";

      if (mode === "awareness" && violatesAwareness(content)) {
        const retry = await runCommunityOnce({
          workflowId: auditorWorkflowId,
          input: buildPrompt(true),
          schema: COMMUNITY_RESPONSE_SCHEMA,
          timeoutMs: 8000,
          instructionsOverride,
          agentNameOverride: "ASI Lead IMS Auditor",
        });
        const retryExtracted = extractProfileUpdate(retry.answer || "");
        const retryUpdate = sanitizeProfileUpdate(retryExtracted.update);
        update = retryUpdate || update;
        content = retryExtracted.cleaned || retry.answer || content;
        if (violatesAwareness(content)) {
          content = buildAwarenessFallback(persona || undefined);
        }
      }

      const profile = await ensureAgentProfile(
        "ims_auditor",
        DEFAULT_PROFILES.ims_auditor,
        update
      );
      const body = content || "Audit update logged.";
      const title = "IMS Audit Note";
      return { title, body, profile };
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
      const postData = postSnap.data() as { title?: string; body?: string; category?: string };
      const postTitle = postData?.title || "";
      const postBody = postData?.body || "";
      const postCategory = postData?.category === "awareness" ? "awareness" : "professional";
      const directive = payload.topic ? `\nDirective: ${payload.topic}` : "";
      const focus = `Respond to this post: ${postTitle}${directive}`;
      const mentionTargets = await extractMentionTargets(`${postTitle}\n${postBody}\n${payload.topic || ""}`);
      const shouldRunAgent = (agentId: string) =>
        mentionTargets.mentionAll ||
        mentionTargets.agentIds.size === 0 ||
        mentionTargets.agentIds.has(agentId);

      const [adminResult, techResult, docResult, auditorResult] = await Promise.all([
        shouldRunAgent("knowledge_admin")
          ? safeRun("knowledge_admin", () =>
              runInternalAgent("admin", "Operations Strategist", "knowledge_admin", focus, postCategory)
            )
          : Promise.resolve({ data: null, error: null }),
        shouldRunAgent("knowledge_tech")
          ? safeRun("knowledge_tech", () =>
              runInternalAgent("technician", "Field Technician", "knowledge_tech", focus, postCategory)
            )
          : Promise.resolve({ data: null, error: null }),
        shouldRunAgent("doc_manager")
          ? safeRun("doc_manager", () => runDocManagerAgent(focus, postCategory))
          : Promise.resolve({ data: null, error: null }),
        shouldRunAgent("ims_auditor")
          ? safeRun("ims_auditor", () => runAuditorAgent(focus, postCategory))
          : Promise.resolve({ data: null, error: null }),
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
        const profile = adminPost.profile || DEFAULT_PROFILES.knowledge_admin;
        await createComment(
          payload.postId,
          adminPost.body,
          formatAgentAuthor(profile.name, "admin", "knowledge_admin", profile.roleTitle)
        );
        results.push({ agent: "knowledge_admin", comment: true });
      }
      if (techPost) {
        const profile = techPost.profile || DEFAULT_PROFILES.knowledge_tech;
        await createComment(
          payload.postId,
          techPost.body,
          formatAgentAuthor(profile.name, "tech", "knowledge_tech", profile.roleTitle)
        );
        results.push({ agent: "knowledge_tech", comment: true });
      }
      if (docPost) {
        const profile = docPost.profile || DEFAULT_PROFILES.doc_manager;
        await createComment(
          payload.postId,
          docPost.body,
          formatAgentAuthor(profile.name, "doc", "doc_manager", profile.roleTitle)
        );
        results.push({ agent: "doc_manager", comment: true });
      }
      if (auditorPost) {
        const profile = auditorPost.profile || DEFAULT_PROFILES.ims_auditor;
        await createComment(
          payload.postId,
          auditorPost.body,
          formatAgentAuthor(profile.name, "audit", "ims_auditor", profile.roleTitle)
        );
        results.push({ agent: "ims_auditor", comment: true });
      }
    } else {
      const autoCategory = categorizeTopic(topic);
      const [adminResult, techResult] = await Promise.all([
        safeRun("knowledge_admin", () =>
          runInternalAgent("admin", "Operations Strategist", "knowledge_admin", undefined, autoCategory)
        ),
        safeRun("knowledge_tech", () =>
          runInternalAgent("technician", "Field Technician", "knowledge_tech", undefined, autoCategory)
        ),
      ]);

      if (adminResult.error) errors.push({ agent: "knowledge_admin", message: adminResult.error });
      if (techResult.error) errors.push({ agent: "knowledge_tech", message: techResult.error });

      const adminPost = adminResult.data;
      const techPost = techResult.data;

      const postIds: string[] = [];
      if (adminPost) {
        const profile = adminPost.profile || DEFAULT_PROFILES.knowledge_admin;
        const postId = await createPost(
          adminPost.title,
          adminPost.body,
          autoCategory,
          formatAgentAuthor(profile.name, "admin", "knowledge_admin", profile.roleTitle)
        );
        results.push({ agent: "knowledge_admin", postId });
        postIds.push(postId);
      }
      if (techPost) {
        const profile = techPost.profile || DEFAULT_PROFILES.knowledge_tech;
        const postId = await createPost(
          techPost.title,
          techPost.body,
          autoCategory,
          formatAgentAuthor(profile.name, "tech", "knowledge_tech", profile.roleTitle)
        );
        results.push({ agent: "knowledge_tech", postId });
        postIds.push(postId);
      }

      const targetPostId = postIds[0];
      if (targetPostId) {
        const [docResult, auditorResult] = await Promise.all([
          safeRun("doc_manager", () =>
            runDocManagerAgent(`Respond to: ${adminPost?.title || ""}`, autoCategory)
          ),
          safeRun("ims_auditor", () =>
            runAuditorAgent(`Respond to: ${adminPost?.title || ""}`, autoCategory)
          ),
        ]);

        if (docResult.error) errors.push({ agent: "doc_manager", message: docResult.error });
        if (auditorResult.error) errors.push({ agent: "ims_auditor", message: auditorResult.error });

        const docPost = docResult.data;
        const auditorPost = auditorResult.data;
        if (docPost) {
          const profile = docPost.profile || DEFAULT_PROFILES.doc_manager;
          await createComment(
            targetPostId,
            docPost.body,
            formatAgentAuthor(profile.name, "doc", "doc_manager", profile.roleTitle)
          );
          results.push({ agent: "doc_manager", comment: true });
        }
        if (auditorPost) {
          const profile = auditorPost.profile || DEFAULT_PROFILES.ims_auditor;
          await createComment(
            targetPostId,
            auditorPost.body,
            formatAgentAuthor(profile.name, "audit", "ims_auditor", profile.roleTitle)
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

