"use server";

import { z } from "zod";
import { runWorkflowJson } from "@/lib/openai-workflow";

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

const ImsAuditorSchema = z.object({
  metadata: z.object({
    auditId: z.string(),
    standard: z.enum(["ISO9001:2015"]),
    scope: z.string(),
    period: z.string(),
    sites: z.array(z.string()),
    processes: z.array(z.string()),
    leadAuditor: z.string(),
    auditDate: z.string(),
    status: z.enum(["planned", "in_progress", "completed"]),
  }),
  plan: z.object({
    objectives: z.array(z.string()),
    criteria: z.array(z.string()),
    methods: z.array(z.string()),
    schedule: z.array(
      z.object({
        area: z.string(),
        time: z.string(),
        owner: z.string(),
      })
    ),
  }),
  checklist: z.array(
    z.object({
      clause: z.string(),
      question: z.string(),
      evidenceNeeded: z.string(),
      records: z.array(z.string()),
    })
  ),
  findings: z.array(
    z.object({
      id: z.string(),
      type: z.enum(["conformity", "observation", "OFI", "minor_nc", "major_nc"]),
      clause: z.string(),
      requirement: z.string(),
      evidence: z.string(),
      description: z.string(),
      risk: z.string(),
      correctiveAction: z.string(),
      owner: z.string(),
      dueDate: z.string(),
      status: z.enum(["open", "closed"]),
    })
  ),
  summary: z.object({
    strengths: z.array(z.string()),
    risks: z.array(z.string()),
    overallConclusion: z.string(),
  }),
  questions: z.array(z.string()),
});

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
