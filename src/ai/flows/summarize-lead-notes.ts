'use server';

/**
 * @fileOverview A flow to summarize lengthy lead notes for sales agents.
 *
 * - summarizeLeadNotes - A function that summarizes lead notes.
 * - SummarizeLeadNotesInput - The input type for the summarizeLeadNotes function.
 * - SummarizeLeadNotesOutput - The return type for the summarizeLeadNotes function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const SummarizeLeadNotesInputSchema = z.object({
  notes: z
    .string()
    .describe('The lengthy notes from customer interactions to summarize.'),
});
export type SummarizeLeadNotesInput = z.infer<typeof SummarizeLeadNotesInputSchema>;

const SummarizeLeadNotesOutputSchema = z.object({
  summary: z.string().describe('A concise summary of the lead notes.'),
});
export type SummarizeLeadNotesOutput = z.infer<typeof SummarizeLeadNotesOutputSchema>;

export async function summarizeLeadNotes(input: SummarizeLeadNotesInput): Promise<SummarizeLeadNotesOutput> {
  return summarizeLeadNotesFlow(input);
}

const prompt = ai.definePrompt({
  name: 'summarizeLeadNotesPrompt',
  input: {schema: SummarizeLeadNotesInputSchema},
  output: {schema: SummarizeLeadNotesOutputSchema},
  prompt: `You are an AI assistant helping sales agents quickly understand customer interactions.
  Summarize the following lead notes, extracting the key points and important details:

  Lead Notes:
  {{notes}}

  Summary: `,
});

const summarizeLeadNotesFlow = ai.defineFlow(
  {
    name: 'summarizeLeadNotesFlow',
    inputSchema: SummarizeLeadNotesInputSchema,
    outputSchema: SummarizeLeadNotesOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
