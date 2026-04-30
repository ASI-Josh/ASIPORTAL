import { z } from "zod";

// Proposed actions GUARDIAN (and other write-capable agents) can stage
// for one-click confirmation in the chat UI. Each entry maps 1:1 onto
// an existing MCP IMS document handler — the assistant-action route is
// the only thing that executes them, with role gating.
//
// Approve and activate are admin-confirmed at the UI layer because they
// are document-control sign-offs (ISO 7.5.3), not authoring steps.

const CreateImsDocumentDraftAction = z.object({
  kind: z.literal("create_ims_document_draft"),
  payload: z.object({
    title: z.string(),
    type: z.string(),
    content: z.string(),
    docId: z.string().optional(),
    processOwner: z.string().optional(),
    isoClauses: z.array(z.string()).optional().default([]),
    rndProjectId: z.string().optional(),
    rndNominationId: z.string().optional(),
    rndFolder: z
      .enum([
        "pm_planning",
        "engineering_design",
        "administration",
        "finance",
        "legal",
        "project_filing",
      ])
      .optional(),
    rndFinancialYear: z.string().optional(),
  }),
});

const UpdateImsDocumentAction = z.object({
  kind: z.literal("update_ims_document"),
  payload: z.object({
    id: z.string(),
    updates: z.record(z.unknown()),
    changeNote: z.string().optional(),
  }),
});

const SubmitImsDocumentAction = z.object({
  kind: z.literal("submit_ims_document_for_review"),
  payload: z.object({
    id: z.string(),
  }),
});

const ApproveImsDocumentAction = z.object({
  kind: z.literal("approve_ims_document"),
  payload: z.object({
    id: z.string(),
    nextReviewDate: z.string(),
    effectiveDate: z.string().optional(),
  }),
});

const ActivateImsDocumentAction = z.object({
  kind: z.literal("activate_ims_document"),
  payload: z.object({
    id: z.string(),
  }),
});

const ObsoleteImsDocumentAction = z.object({
  kind: z.literal("obsolete_ims_document"),
  payload: z.object({
    id: z.string(),
    reason: z.string(),
  }),
});

export const ProposedActionSchema = z.discriminatedUnion("kind", [
  CreateImsDocumentDraftAction,
  UpdateImsDocumentAction,
  SubmitImsDocumentAction,
  ApproveImsDocumentAction,
  ActivateImsDocumentAction,
  ObsoleteImsDocumentAction,
]);

export type ProposedAction = z.infer<typeof ProposedActionSchema>;
export type ProposedActionKind = ProposedAction["kind"];

export const InternalKnowledgeSchema = z.object({
  answer: z.string(),
  followUps: z.array(z.string()).optional().default([]),
  warnings: z.array(z.string()).optional().default([]),
  actionSuggestions: z.array(z.string()).optional().default([]),
  proposedActions: z.array(ProposedActionSchema).optional().default([]),
  knowledgeUpdates: z
    .array(
      z.object({
        summary: z.string(),
        tags: z.array(z.string()).optional().default([]),
        scope: z.enum(["admin", "tech"]),
      })
    )
    .optional()
    .default([]),
  audit: z
    .object({
      status: z.enum(["pass", "needs_attention"]),
      issues: z.array(z.string()).optional().default([]),
      billingNotes: z.array(z.string()).optional().default([]),
      commercialOpportunities: z.array(z.string()).optional().default([]),
      improvements: z.array(z.string()).optional().default([]),
      complianceChecks: z.array(z.string()).optional().default([]),
    })
    .optional(),
});

export type InternalKnowledgeOutput = z.infer<typeof InternalKnowledgeSchema>;
