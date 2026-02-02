import { z } from "zod";

export const DocumentManagerAgentSchema = z.object({
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

export const ImsAuditorSchema = z.object({
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

export type DocumentManagerAgentOutput = z.infer<typeof DocumentManagerAgentSchema>;
export type ImsAuditorOutput = z.infer<typeof ImsAuditorSchema>;

