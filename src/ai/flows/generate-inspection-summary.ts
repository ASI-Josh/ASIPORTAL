'use server';

/**
 * @fileOverview Inspection report summary generation flow.
 *
 * - generateInspectionSummary - Generates a client-facing inspection report summary.
 * - GenerateInspectionSummaryInput - The input type for generateInspectionSummary.
 * - GenerateInspectionSummaryOutput - The return type for generateInspectionSummary.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const GenerateInspectionSummaryInputSchema = z.object({
  inspectionData: z
    .string()
    .describe('Structured inspection details including organisation, contact, vehicles, damages, and totals.'),
});
export type GenerateInspectionSummaryInput = z.infer<typeof GenerateInspectionSummaryInputSchema>;

const GenerateInspectionSummaryOutputSchema = z.object({
  summary: z
    .string()
    .describe('A concise inspection report summary suitable for client communication.'),
});
export type GenerateInspectionSummaryOutput = z.infer<typeof GenerateInspectionSummaryOutputSchema>;

export async function generateInspectionSummary(
  input: GenerateInspectionSummaryInput
): Promise<GenerateInspectionSummaryOutput> {
  return generateInspectionSummaryFlow(input);
}

const prompt = ai.definePrompt({
  name: 'generateInspectionSummaryPrompt',
  input: { schema: GenerateInspectionSummaryInputSchema },
  output: { schema: GenerateInspectionSummaryOutputSchema },
  prompt: `You are an operations coordinator at an Australian vehicle repair business.
Create a clear, client-facing inspection report summary in Australian English.
Use short paragraphs and bullet points where helpful. Include:
- Inspection overview (date/time, site, organisation, contact)
- Vehicle list with key damage sites and severity
- Estimated costs (labour, materials, total)
- Any notes or next steps mentioned

Inspection data:
{{inspectionData}}

Summary:`,
});

const generateInspectionSummaryFlow = ai.defineFlow(
  {
    name: 'generateInspectionSummaryFlow',
    inputSchema: GenerateInspectionSummaryInputSchema,
    outputSchema: GenerateInspectionSummaryOutputSchema,
  },
  async (input) => {
    const { output } = await prompt(input);
    return output!;
  }
);
