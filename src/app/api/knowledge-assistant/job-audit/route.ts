"use server";

import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";
import { InternalKnowledgeSchema } from "@/lib/assistant/internal-knowledge-schema";
import { runWorkflowJson } from "@/lib/openai-workflow";

const formatTimestamp = (value?: admin.firestore.Timestamp | null) => {
  if (!value) return "";
  return value.toDate().toISOString();
};

const summarizeJobForAudit = (job: FirebaseFirestore.DocumentData) => {
  const vehicles = Array.isArray(job.jobVehicles)
    ? job.jobVehicles.map((vehicle: any) => ({
        registration: vehicle.registration || "",
        status: vehicle.status,
        repairSites: Array.isArray(vehicle.repairSites)
          ? vehicle.repairSites.map((repair: any) => ({
              type: repair.repairType,
              location: repair.location,
              status: repair.workStatus || (repair.isCompleted ? "completed" : "not_started"),
              totalCost: repair.totalCost,
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
    totalJobCost: job.totalJobCost ?? 0,
    totalLabourCost: job.totalLabourCost ?? 0,
    totalMaterialsCost: job.totalMaterialsCost ?? 0,
    invoiceNumber: job.invoiceNumber || "",
    invoiceDate: formatTimestamp(job.invoiceDate),
    vehicles,
    notes: job.notes || "",
  };
};

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const payload = (await req.json()) as { jobId?: string };
    if (!payload.jobId) {
      return NextResponse.json({ error: "Job ID is required." }, { status: 400 });
    }

    const userSnap = await admin.firestore().collection(COLLECTIONS.USERS).doc(userId).get();
    if (!userSnap.exists) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }
    const user = userSnap.data() as { role?: string; name?: string; email?: string };
    if (user.role !== "admin" && user.role !== "technician") {
      return NextResponse.json({ error: "Access denied." }, { status: 403 });
    }

    const jobSnap = await admin
      .firestore()
      .collection(COLLECTIONS.JOBS)
      .doc(payload.jobId)
      .get();
    if (!jobSnap.exists) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    const job = jobSnap.data() as FirebaseFirestore.DocumentData;
    if (user.role === "technician") {
      const assigned = (job.assignedTechnicianIds || []) as string[];
      if (!assigned.includes(userId)) {
        return NextResponse.json({ error: "Job access denied." }, { status: 403 });
      }
    }

    const workflowId = process.env.OPENAI_INTERNAL_ADMIN_WORKFLOW_ID;
    if (!workflowId) {
      return NextResponse.json({ error: "Missing admin workflow configuration." }, { status: 500 });
    }

    const jobSummary = summarizeJobForAudit(job);
    const prompt = [
      "Run a job completion audit and return the audit object in the JSON response.",
      "Focus on compliance, billing readiness, commercial risks/opportunities, and continuous improvement.",
      "",
      "Job summary (JSON):",
      JSON.stringify(jobSummary, null, 2),
    ].join("\n");

    const result = await runWorkflowJson({
      workflowId,
      input: prompt,
      schema: InternalKnowledgeSchema,
      timeoutMs: 45000,
      maxRetries: 2,
    });

    const audit = result.parsed.audit;
    if (!audit) {
      return NextResponse.json({ error: "Audit response missing." }, { status: 500 });
    }

    const now = admin.firestore.Timestamp.now();
    await admin.firestore().collection(COLLECTIONS.JOBS).doc(payload.jobId).set(
      {
        completionAudit: {
          ...audit,
          generatedAt: now,
          generatedBy: userId,
          source: "agent",
        },
        updatedAt: now,
      },
      { merge: true }
    );

    return NextResponse.json({
      audit,
      jobId: payload.jobId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Job audit failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
