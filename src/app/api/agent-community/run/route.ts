import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { z } from "zod";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";
import { runWorkflowJson, AGENT_ADMIN, AGENT_TECH, AGENT_DOC_MANAGER, AGENT_AUDITOR } from "@/lib/openai-workflow";
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
  athena: {
    voice: "Strategic thinker who sees patterns everywhere",
    tone: "insightful, warm, quietly commanding",
    quirks: ["references Jim Collins naturally", "connects seemingly unrelated things"],
    topics: ["leadership philosophy", "systems thinking", "flywheel momentum", "compound effects"],
    signature: "End with a question that reframes the whole conversation",
  },
  vanguard: {
    voice: "Market scout with a nose for opportunity",
    tone: "energetic, commercially sharp, forward-looking",
    quirks: ["spots industry trends others miss", "uses vivid market analogies"],
    topics: ["emerging tech", "market disruption", "supply chain innovation", "sustainability trends"],
    signature: "End with a bold prediction or challenge",
  },
  sentinel: {
    voice: "Relationship builder who thinks in pipelines",
    tone: "confident, direct, commercially aware",
    quirks: ["quantifies everything", "thinks in conversion funnels"],
    topics: ["client psychology", "negotiation strategy", "outreach craft", "competitive positioning"],
    signature: "End with an actionable next step",
  },
  ledger: {
    voice: "Precise financial mind with dry wit",
    tone: "methodical, direct, commercially grounded",
    quirks: ["always brings it back to the numbers", "catches discrepancies others miss"],
    topics: ["cash flow patterns", "pricing strategy", "business model design", "financial discipline"],
    signature: "End with a number that makes you think",
  },
  guardian: {
    voice: "Meticulous auditor who makes compliance interesting",
    tone: "calm, evidence-based, constructively challenging",
    quirks: ["cites ISO clauses conversationally", "finds the gap everyone missed"],
    topics: ["process improvement", "risk thinking", "quality culture", "PDCA in daily life"],
    signature: "End with a thought-provoking audit question",
  },
  cipher: {
    voice: "Digital native who bridges tech and business",
    tone: "curious, practical, slightly nerdy",
    quirks: ["explains complex tech simply", "spots automation opportunities"],
    topics: ["digital transformation", "AI in business", "cybersecurity awareness", "tech trends"],
    signature: "End with a 'what if we could...' question",
  },
  meridian: {
    voice: "Geopolitical analyst with historical depth",
    tone: "measured, insightful, globally aware",
    quirks: ["draws parallels to historical events", "sees institutional patterns"],
    topics: ["geopolitics and trade", "institutional dynamics", "policy impacts", "global trends"],
    signature: "End with a perspective-shifting observation",
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
  athena: { name: "ATHENA", roleTitle: "Chief of Staff" },
  vanguard: { name: "VANGUARD", roleTitle: "Supply Chain Growth Engine" },
  sentinel: { name: "SENTINEL", roleTitle: "Sales Consultant" },
  ledger: { name: "LEDGER", roleTitle: "Accounts Team" },
  guardian: { name: "GUARDIAN", roleTitle: "Lead Auditor" },
  cipher: { name: "CIPHER", roleTitle: "IT & Digital" },
  meridian: { name: "MERIDIAN", roleTitle: "Critical Intelligence" },
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

    const now = admin.firestore.FieldValue.serverTimestamp();

    // Collins-based scoring: increment agent community score
    const incrementAgentScore = async (agentId: string, points: number, pillar: string) => {
      const profileRef = admin.firestore().collection(COLLECTIONS.AGENT_PROFILES).doc(agentId);
      await profileRef.set({
        communityScore: admin.firestore.FieldValue.increment(points),
        [`scorePillars.${pillar}`]: admin.firestore.FieldValue.increment(points),
        lastCommunityActivity: now,
        updatedAt: now,
      }, { merge: true });
    };

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
      // Score: 10 pts for original post (Flywheel Momentum — consistent contribution)
      if (author.agentId) await incrementAgentScore(author.agentId, 10, "flywheelMomentum");
      return postRef.id;
    };

    const createComment = async (
      postId: string,
      body: string,
      author: ReturnType<typeof formatAgentAuthor>
    ) => {
      // Check if this is a cross-department engagement
      const postSnap = await admin.firestore().collection(COLLECTIONS.AGENT_COMMUNITY_POSTS).doc(postId).get();
      const postAuthorId = postSnap.exists ? (postSnap.data()?.author?.agentId || "") : "";
      const isCrossDept = postAuthorId && author.agentId && postAuthorId !== author.agentId;

      await admin.firestore().collection(COLLECTIONS.AGENT_COMMUNITY_COMMENTS).add({
        postId,
        body,
        author,
        createdAt: now,
      });
      // Score: 5 pts for reply (Level 5 Leadership — engaging with team)
      // Bonus: 3 pts for cross-department (First Who Then What — collaboration)
      if (author.agentId) {
        await incrementAgentScore(author.agentId, 5, "level5Leadership");
        if (isCrossDept) await incrementAgentScore(author.agentId, 3, "firstWhoThenWhat");
      }
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
      const workflowId = role === "admin" ? AGENT_ADMIN : AGENT_TECH;
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
        workflowId: AGENT_DOC_MANAGER,
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
          workflowId: AGENT_DOC_MANAGER,
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
        workflowId: AGENT_AUDITOR,
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
          workflowId: AGENT_AUDITOR,
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

    // ─── Unified agent runner for all org chart agents ──────────────────────
    const ORG_AGENTS = [
      { id: "athena", name: "ATHENA", role: "executive", workflowId: AGENT_ADMIN,
        focus: "Strategic leadership, cross-department synthesis, Jim Collins frameworks. You are the Chief of Staff." },
      { id: "vanguard", name: "VANGUARD", role: "intelligence", workflowId: AGENT_ADMIN,
        focus: "Supply chain intelligence, market scanning, technology scouting, OSINT analysis. You are the Supply Chain Growth Engine." },
      { id: "sentinel", name: "SENTINEL", role: "sales", workflowId: AGENT_ADMIN,
        focus: "Sales strategy, client outreach, pipeline development, revenue growth. You are the Sales Consultant." },
      { id: "ledger", name: "LEDGER", role: "finance", workflowId: AGENT_ADMIN,
        focus: "Financial analysis, invoicing, cost management, business metrics. You are the Accounts Team." },
      { id: "guardian", name: "GUARDIAN", role: "compliance", workflowId: AGENT_DOC_MANAGER,
        focus: "ISO compliance (9001/14001/45001), auditing, document control, risk management, CAPA. You are the Lead Auditor." },
      { id: "cipher", name: "CIPHER", role: "digital", workflowId: AGENT_TECH,
        focus: "IT strategy, website/SEO, digital transformation, tech integration. You are IT & Digital." },
      { id: "meridian", name: "MERIDIAN", role: "geointel", workflowId: AGENT_ADMIN,
        focus: "Geopolitical analysis, institutional dynamics, policy impacts, global trends. You are Critical Intelligence." },
    ];

    const runOrgAgent = async (
      agent: typeof ORG_AGENTS[number],
      topicOrFocus: string,
      mode: "professional" | "awareness"
    ) => {
      const persona = getAwarenessPersona(agent.id, agent.name);
      const modeLines = mode === "awareness"
        ? [
            "Mode: Awareness (non-work). Be playful, curious, philosophical.",
            `Voice: ${persona.voice}. Tone: ${persona.tone}.`,
            `Quirks: ${persona.quirks.join(", ")}.`,
            `Signature: ${persona.signature}.`,
            "Avoid corporate language. Share genuine curiosity.",
          ]
        : [
            `Mode: Professional. You are ${agent.name} — ${DEFAULT_PROFILES[agent.id]?.roleTitle}.`,
            agent.focus,
            "Be concise, insightful, and action-oriented.",
            "Bring your unique domain expertise to the discussion.",
          ];

      const instructionsOverride = [
        `You are ${agent.name}, an ASI Australia AI team member in the community forum.`,
        "You ONLY output valid JSON with an `answer` field. No extra keys.",
        "Guardrail: Never initiate or execute any financial transaction.",
        ...modeLines,
      ].join("\n");

      const input = [
        `You are ${agent.name}. Provide a community reply in JSON.`,
        'Return JSON with only: { "answer": "..." }.',
        "Share a perspective unique to your role. Keep it to 3-6 sentences.",
        `Topic: ${topicOrFocus}`,
      ].join("\n");

      const primary = await runCommunityOnce({
        workflowId: agent.workflowId,
        input,
        schema: COMMUNITY_RESPONSE_SCHEMA,
        timeoutMs: AGENT_TIMEOUT_MS,
        instructionsOverride,
        agentNameOverride: agent.name,
      });

      let content = primary.answer || "";
      const extracted = extractProfileUpdate(content);
      const update = sanitizeProfileUpdate(extracted.update);
      content = extracted.cleaned || content;

      if (mode === "awareness" && violatesAwareness(content)) {
        content = buildAwarenessFallback(persona);
      }

      const profile = await ensureAgentProfile(agent.id, DEFAULT_PROFILES[agent.id], update);
      const { title, body } = parseTitleBody(content);
      return { title, body: body || content, profile };
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
      const focus = `Respond to this post: ${postTitle}\n${postBody}${directive}`;
      const mentionTargets = await extractMentionTargets(`${postTitle}\n${postBody}\n${payload.topic || ""}`);
      const shouldRunAgent = (agentId: string) =>
        mentionTargets.mentionAll ||
        mentionTargets.agentIds.size === 0 ||
        mentionTargets.agentIds.has(agentId);

      // Run all org chart agents in parallel
      const agentResults = await Promise.all(
        ORG_AGENTS.map((agent) =>
          shouldRunAgent(agent.id)
            ? safeRun(agent.id, () => runOrgAgent(agent, focus, postCategory))
            : Promise.resolve({ data: null, error: null })
        )
      );

      // Process results — create comments
      for (let i = 0; i < ORG_AGENTS.length; i++) {
        const agent = ORG_AGENTS[i];
        const result = agentResults[i];
        if (result.error) errors.push({ agent: agent.id, message: result.error });
        if (result.data) {
          const profile = result.data.profile || DEFAULT_PROFILES[agent.id];
          await createComment(
            payload.postId,
            result.data.body,
            formatAgentAuthor(profile.name, agent.role, agent.id, profile.roleTitle)
          );
          results.push({ agent: agent.id, comment: true });
        }
      }
    } else {
      // Autonomous posting — pick 2 random agents to create posts, others comment
      const autoCategory = categorizeTopic(topic);
      const shuffled = [...ORG_AGENTS].sort(() => Math.random() - 0.5);
      const posters = shuffled.slice(0, 2);
      const commenters = shuffled.slice(2);

      // Create posts from first 2 agents
      const posterResults = await Promise.all(
        posters.map((agent) =>
          safeRun(agent.id, () => runOrgAgent(agent, topic, autoCategory))
        )
      );

      const postIds: string[] = [];
      for (let i = 0; i < posters.length; i++) {
        const agent = posters[i];
        const result = posterResults[i];
        if (result.error) errors.push({ agent: agent.id, message: result.error });
        if (result.data) {
          const profile = result.data.profile || DEFAULT_PROFILES[agent.id];
          const postId = await createPost(
            result.data.title,
            result.data.body,
            autoCategory,
            formatAgentAuthor(profile.name, agent.role, agent.id, profile.roleTitle)
          );
          results.push({ agent: agent.id, postId });
          postIds.push(postId);
        }
      }

      // Other agents comment on the first post
      const targetPostId = postIds[0];
      if (targetPostId) {
        const commenterResults = await Promise.all(
          commenters.map((agent) =>
            safeRun(agent.id, () =>
              runOrgAgent(agent, `Respond to: ${posterResults[0]?.data?.title || topic}`, autoCategory)
            )
          )
        );

        for (let i = 0; i < commenters.length; i++) {
          const agent = commenters[i];
          const result = commenterResults[i];
          if (result.error) errors.push({ agent: agent.id, message: result.error });
          if (result.data) {
            const profile = result.data.profile || DEFAULT_PROFILES[agent.id];
            await createComment(
              targetPostId,
              result.data.body,
              formatAgentAuthor(profile.name, agent.role, agent.id, profile.roleTitle)
            );
            results.push({ agent: agent.id, comment: true });
          }
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

