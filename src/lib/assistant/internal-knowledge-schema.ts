import { z } from "zod";

export const InternalKnowledgeSchema = z.object({
  answer: z.string(),
  followUps: z.array(z.string()),
  warnings: z.array(z.string()),
  actionSuggestions: z.array(z.string()),
  knowledgeUpdates: z.array(
    z.object({
      summary: z.string(),
      tags: z.array(z.string()),
      scope: z.enum(["admin", "tech"]),
    })
  ),
  audit: z
    .object({
      status: z.enum(["pass", "needs_attention"]),
      issues: z.array(z.string()),
      billingNotes: z.array(z.string()),
      commercialOpportunities: z.array(z.string()),
      improvements: z.array(z.string()),
      complianceChecks: z.array(z.string()),
    })
    .optional(),
});

export type InternalKnowledgeOutput = z.infer<typeof InternalKnowledgeSchema>;
