'use server';

import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient, DEFAULT_MODEL } from "@/lib/anthropic";

const SummarizeLeadNotesInputSchema = z.object({
  notes: z.string().describe('The lengthy notes from customer interactions to summarize.'),
});
export type SummarizeLeadNotesInput = z.infer<typeof SummarizeLeadNotesInputSchema>;

const SummarizeLeadNotesOutputSchema = z.object({
  summary: z.string().describe('A concise summary of the lead notes.'),
});
export type SummarizeLeadNotesOutput = z.infer<typeof SummarizeLeadNotesOutputSchema>;

export async function summarizeLeadNotes(
  input: SummarizeLeadNotesInput
): Promise<SummarizeLeadNotesOutput> {
  const systemPrompt = [
    "You are an AI assistant helping sales agents at an Australian vehicle repair business quickly understand customer interactions.",
    "Summarise the lead notes, extracting the key points and important details.",
    "Use Australian English. Be concise.",
    'Return ONLY a valid JSON object: { "summary": "..." }',
    "Do not include markdown fences or any text outside the JSON.",
  ].join("\n");

  const anthropic = getAnthropicClient();
  const response = await anthropic.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 512,
    system: systemPrompt,
    messages: [{ role: "user", content: `Lead Notes:\n${input.notes}` }],
  });

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  const parsed = JSON.parse(cleaned);
  return SummarizeLeadNotesOutputSchema.parse(parsed);
}
