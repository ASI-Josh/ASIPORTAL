"use server";

import { generateJobDescription } from "@/ai/flows/generate-job-descriptions";
import { generateInspectionSummary } from "@/ai/flows/generate-inspection-summary";
import { summarizeLeadNotes } from "@/ai/flows/summarize-lead-notes";
import { runWorkflowJson } from "@/lib/openai-workflow";
import { z } from "zod";

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
      "Return the job description in the JSON `answer` field.",
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
      if (result.parsed.answer) return result.parsed.answer;
    } catch (error) {
      console.warn("OpenAI job description failed, falling back to Genkit:", error);
    }
  }

  const result = await generateJobDescription({ clientRequest });
  return result.jobDescription;
}

export async function summarizeLeadNotesAction(notes: string) {
  const result = await summarizeLeadNotes({ notes });
  return result.summary;
}

export async function generateInspectionSummaryAction(inspectionData: string) {
  const result = await generateInspectionSummary({ inspectionData });
  return result.summary;
}
