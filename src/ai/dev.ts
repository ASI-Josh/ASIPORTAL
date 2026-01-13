import { config } from 'dotenv';
config();

import '@/ai/flows/generate-job-descriptions.ts';
import '@/ai/flows/summarize-lead-notes.ts';
import '@/ai/flows/generate-inspection-summary.ts';
