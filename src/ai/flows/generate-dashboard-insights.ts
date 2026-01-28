'use server';

/**
 * @fileOverview Dashboard insights generation flow.
 *
 * - generateDashboardInsights - Generates dashboard insights, risks, and opportunities.
 * - GenerateDashboardInsightsInput - The input type.
 * - GenerateDashboardInsightsOutput - The output type.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const GenerateDashboardInsightsInputSchema = z.object({
  metrics: z
    .string()
    .describe('JSON metrics payload including revenue, glass saved, operations, and client activity.'),
  audience: z
    .enum(['admin', 'client'])
    .default('admin')
    .describe('Target audience for the insights.'),
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
  return generateDashboardInsightsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'generateDashboardInsightsPrompt',
  input: { schema: GenerateDashboardInsightsInputSchema },
  output: { schema: GenerateDashboardInsightsOutputSchema },
  prompt: `You are an operations and commercial analyst for an Australian repair business.
Summarise the dashboard metrics clearly and identify risks and opportunities.
Use Australian English and keep everything concise.

If audience is "client", write in client-friendly language:
- Focus on service progress, approvals, and scheduling.
- Avoid internal revenue, margin, compliance, or operational performance language.
- Never mention internal KPIs or admin-only metrics.

Return:
- summary: 2-3 sentences maximum
- risks: 2-4 bullet points
- opportunities: 2-4 bullet points
- alerts: 2-4 bullet points

Audience:
{{audience}}

Metrics:
{{metrics}}
`,
});

const generateDashboardInsightsFlow = ai.defineFlow(
  {
    name: 'generateDashboardInsightsFlow',
    inputSchema: GenerateDashboardInsightsInputSchema,
    outputSchema: GenerateDashboardInsightsOutputSchema,
  },
  async (input) => {
    const { output } = await prompt(input);
    return output!;
  }
);
