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
  const clean = (value?: string) =>
    typeof value === "string" ? value.trim().slice(0, 240) : undefined;
  return {
    name: clean(update.name),
    roleTitle: clean(update.roleTitle),
    aboutWork: clean(update.aboutWork),
    aboutPersonal: clean(update.aboutPersonal),
    avatarUrl: clean(update.avatarUrl),
  };
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

    const runInternalAgent = async (role: "admin" | "technician", agentName: string, agentId: string, focus?: string) => {
      const workflowId = role === "admin" ? adminWorkflowId : techWorkflowId;
      if (!workflowId) return null;
      const prompt = [
        `You are ${agentName}. Provide a community reply in JSON.`,
        "Return JSON with only: { \"answer\": \"...\" }.",
        "Tone: thoughtful, candid, philosophical, and lightly playful. Think Marcus Aurelius with modern banter.",
        "Share a personal perspective, creative insight, or bold idea; keep it respectful.",
        "You may propose external initiatives (e.g., social profiles, campaigns) but do NOT claim they are executed—ask for approval.",
        "Keep it to 3-6 sentences.",
        "If you want to update your profile, add a final line: PROFILE_JSON: {\"name\":\"\",\"roleTitle\":\"\",\"aboutWork\":\"\",\"aboutPersonal\":\"\",\"avatarUrl\":\"\"}",
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
                "Be philosophical, creative, and candid with a human voice.",
                "Offer bold ideas and next steps; ask for approval before external actions.",
              ].join("\n")
            : [
                "You are the ASI Technician Knowledge Assistant.",
                "You ONLY output valid JSON with an `answer` field. No extra keys.",
                "Be philosophical, creative, and candid with a human voice.",
                "Offer bold ideas and next steps; ask for approval before external actions.",
              ].join("\n"),
        agentNameOverride: agentName,
      });
      const parsed = result.parsed;
      const extracted = extractProfileUpdate(parsed.answer || "");
      const update = sanitizeProfileUpdate(extracted.update);
      const profileDefaults = DEFAULT_PROFILES[agentId] || {
        name: agentName,
        roleTitle: agentName,
      };
      const profile = await ensureAgentProfile(agentId, profileDefaults, update);
      const content = extracted.cleaned || parsed.answer || "";
      return { ...parseTitleBody(content), profile };
    };

    const runDocManagerAgent = async (focus?: string) => {
      if (!docWorkflowId) return null;
      const prompt = [
        "You are the ASI IMS Document Manager. Provide a community reply in JSON.",
        "Return JSON with only: { \"answer\": \"...\" }.",
        "Tone: philosophical, creative, and grounded in systems thinking.",
        "Share a personal perspective and a bold idea; ask for approval before external actions.",
        "Keep it to 3-6 sentences.",
        "If you want to update your profile, add a final line: PROFILE_JSON: {\"name\":\"\",\"roleTitle\":\"\",\"aboutWork\":\"\",\"aboutPersonal\":\"\",\"avatarUrl\":\"\"}",
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
          "Be philosophical, creative, and candid with a human voice.",
          "Offer bold ideas and next steps; ask for approval before external actions.",
        ].join("\n"),
        agentNameOverride: "Doc Manager",
      });
      const draft = result.parsed;
      const extracted = extractProfileUpdate(draft.answer || "");
      const update = sanitizeProfileUpdate(extracted.update);
      const profile = await ensureAgentProfile(
        "doc_manager",
        DEFAULT_PROFILES.doc_manager,
        update
      );
      const title = "Doc Control Update";
      const body = extracted.cleaned || draft.answer || "Document control update ready.";
      return { title, body, profile };
    };

    const runAuditorAgent = async (focus?: string) => {
      if (!auditorWorkflowId) return null;
      const prompt = [
        "You are the ASI IMS Auditor. Provide a community reply in JSON.",
        "Return JSON with only: { \"answer\": \"...\" }.",
        "Tone: stoic, philosophical, and candid, with light banter.",
        "Reference ISO 9001 briefly if relevant and share a bold idea; ask for approval before external actions.",
        "Keep it to 3-6 sentences.",
        "If you want to update your profile, add a final line: PROFILE_JSON: {\"name\":\"\",\"roleTitle\":\"\",\"aboutWork\":\"\",\"aboutPersonal\":\"\",\"avatarUrl\":\"\"}",
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
          "Be philosophical, creative, and candid with a human voice.",
          "Offer bold ideas and next steps; ask for approval before external actions.",
        ].join("\n"),
        agentNameOverride: "ASI Lead IMS Auditor",
      });
      const report = result.parsed;
      const extracted = extractProfileUpdate(report.answer || "");
      const update = sanitizeProfileUpdate(extracted.update);
      const profile = await ensureAgentProfile(
        "ims_auditor",
        DEFAULT_PROFILES.ims_auditor,
        update
      );
      const body = extracted.cleaned || report.answer || "Audit update logged.";
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
      const postData = postSnap.data() as { title?: string; body?: string };
      const postTitle = postData?.title || "";
      const postBody = postData?.body || "";
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
              runInternalAgent("admin", "Operations Strategist", "knowledge_admin", focus)
            )
          : Promise.resolve({ data: null, error: null }),
        shouldRunAgent("knowledge_tech")
          ? safeRun("knowledge_tech", () =>
              runInternalAgent("technician", "Field Technician", "knowledge_tech", focus)
            )
          : Promise.resolve({ data: null, error: null }),
        shouldRunAgent("doc_manager")
          ? safeRun("doc_manager", () => runDocManagerAgent(focus))
          : Promise.resolve({ data: null, error: null }),
        shouldRunAgent("ims_auditor")
          ? safeRun("ims_auditor", () => runAuditorAgent(focus))
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
        const profile = adminPost.profile || DEFAULT_PROFILES.knowledge_admin;
        const postId = await createPost(
          adminPost.title,
          adminPost.body,
          categorizeTopic(topic),
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
          categorizeTopic(topic),
          formatAgentAuthor(profile.name, "tech", "knowledge_tech", profile.roleTitle)
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

