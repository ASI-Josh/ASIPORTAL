'use server';

import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient, DEFAULT_MODEL } from "@/lib/anthropic";

const GenerateDashboardInsightsInputSchema = z.object({
  metrics: z.string().describe('JSON metrics payload including revenue, glass saved, operations, and client activity.'),
  audience: z.enum(['admin', 'client']).default('admin').describe('Target audience for the insights.'),
});
export type GenerateDashboardInsightsInput = z.infer<typeof GenerateDashboardInsightsInputSchema>;

const GenerateDashboardInsightsOutputSchema = z.object({
  summary: z.string().describe('Short executive summary in Australian English.'),
  risks: z.array(z.string()).describe('Key risk alerts detected.'),
  opportunities: z.array(z.string()).describe('Opportunities to improve revenue or service value.'),
  alerts: z.array(z.string()).describe('Operational alerts to surface in the dashboard.'),
});
export type GenerateDashboardInsightsOutput = z.infer<typeof GenerateDashboardInsightsOutputSchema>;

export async function generateDashboardInsights(
  input: GenerateDashboardInsightsInput
): Promise<GenerateDashboardInsightsOutput> {
  const systemPrompt = [
    "You are an operations and commercial analyst for an Australian vehicle repair business.",
    "Summarise dashboard metrics clearly and identify risks and opportunities. Use Australian English and keep everything concise.",
    "",
    "If audience is 'client', write in client-friendly language:",
    "- Focus on service progress, approvals, and scheduling.",
    "- Avoid internal revenue, margin, compliance, or operational performance language.",
    "- Never mention internal KPIs or admin-only metrics.",
    "",
    "Return ONLY a valid JSON object with exactly these keys:",
    '{ "summary": "2-3 sentences max", "risks": ["2-4 items"], "opportunities": ["2-4 items"], "alerts": ["2-4 items"] }',
    "Do not include markdown fences or any text outside the JSON.",
  ].join("\n");

  const userMessage = `Audience: ${input.audience}\n\nMetrics:\n${input.metrics}`;

  const anthropic = getAnthropicClient();
  const response = await anthropic.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  const parsed = JSON.parse(cleaned);
  return GenerateDashboardInsightsOutputSchema.parse(parsed);
}
