"use server";

import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";
import { InternalKnowledgeSchema } from "@/lib/assistant/internal-knowledge-schema";
import { runWorkflowJson } from "@/lib/openai-workflow";

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
  context,
  message,
  history,
  liveContext,
  memory,
}: {
  role: "admin" | "technician";
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
    `User role: ${role}`,
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
    "User request:",
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
    const workflowId =
      role === "admin"
        ? process.env.OPENAI_INTERNAL_ADMIN_WORKFLOW_ID
        : process.env.OPENAI_INTERNAL_TECH_WORKFLOW_ID;

    if (!workflowId) {
      return NextResponse.json({ error: "Missing workflow configuration." }, { status: 500 });
    }

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
        name: user.name || user.email || "User",
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

    const prompt = buildPrompt({
      role,
      context: payload.context || "dashboard",
      message,
      history: Array.isArray(payload.history) ? payload.history.slice(-8) : [],
      liveContext,
      memory,
    });

    const result = await runWorkflowJson({
      workflowId,
      input: prompt,
      schema: InternalKnowledgeSchema,
      timeoutMs: 45000,
      maxRetries: 2,
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
