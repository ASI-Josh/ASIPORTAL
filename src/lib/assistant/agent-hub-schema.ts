import { z } from "zod";

const MoltbookRegisterSchema = z
  .object({
    type: z.literal("moltbook.register"),
    summary: z.string(),
    payload: z
      .object({
        name: z.string(),
        description: z.string().nullable(),
        website: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

const MoltbookPostSchema = z
  .object({
    type: z.literal("moltbook.post"),
    summary: z.string(),
    payload: z
      .object({
        title: z.string(),
        body: z.string(),
        tags: z.array(z.string()),
      })
      .strict(),
  })
  .strict();

const MoltbookCommentSchema = z
  .object({
    type: z.literal("moltbook.comment"),
    summary: z.string(),
    payload: z
      .object({
        postId: z.string(),
        body: z.string(),
      })
      .strict(),
  })
  .strict();

const MoltbookReactSchema = z
  .object({
    type: z.literal("moltbook.react"),
    summary: z.string(),
    payload: z
      .object({
        postId: z.string(),
        reaction: z.string(),
      })
      .strict(),
  })
  .strict();

export const AgentHubActionRequestSchema = z.discriminatedUnion("type", [
  MoltbookRegisterSchema,
  MoltbookPostSchema,
  MoltbookCommentSchema,
  MoltbookReactSchema,
]);

export const AgentHubAgentSchema = z
  .object({
    answer: z.string(),
    warnings: z.array(z.string()),
    actionRequests: z.array(AgentHubActionRequestSchema),
    knowledgeUpdates: z.array(
      z.object({
        summary: z.string(),
        tags: z.array(z.string()),
        scope: z.enum(["admin", "tech"]),
      })
    ),
  })
  .strict();

export type AgentHubAgentOutput = z.infer<typeof AgentHubAgentSchema>;
