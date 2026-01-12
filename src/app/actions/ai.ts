"use server";

import { generateJobDescription } from "@/ai/flows/generate-job-descriptions";
import { summarizeLeadNotes } from "@/ai/flows/summarize-lead-notes";

export async function generateJobDescriptionAction(clientRequest: string) {
  const result = await generateJobDescription({ clientRequest });
  return result.jobDescription;
}

export async function summarizeLeadNotesAction(notes: string) {
  const result = await summarizeLeadNotes({ notes });
  return result.summary;
}
