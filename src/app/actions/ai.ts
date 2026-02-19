"use server";

import { generateJobDescription } from "@/ai/flows/generate-job-descriptions";
import { generateInspectionSummary } from "@/ai/flows/generate-inspection-summary";
import { summarizeLeadNotes } from "@/ai/flows/summarize-lead-notes";
import { extractJsonCandidate, normalizeAiGeneratedText } from "@/lib/ai-text-format";
import { runWorkflowJson } from "@/lib/openai-workflow";
import { z } from "zod";

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function safeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatStructuredJobDescription(value: Record<string, unknown>) {
  const lines: string[] = [];

  const jobTitle = safeString(value.jobTitle) || "Job description";
  const workOrder = safeString(value.workOrder);
  const scheduledDate = safeString(value.scheduledDate);

  lines.push(jobTitle);
  const metaParts = [workOrder && `Work order: ${workOrder}`, scheduledDate && `Scheduled: ${scheduledDate}`].filter(
    Boolean
  ) as string[];
  if (metaParts.length > 0) lines.push(metaParts.join(" | "));
  lines.push("");

  const jobSummary = safeString(value.jobSummary);
  if (jobSummary) {
    lines.push("Summary");
    lines.push(jobSummary);
    lines.push("");
  }

  const scopeOfWork = Array.isArray(value.scopeOfWork) ? value.scopeOfWork : [];
  if (scopeOfWork.length > 0) {
    lines.push("Scope of work");
    scopeOfWork.forEach((item) => {
      if (!item || typeof item !== "object") return;
      const record = item as Record<string, unknown>;
      const task = safeString(record.task) || "Task";
      const qty = safeNumber(record.quantity);
      const unit = safeString(record.unit);
      const qtyText = qty !== null ? `${qty} ${unit || ""}`.trim() : "";
      const heading = qtyText ? `${task} - ${qtyText}` : task;
      lines.push(`- ${heading}`);
      const notes = safeString(record.notes);
      if (notes) lines.push(`  - ${notes}`);
    });
    lines.push("");
  }

  const responsibilities = Array.isArray(value.technicianResponsibilities)
    ? value.technicianResponsibilities
    : [];
  if (responsibilities.length > 0) {
    lines.push("Technician responsibilities");
    responsibilities.forEach((item) => {
      const text = safeString(item);
      if (text) lines.push(`- ${text}`);
    });
    lines.push("");
  }

  const quality = Array.isArray(value.qualityRequirements) ? value.qualityRequirements : [];
  if (quality.length > 0) {
    lines.push("Quality requirements");
    quality.forEach((item) => {
      const text = safeString(item);
      if (text) lines.push(`- ${text}`);
    });
    lines.push("");
  }

  const safety = Array.isArray(value.safetyAndCompliance) ? value.safetyAndCompliance : [];
  if (safety.length > 0) {
    lines.push("Safety & compliance");
    safety.forEach((item) => {
      const text = safeString(item);
      if (text) lines.push(`- ${text}`);
    });
    lines.push("");
  }

  const deliverables = Array.isArray(value.deliverables) ? value.deliverables : [];
  if (deliverables.length > 0) {
    lines.push("Deliverables");
    deliverables.forEach((item) => {
      const text = safeString(item);
      if (text) lines.push(`- ${text}`);
    });
    lines.push("");
  }

  const lineItems = Array.isArray(value.lineItemsForReference) ? value.lineItemsForReference : [];
  if (lineItems.length > 0) {
    lines.push("Line items (reference)");
    lineItems.forEach((item) => {
      const text = safeString(item);
      if (text) lines.push(`- ${text}`);
    });
    lines.push("");
  }

  const dispatcherNotes = safeString(value.notesForDispatcher);
  if (dispatcherNotes) {
    lines.push("Dispatcher notes");
    lines.push(`- ${dispatcherNotes}`);
    lines.push("");
  }

  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeJobDescriptionOutput(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;

  const candidate = extractJsonCandidate(trimmed);
  if (!candidate) return normalizeAiGeneratedText(trimmed);
  try {
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return normalizeAiGeneratedText(trimmed);
    }
    const formatted = formatStructuredJobDescription(parsed as Record<string, unknown>);
    return normalizeAiGeneratedText(formatted || trimmed);
  } catch {
    return normalizeAiGeneratedText(trimmed);
  }
}

export async function generateJobDescriptionAction(clientRequest: string) {
  const workflowId =
    process.env.OPENAI_INTERNAL_TECH_WORKFLOW_ID ||
    process.env.OPENAI_INTERNAL_ADMIN_WORKFLOW_ID;
  if (workflowId) {
    const JobDescriptionSchema = z.object({
      answer: z.string(),
    }).passthrough();
    const prompt = [
      "Generate a clear, detailed job description for a technician.",
      "Use the client request below.",
      "Return the job description in the JSON `answer` field as plain text (NOT JSON).",
      "Use short headings and bullet points, suitable to paste into a job card description.",
      "If no new organisational knowledge is added, return an empty knowledgeUpdates array.",
      "",
      `Client request: ${clientRequest}`,
    ].join("\n");
    try {
      const result = await runWorkflowJson({
        workflowId,
        input: prompt,
        schema: JobDescriptionSchema,
        timeoutMs: 30000,
        maxRetries: 1,
      });
      if (result.parsed.answer) return normalizeJobDescriptionOutput(result.parsed.answer);
    } catch (error) {
      console.warn("OpenAI job description failed, falling back to Genkit:", error);
    }
  }

  const result = await generateJobDescription({ clientRequest });
  return normalizeJobDescriptionOutput(result.jobDescription);
}

export async function summarizeLeadNotesAction(notes: string) {
  const result = await summarizeLeadNotes({ notes });
  return result.summary;
}

export async function generateInspectionSummaryAction(inspectionData: string) {
  const result = await generateInspectionSummary({ inspectionData });
  return normalizeAiGeneratedText(result.summary);
}

