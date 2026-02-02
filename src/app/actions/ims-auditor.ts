"use server";

import { runWorkflowJson } from "@/lib/openai-workflow";
import { ImsAuditorSchema } from "@/lib/assistant/ims-schemas";

type GenerateAuditParams = {
  auditId: string;
  scope: string;
  period: string;
  sites: string[];
  processes: string[];
  leadAuditor: string;
  auditDate: string;
  status: "planned" | "in_progress" | "completed";
  evidenceSources: string;
  brief: string;
};

const buildPrompt = (params: GenerateAuditParams) => {
  return [
    "Create an internal audit plan, checklist, and findings log in strict JSON per schema.",
    "If required inputs are missing, respond with questions only.",
    "",
    "Audit metadata:",
    `Audit ID: ${params.auditId}`,
    `Standard: ISO9001:2015`,
    `Audit date: ${params.auditDate}`,
    `Status: ${params.status}`,
    `Scope: ${params.scope}`,
    `Period: ${params.period}`,
    `Sites: ${params.sites.join(", ")}`,
    `Processes: ${params.processes.join(", ")}`,
    `Lead auditor: ${params.leadAuditor}`,
    "",
    "Evidence sources:",
    params.evidenceSources || "",
    "",
    "Additional instructions:",
    params.brief || "",
  ].join("\n");
};

export async function generateImsAuditReportAction(params: GenerateAuditParams) {
  const workflowId =
    process.env.OPENAI_IMS_AUDITOR_WORKFLOW_ID || process.env.OPENAI_WORKFLOW_ID;

  if (!workflowId) {
    throw new Error("Missing OPENAI_IMS_AUDITOR_WORKFLOW_ID.");
  }

  const prompt = buildPrompt(params);
  const result = await runWorkflowJson({
    workflowId,
    input: prompt,
    schema: ImsAuditorSchema,
    timeoutMs: 45000,
    maxRetries: 2,
  });

  return {
    report: result.parsed,
    raw: result.raw,
  };
}
