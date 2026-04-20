import { z } from "zod";

export const InternalKnowledgeSchema = z.object({
  answer: z.string(),
  followUps: z.array(z.string()).optional().default([]),
  warnings: z.array(z.string()).optional().default([]),
  actionSuggestions: z.array(z.string()).optional().default([]),
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
