"use server";

import { runWorkflowJson, AGENT_DOC_MANAGER } from "@/lib/openai-workflow";
import { DocumentManagerAgentSchema } from "@/lib/assistant/ims-schemas";

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
  const prompt = buildPrompt(params);
  const result = await runWorkflowJson({
    workflowId: AGENT_DOC_MANAGER,
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
