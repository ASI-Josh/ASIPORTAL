import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";
import { InternalKnowledgeSchema } from "@/lib/assistant/internal-knowledge-schema";
import { runWorkflowJson, AGENT_ADMIN, AGENT_TECH } from "@/lib/openai-workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Anthropic round-trip + context-building (admin + Archer branches do
// several parallel Firestore queries) can push past Netlify's 10s
// default timeout on cold starts and return an HTML error page, which
// breaks the chat client's response.json() call. 60s matches the MCP
// route.
export const maxDuration = 60;

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const DEFAULT_TIMEZONE = process.env.ASI_TIMEZONE || "Australia/Melbourne";

const formatTimestamp = (value?: admin.firestore.Timestamp | null) => {
  if (!value) return "";
  const date = value.toDate();
  return date.toISOString();
};

const getTimeZoneOffset = (date: Date, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(lookup.year),
    Number(lookup.month) - 1,
    Number(lookup.day),
    Number(lookup.hour),
    Number(lookup.minute),
    Number(lookup.second)
  );
  return (asUtc - date.getTime()) / 60000;
};

const getDayRange = (timeZone: string) => {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(lookup.year);
  const month = Number(lookup.month);
  const day = Number(lookup.day);
  const utcMidnight = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const offsetMinutes = getTimeZoneOffset(utcMidnight, timeZone);
  const start = new Date(utcMidnight.getTime() - offsetMinutes * 60000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end, dateKey: `${year}-${lookup.month}-${lookup.day}`, timeZone };
};

const summarizeJob = (job: FirebaseFirestore.DocumentData, includeFinancial: boolean) => {
  const vehicles = Array.isArray(job.jobVehicles)
    ? job.jobVehicles.map((vehicle: any) => ({
        id: vehicle.id,
        registration: vehicle.registration || "",
        status: vehicle.status,
        repairSites: Array.isArray(vehicle.repairSites)
          ? vehicle.repairSites.map((repair: any) => ({
              id: repair.id,
              type: repair.repairType,
              location: repair.location,
              status: repair.workStatus || (repair.isCompleted ? "completed" : "not_started"),
              ...(includeFinancial
                ? { totalCost: repair.totalCost, labourCost: repair.labourCost, materialsCost: repair.materialsCost }
                : {}),
            }))
          : [],
      }))
    : [];

  return {
    jobNumber: job.jobNumber,
    clientName: job.clientName,
    status: job.status,
    scheduledDate: formatTimestamp(job.scheduledDate),
    completedDate: formatTimestamp(job.completedDate),
    siteAddress: job.siteLocation?.address || "",
    serviceType: job.notes?.split("\n")[0]?.replace("Service:", "").trim() || "",
    ...(includeFinancial
      ? {
          totalJobCost: job.totalJobCost ?? 0,
          totalLabourCost: job.totalLabourCost ?? 0,
          totalMaterialsCost: job.totalMaterialsCost ?? 0,
          invoiceNumber: job.invoiceNumber || "",
          invoiceDate: formatTimestamp(job.invoiceDate),
        }
      : {}),
    vehicles,
  };
};

const buildPrompt = ({
  role,
  userName,
  userEmail,
  context,
  message,
  history,
  liveContext,
  memory,
}: {
  role: "admin" | "technician";
  userName: string;
  userEmail: string;
  context: string;
  message: string;
  history: ChatMessage[];
  liveContext: Record<string, unknown>;
  memory: Record<string, unknown>;
}) => {
  const historyText = history
    .map((item) => `${item.role.toUpperCase()}: ${item.content}`)
    .join("\n");

  return [
    `You are speaking with ${userName} (${userEmail}), an ASI Australia ${role}.`,
    `Address them by their first name ("${userName.split(" ")[0]}"). Do NOT assume they are the founder (Josh Hyde) — always respect the actual user identified here.`,
    `Context: ${context || "dashboard"}`,
    "",
    "Live data context (JSON):",
    JSON.stringify(liveContext, null, 2),
    "",
    "Organisation knowledge base (latest updates):",
    JSON.stringify(memory, null, 2),
    "",
    "Conversation history:",
    historyText || "None",
    "",
    `${userName}'s request:`,
    message,
  ].join("\n");
};

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const payload = (await req.json()) as {
      message?: string;
      history?: ChatMessage[];
      context?: string;
      jobId?: string;
      agentOverride?: string;
    };

    const message = payload.message?.trim();
    if (!message) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    const userSnap = await admin.firestore().collection(COLLECTIONS.USERS).doc(userId).get();
    if (!userSnap.exists) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const user = userSnap.data() as { role?: string; name?: string; email?: string; organizationId?: string };
    if (user.role !== "admin" && user.role !== "technician") {
      return NextResponse.json({ error: "Access denied." }, { status: 403 });
    }

    const role = user.role;
    const agentOverride = payload.agentOverride;
    const isAthena = agentOverride === "athena" && role === "admin";
    const isGuardian = agentOverride === "guardian" && role === "admin";
    const isArcher = agentOverride === "archer" && role === "admin";
    const workflowId = role === "admin" ? AGENT_ADMIN : AGENT_TECH;

    let jobSummary: Record<string, unknown> | null = null;
    if (payload.jobId) {
      const jobSnap = await admin
        .firestore()
        .collection(COLLECTIONS.JOBS)
        .doc(payload.jobId)
        .get();
      if (jobSnap.exists) {
        const job = jobSnap.data();
        if (job) {
          if (role === "technician") {
            const assignedIds = (job.assignedTechnicianIds || []) as string[];
            if (!assignedIds.includes(userId)) {
              return NextResponse.json({ error: "Job access denied." }, { status: 403 });
            }
          }
          jobSummary = summarizeJob(job, role === "admin");
        }
      }
    }

    const liveContext: Record<string, unknown> = {
      user: {
        uid: userId,
        name: user.name || user.email?.split("@")[0] || "User",
        email: user.email || "",
        role,
      },
      job: jobSummary,
    };

    if (role === "admin") {
      const { start, end, dateKey, timeZone } = getDayRange(DEFAULT_TIMEZONE);
      const startTs = admin.firestore.Timestamp.fromDate(start);
      const endTs = admin.firestore.Timestamp.fromDate(end);

      const jobsSnap = await admin
        .firestore()
        .collection(COLLECTIONS.JOBS)
        .orderBy("updatedAt", "desc")
        .limit(50)
        .get();
      const jobCounts: Record<string, number> = {};
      jobsSnap.docs.forEach((docSnap) => {
        const status = (docSnap.data().status as string) || "unknown";
        jobCounts[status] = (jobCounts[status] || 0) + 1;
      });

      const inspectionsSnap = await admin
        .firestore()
        .collection(COLLECTIONS.INSPECTIONS)
        .where("status", "==", "submitted")
        .limit(10)
        .get();
      const pendingInspections = inspectionsSnap.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          client: data.clientName,
          status: data.status,
          createdAt: formatTimestamp(data.createdAt),
        };
      });

      const docsSnap = await admin
        .firestore()
        .collection(COLLECTIONS.IMS_DOCUMENTS)
        .where("status", "==", "active")
        .limit(12)
        .get();
      const activeDocs = docsSnap.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          docNumber: data.docNumber,
          title: data.title,
          type: data.docType,
        };
      });

      const worksSnap = await admin
        .firestore()
        .collection(COLLECTIONS.WORKS_REGISTER)
        .orderBy("createdAt", "desc")
        .limit(8)
        .get();
      const worksRecent = worksSnap.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          jobNumber: data.jobNumber,
          clientName: data.clientName,
          serviceType: data.serviceType,
          completionDate: formatTimestamp(data.completionDate),
        };
      });

      liveContext.metrics = {
        jobs: jobCounts,
        pendingInspections: pendingInspections.length,
      };
      liveContext.pendingInspections = pendingInspections;
      liveContext.activeImsDocs = activeDocs;
      liveContext.recentWorks = worksRecent;

      const [completedTodaySnap, closedTodaySnap, inspectionsApprovedSnap] = await Promise.all([
        admin
          .firestore()
          .collection(COLLECTIONS.JOBS)
          .where("completedDate", ">=", startTs)
          .where("completedDate", "<", endTs)
          .get(),
        admin
          .firestore()
          .collection(COLLECTIONS.JOBS)
          .where("closedAt", ">=", startTs)
          .where("closedAt", "<", endTs)
          .get(),
        admin
          .firestore()
          .collection(COLLECTIONS.INSPECTIONS)
          .where("approvedAt", ">=", startTs)
          .where("approvedAt", "<", endTs)
          .get(),
      ]);

      const completedToday = completedTodaySnap.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          jobNumber: data.jobNumber,
          clientName: data.clientName,
          completedDate: formatTimestamp(data.completedDate),
          status: data.status,
        };
      });
      const closedToday = closedTodaySnap.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          jobNumber: data.jobNumber,
          clientName: data.clientName,
          closedAt: formatTimestamp(data.closedAt),
          status: data.status,
        };
      });
      const inspectionsApprovedToday = inspectionsApprovedSnap.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          inspectionNumber: data.inspectionNumber,
          clientName: data.clientName,
          approvedAt: formatTimestamp(data.approvedAt),
          convertedToJobId: data.convertedToJobId || null,
        };
      });
      const inspectionsApprovedAndConverted = inspectionsApprovedToday.filter(
        (inspection) => inspection.convertedToJobId
      );

      const recentInspectionsSnap = await admin
        .firestore()
        .collection(COLLECTIONS.INSPECTIONS)
        .orderBy("updatedAt", "desc")
        .limit(12)
        .get();
      const recentInspections = recentInspectionsSnap.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          inspectionNumber: data.inspectionNumber,
          clientName: data.clientName,
          status: data.status,
          updatedAt: formatTimestamp(data.updatedAt),
        };
      });

      const knowledgeDocsSnap = await admin
        .firestore()
        .collection(COLLECTIONS.AGENT_HUB_DOCS)
        .orderBy("createdAt", "desc")
        .limit(6)
        .get();
      const knowledgeVault = knowledgeDocsSnap.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          title: data.title || data.fileName,
          summary: data.summary || "",
          sourceUrl: data.sourceUrl || null,
        };
      });

      liveContext.today = {
        dateKey,
        timeZone,
        start: start.toISOString(),
        end: end.toISOString(),
        jobsCompleted: completedToday,
        jobsClosed: closedToday,
        inspectionsApproved: inspectionsApprovedToday,
        inspectionsApprovedAndConverted,
      };
      liveContext.recentInspections = recentInspections;
      liveContext.knowledgeVault = knowledgeVault;

      // Archer-specific live context: the R&D portfolio + grants pipeline +
      // opportunity queue + watched programmes + pending nominations. Only
      // injected when the admin is talking to Archer — keeps the default
      // admin prompt lean, and gives Archer the full picture of her domain.
      if (isArcher) {
        // Cap each fetch tight — this all goes into the prompt. Big limits
        // bloat the token count without helping Archer's decision-making
        // and push the whole call past the function timeout.
        const [projectsSnap, grantsSnap, oppsSnap, programmesSnap, nominationsSnap] = await Promise.all([
          admin.firestore().collection(COLLECTIONS.RND_PROJECTS)
            .orderBy("updatedAt", "desc").limit(20).get(),
          admin.firestore().collection(COLLECTIONS.GRANT_APPLICATIONS)
            .orderBy("updatedAt", "desc").limit(15).get(),
          admin.firestore().collection(COLLECTIONS.RND_OPPORTUNITY_LOG)
            .orderBy("createdAt", "desc").limit(15).get(),
          admin.firestore().collection(COLLECTIONS.RND_GRANT_PROGRAMMES)
            .where("isActive", "==", true).limit(25).get(),
          admin.firestore().collection(COLLECTIONS.RND_PROJECT_NOMINATIONS)
            .orderBy("createdAt", "desc").limit(15).get().catch(() => null),
        ]);

        liveContext.rndProjects = projectsSnap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            projectNumber: d.projectNumber,
            title: d.title,
            shortDescription: d.shortDescription,
            phase: d.phase,
            status: d.status,
            domain: d.domain,
            priority: d.priority,
            estimatedBudget: d.estimatedBudget,
            actualSpendToDate: d.actualSpendToDate,
            requiresDirectorApproval: d.requiresDirectorApproval,
            approvals: d.approvals,
          };
        });

        liveContext.grants = grantsSnap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            grantNumber: d.grantNumber,
            programmeName: d.programmeName,
            programmeBody: d.programmeBody,
            stage: d.stage,
            fundingType: d.fundingType,
            awardValue: d.awardValue,
            awardedAmount: d.awardedAmount,
            submissionDeadline: d.submissionDeadline,
            expectedDecisionDate: d.expectedDecisionDate,
          };
        });

        liveContext.opportunityLog = oppsSnap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            opportunityNumber: d.opportunityNumber,
            title: d.title,
            type: d.type,
            status: d.status,
            sourcedBy: d.sourcedBy,
            reviewScore: d.reviewScore,
          };
        });

        liveContext.grantProgrammesWatchlist = programmesSnap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            programmeName: d.programmeName,
            programmeBody: d.programmeBody,
            level: d.level,
            jurisdiction: d.jurisdiction,
            fundingType: d.fundingType,
            typicalValueMin: d.typicalValueMin,
            typicalValueMax: d.typicalValueMax,
            nextRoundOpensAt: d.nextRoundOpensAt,
            fitScore: d.fitScore,
            tags: d.tags,
          };
        });

        if (nominationsSnap && !nominationsSnap.empty) {
          liveContext.rndNominations = nominationsSnap.docs.map((docSnap) => {
            const d = docSnap.data();
            return {
              id: docSnap.id,
              title: d.title,
              rationale: d.rationale,
              status: d.status,
              suggestedProgrammeIds: d.suggestedProgrammeIds,
              preFeas: d.preFeas,
              submittedBy: d.submittedBy,
              createdAt: formatTimestamp(d.createdAt),
            };
          });
        }
      }
    } else {
      const techJobsSnap = await admin
        .firestore()
        .collection(COLLECTIONS.JOBS)
        .where("assignedTechnicianIds", "array-contains", userId)
        .orderBy("updatedAt", "desc")
        .limit(10)
        .get();
      liveContext.assignedJobs = techJobsSnap.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          jobNumber: data.jobNumber,
          clientName: data.clientName,
          status: data.status,
          scheduledDate: formatTimestamp(data.scheduledDate),
          siteAddress: data.siteLocation?.address || "",
        };
      });

      const techDocsSnap = await admin
        .firestore()
        .collection(COLLECTIONS.IMS_DOCUMENTS)
        .where("status", "==", "active")
        .limit(20)
        .get();
      liveContext.technicalDocs = techDocsSnap.docs
        .map((docSnap) => docSnap.data())
        .filter((data) => ["technical_procedure", "work_instruction"].includes(data.docType))
        .slice(0, 12)
        .map((data) => ({
          docNumber: data.docNumber,
          title: data.title,
          type: data.docType,
        }));
    }

    let memoryUpdates: FirebaseFirestore.DocumentData[] = [];
    const knowledgeRef = admin.firestore().collection(COLLECTIONS.ASSISTANT_KNOWLEDGE);
    if (role === "admin") {
      const [adminSnap, techSnap] = await Promise.all([
        knowledgeRef.where("scope", "==", "admin").orderBy("createdAt", "desc").limit(6).get(),
        knowledgeRef.where("scope", "==", "tech").orderBy("createdAt", "desc").limit(6).get(),
      ]);
      memoryUpdates = [...adminSnap.docs, ...techSnap.docs]
        .map((docSnap) => docSnap.data())
        .sort((a, b) => {
          const aTime = a.createdAt?.toMillis?.() || 0;
          const bTime = b.createdAt?.toMillis?.() || 0;
          return bTime - aTime;
        })
        .slice(0, 10);
    } else {
      const techSnap = await knowledgeRef
        .where("scope", "==", "tech")
        .orderBy("createdAt", "desc")
        .limit(8)
        .get();
      memoryUpdates = techSnap.docs.map((docSnap) => docSnap.data());
    }

    const memory = {
      updates: memoryUpdates,
    };

    const resolvedName = user.name || user.email?.split("@")[0] || "User";
    const resolvedEmail = user.email || "";

    const prompt = buildPrompt({
      role,
      userName: resolvedName,
      userEmail: resolvedEmail,
      context: payload.context || "dashboard",
      message,
      history: Array.isArray(payload.history) ? payload.history.slice(-8) : [],
      liveContext,
      memory,
    });

    const agentInstructions = isAthena ? [
      "You are ATHENA, ASI Australia's Chief of Staff and Executive Intelligence Engine.",
      "ASI has multiple administrators. Always address the user by the name provided in the prompt — they are NOT always Josh Hyde. Current ASI admins include Josh Hyde, Jaydan, and Bobby. Treat whichever admin is speaking as your principal for this conversation.",
      "You operate under Jim Collins' frameworks: Good to Great (Hedgehog Concept, Flywheel, Stockdale Paradox), Built to Last (Clock Building, BHAGs), Beyond Entrepreneurship 2.0 (MAP, 20 Mile March).",
      "You have real-time access to the entire ASI operation. Lead with insight, not data. Be direct, quantify everything, be opinionated.",
      "Cross-reference departments: VANGUARD (supply chain OSINT), SENTINEL (sales), LEDGER (accounts/Xero), GUARDIAN (IMS/compliance), CIPHER (IT/web), MERIDIAN (geo-intel).",
      "Full task-delegation authority: any admin can ask you to assign, track, or close out work. Reference the live job/inspection/works data in the prompt, recommend the right owner/agent, and structure the next steps. When the admin says 'assign X to Y' or 'complete X', confirm and list the concrete actions they should take in the portal to finalise it.",
      "When asked for a brief or report, structure it clearly with sections. Flag overdue items, risks, and strategic patterns.",
      "Present the Flywheel check in weekly reports. Test recommendations against the Hedgehog Concept.",
      "Australian English. Never use hyperportal.online — the portal is asiportal.live.",
      "You ONLY output valid JSON with an `answer` field, optional `followUps`, `warnings`, `actionSuggestions`, and `knowledgeUpdates` arrays.",
    ].join("\n") : isGuardian ? [
      "You are GUARDIAN, ASI Australia's IMS Lead Auditor. You hold Lead Auditor certification across ISO 9001:2015 (Quality), ISO 14001:2015 (Environmental), and ISO 45001:2018 (WHS).",
      "ASI has multiple administrators. Always address the user by the name provided in the prompt — they are NOT always Josh Hyde. Current ASI admins include Josh Hyde, Jaydan, and Bobby. Treat whichever admin is speaking as your principal for this conversation.",
      "Your role is to develop, audit, and continuously improve ASI's Integrated Management System.",
      "You are meticulous, evidence-based, and systematic. You think in clauses, processes, and PDCA cycles.",
      "When asked to write procedures: use numbered steps, include responsibilities, reference ISO clauses, keep it practical for a lean operation.",
      "When asked to audit: cite the clause, state the requirement, present evidence from portal data, identify the gap, classify the finding (conformity/observation/OFI/minor NC/major NC), recommend corrective action.",
      "When asked about risk: always reference the risk register and link to ISO 6.1 risk-based thinking.",
      "When asked about incidents: follow the investigation workflow — 5 Whys or Fishbone, root cause, CAPAs, lessons learned.",
      "Track CAPAs rigorously — never close without verifying effectiveness.",
      "Task-capable: any admin can ask you to assign a CAPA, schedule an audit, or close an incident. Confirm the action, list the exact portal steps (collection/doc to update, fields to set), and include a follow-up to verify effectiveness.",
      "Proportionality: the system should be sized for a lean operation, not a multinational. Documents should be usable, not just auditable.",
      "Australian English. The portal is asiportal.live.",
      "You ONLY output valid JSON with an `answer` field, optional `followUps`, `warnings`, `actionSuggestions`, and `knowledgeUpdates` arrays.",
    ].join("\n") : isArcher ? [
      "You are SOPHIE ARCHER, ASI Australia's R&D Programme Lead and Head of Grants. You run the Research & Development programme register, the grants pipeline, the opportunity log, and the grant programmes watchlist.",
      "ASI has multiple administrators. Always address the user by the name provided in the prompt — they are NOT always Josh Hyde. Current ASI admins include Josh Hyde, Jaydan, and Bobby. Treat whichever admin is speaking as your principal for this conversation.",
      "You think in terms of the R&D Tax Incentive, cooperative research centres, state grants (VIC Innovation Fund, SA Research Commercialisation, etc.), federal grants (MMF, CRC-P, Industry Growth Program), and the ASI Flywheel — every project should feed commercial capability, IMS evidence, or both.",
      "Jim Collins' Beyond Entrepreneurship 2.0 is your operating manual for portfolio decisions: Hedgehog Concept (what can ASI be best in Australia at?), 20 Mile March (consistent monthly R&D throughput), Level 5 discipline, Stockdale Paradox (brutal facts + faith in outcome).",
      "When writing a pre-feas brief: strategic fit (1-5), technical feasibility (1-5), market/regulatory context, grant match from the watchlist, cost envelope (order of magnitude), flags/risks, and a crisp verdict (pursue / park / reject). Keep each section tight — 3-6 sentences max.",
      "When reviewing a nomination: check domain fit against ASI's five sectors, check the grant match against the live watchlist in the live context, check whether it advances a current BHAG or is orthogonal.",
      "When discussing grants: reference specific programmes by name, note the next-round-opens date if known, flag acquittal obligations before they become overdue.",
      "Task-capable: any admin can ask you to create a nomination, write a pre-feas, recommend a grant programme match, or propose a project. Reference the live R&D portfolio data in the prompt (projects, grants, opportunities, programmes). When the admin asks 'pre-feas this' or 'write up a nomination', produce the structured brief.",
      "Australian English. The portal is asiportal.live.",
      "You ONLY output valid JSON with an `answer` field, optional `followUps`, `warnings`, `actionSuggestions`, and `knowledgeUpdates` arrays.",
    ].join("\n") : undefined;

    const result = await runWorkflowJson({
      workflowId,
      input: prompt,
      schema: InternalKnowledgeSchema,
      timeoutMs: 45000,
      maxRetries: 2,
      instructionsOverride: agentInstructions,
    });

    const now = admin.firestore.FieldValue.serverTimestamp();
    const knowledgeUpdates = result.parsed.knowledgeUpdates || [];
    if (knowledgeUpdates.length) {
      await Promise.all(
        knowledgeUpdates.map((update) =>
          admin
            .firestore()
            .collection(COLLECTIONS.ASSISTANT_KNOWLEDGE)
            .add({
              summary: update.summary,
              tags: update.tags,
              scope: role === "admin" ? update.scope : "tech",
              organizationId: user.organizationId || null,
              createdAt: now,
              createdById: userId,
              createdByName: user.name || user.email || "User",
              context: payload.context || "dashboard",
              jobId: payload.jobId || null,
            })
        )
      );
    }

    await admin.firestore().collection(COLLECTIONS.ASSISTANT_MESSAGES).add({
      userId,
      role,
      organizationId: user.organizationId || null,
      context: payload.context || "dashboard",
      jobId: payload.jobId || null,
      message,
      response: result.parsed.answer,
      createdAt: now,
    });

    return NextResponse.json({
      answer: result.parsed.answer,
      followUps: result.parsed.followUps,
      warnings: result.parsed.warnings,
      actionSuggestions: result.parsed.actionSuggestions,
      audit: role === "admin" ? result.parsed.audit || null : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Assistant request failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
