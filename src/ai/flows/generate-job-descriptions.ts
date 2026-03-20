'use server';

import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient, DEFAULT_MODEL } from "@/lib/anthropic";

const GenerateJobDescriptionInputSchema = z.object({
  clientRequest: z.string().describe('A brief description of the client request for the job.'),
});
export type GenerateJobDescriptionInput = z.infer<typeof GenerateJobDescriptionInputSchema>;

const GenerateJobDescriptionOutputSchema = z.object({
  jobDescription: z.string().describe('A detailed job description for the technician.'),
});
export type GenerateJobDescriptionOutput = z.infer<typeof GenerateJobDescriptionOutputSchema>;

export async function generateJobDescription(
  input: GenerateJobDescriptionInput
): Promise<GenerateJobDescriptionOutput> {
  const systemPrompt = [
    "You are an expert project manager at an Australian vehicle repair business.",
    "Generate a detailed job description for a technician based on the client's request.",
    "Be specific and include all necessary information for the technician to complete the job successfully.",
    "Use short headings and bullet points. Write in Australian English.",
    "Return ONLY a valid JSON object: { \"jobDescription\": \"...\" }",
    "Do not include markdown fences or any text outside the JSON.",
  ].join("\n");

  const anthropic = getAnthropicClient();
  const response = await anthropic.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: `Client Request: ${input.clientRequest}` }],
  });

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  const parsed = JSON.parse(cleaned);
  return GenerateJobDescriptionOutputSchema.parse(parsed);
}
