'use server';

import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient, DEFAULT_MODEL } from "@/lib/anthropic";

const GenerateInspectionSummaryInputSchema = z.object({
  inspectionData: z.string().describe('Structured inspection details including organisation, contact, vehicles, damages, and totals.'),
});
export type GenerateInspectionSummaryInput = z.infer<typeof GenerateInspectionSummaryInputSchema>;

const GenerateInspectionSummaryOutputSchema = z.object({
  summary: z.string().describe('A concise inspection report summary suitable for client communication.'),
});
export type GenerateInspectionSummaryOutput = z.infer<typeof GenerateInspectionSummaryOutputSchema>;

export async function generateInspectionSummary(
  input: GenerateInspectionSummaryInput
): Promise<GenerateInspectionSummaryOutput> {
  const systemPrompt = [
    "You are an operations coordinator at an Australian vehicle repair business.",
    "Create a clear, client-facing inspection report summary in Australian English.",
    "Use short paragraphs and bullet points where helpful. Include:",
    "- Inspection overview (date/time, site, organisation, contact)",
    "- Vehicle list with key damage sites and severity",
    "- Estimated costs (labour, materials, total)",
    "- Any notes or next steps mentioned",
    "",
    'Return ONLY a valid JSON object: { "summary": "..." }',
    "Do not include markdown fences or any text outside the JSON.",
  ].join("\n");

  const anthropic = getAnthropicClient();
  const response = await anthropic.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: `Inspection data:\n${input.inspectionData}` }],
  });

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  const parsed = JSON.parse(cleaned);
  return GenerateInspectionSummaryOutputSchema.parse(parsed);
}
