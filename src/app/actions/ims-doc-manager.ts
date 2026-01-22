"use server";

import { z } from "zod";
import { runWorkflowJson } from "@/lib/openai-workflow";

type GenerateDraftParams = {
  docNumber: string;
  title: string;
  docType: string;
  revision: string;
  issueDate: string;
  processOwner: string;
  isoClauses: string[];
  relatedDocs: string[];
  brief: string;
};

const DocumentManagerAgentSchema = z.object({
  metadata: z.object({
    docId: z.string(),
    title: z.string(),
    type: z.enum([
      "policy",
      "manual",
      "ims_procedure",
      "technical_procedure",
      "work_instruction",
      "form",
      "register",
    ]),
    status: z.enum(["draft", "proposed", "active", "obsolete"]),
    revision: z.string(),
    issueDate: z.string(),
    processOwner: z.string(),
    isoClauses: z.array(z.string()),
    relatedDocs: z.array(z.string()),
  }),
  sections: z.array(
    z.object({
      title: z.string(),
      content: z.string(),
    })
  ),
  changeSummary: z.array(z.string()),
  adminIssuanceChecklist: z.array(z.string()),
  questions: z.array(z.string()),
});

const buildPrompt = (params: GenerateDraftParams) => {
  return [
    "Create a controlled IMS document draft in strict JSON per schema.",
    "If required inputs are missing, respond with questions only (sections empty).",
    "",
    "Document metadata:",
    `Doc ID: ${params.docNumber}`,
    `Title: ${params.title}`,
    `Type: ${params.docType}`,
    "Status: draft",
    `Revision: ${params.revision}`,
    `Issue date: ${params.issueDate}`,
    `Process owner: ${params.processOwner || ""}`,
    `ISO clauses: ${params.isoClauses.join(", ")}`,
    `Related docs: ${params.relatedDocs.join(", ")}`,
    "",
    "Brief / requirements:",
    params.brief || "",
  ].join("\n");
};

export async function generateImsDocumentDraftAction(params: GenerateDraftParams) {
  const workflowId =
    process.env.OPENAI_DOC_MANAGER_WORKFLOW_ID || process.env.OPENAI_WORKFLOW_ID;

  if (!workflowId) {
    throw new Error("Missing OPENAI_DOC_MANAGER_WORKFLOW_ID.");
  }

  const prompt = buildPrompt(params);
  const result = await runWorkflowJson({
    workflowId,
    input: prompt,
    schema: DocumentManagerAgentSchema,
    timeoutMs: 45000,
    maxRetries: 2,
  });

  return {
    draft: result.parsed,
    raw: result.raw,
  };
}
