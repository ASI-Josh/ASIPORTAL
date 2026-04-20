import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient, DEFAULT_MODEL } from "@/lib/anthropic";
import {
  DOC_MANAGER_INSTRUCTIONS,
  IMS_AUDITOR_INSTRUCTIONS,
  INTERNAL_ADMIN_INSTRUCTIONS,
  INTERNAL_TECH_INSTRUCTIONS,
  FALLBACK_AGENT_INSTRUCTIONS,
} from "@/lib/assistant/agent-instructions";

// Agent type identifiers — callers pass these as workflowId
export const AGENT_ADMIN = "admin";
export const AGENT_TECH = "tech";
export const AGENT_DOC_MANAGER = "doc_manager";
export const AGENT_AUDITOR = "auditor";

type RunWorkflowParams<T extends z.ZodTypeAny> = {
  workflowId: string;
  input: string;
  schema: T;
  timeoutMs?: number;
  maxRetries?: number;
  instructionsOverride?: string;
  agentNameOverride?: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function resolveInstructions(agentType: string) {
  switch (agentType) {
    case AGENT_DOC_MANAGER:
      return { name: "ASI IMS Doc Manager", instructions: DOC_MANAGER_INSTRUCTIONS };
    case AGENT_AUDITOR:
      return { name: "ASI Lead IMS Auditor", instructions: IMS_AUDITOR_INSTRUCTIONS };
    case AGENT_ADMIN:
      return { name: "ASI Internal Knowledge Assistant (Admin)", instructions: INTERNAL_ADMIN_INSTRUCTIONS };
    case AGENT_TECH:
      return { name: "ASI Internal Knowledge Assistant (Tech)", instructions: INTERNAL_TECH_INSTRUCTIONS };
    default:
      return { name: "ASI Agent", instructions: FALLBACK_AGENT_INSTRUCTIONS };
  }
}

function extractJson(raw: string): string {
  // Strip markdown fences if present
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  // Find outermost JSON object
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return stripped.slice(start, end + 1);
  }
  return stripped;
}

export async function runWorkflowJson<T extends z.ZodTypeAny>({
  workflowId,
  input,
  schema,
  timeoutMs = 30000,
  maxRetries = 2,
  instructionsOverride,
}: RunWorkflowParams<T>): Promise<{ parsed: z.infer<T>; raw: string }> {
  const anthropic = getAnthropicClient();
  const resolved = resolveInstructions(workflowId);
  const systemPrompt = [
    instructionsOverride || resolved.instructions,
    "",
    "Respond ONLY with a valid JSON object. Do not include markdown fences, explanations, or any text outside the JSON.",
  ].join("\n");

  let attempt = 0;
  let lastError: unknown;

  while (attempt <= maxRetries) {
    try {
      const response = await Promise.race([
        anthropic.messages.create({
          model: DEFAULT_MODEL,
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: "user", content: input }],
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Agent request timed out.")), timeoutMs)
        ),
      ]);

      const raw = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");

      const jsonStr = extractJson(raw);
      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        // Last-resort salvage: wrap the raw text as a minimal valid response
        // so the UI still shows the model's answer instead of a hard 500.
        parsed = {
          answer: raw.trim() || "I couldn't format a structured response, but I'm ready for your next question.",
        };
      }

      const schemaResult = schema.safeParse(parsed);
      if (schemaResult.success) {
        return { parsed: schemaResult.data as z.infer<T>, raw: jsonStr };
      }

      // Schema validation failed — attempt salvage by keeping the answer
      // and filling the missing fields with safe defaults.
      const salvage = schema.safeParse({
        ...(parsed && typeof parsed === "object" ? parsed : {}),
        answer:
          (parsed && typeof parsed === "object" && "answer" in parsed && typeof (parsed as { answer?: unknown }).answer === "string"
            ? (parsed as { answer: string }).answer
            : raw.trim()) ||
          "I couldn't format a structured response, but I'm ready for your next question.",
      });
      if (salvage.success) {
        return { parsed: salvage.data as z.infer<T>, raw: jsonStr };
      }

      throw new Error(`Agent response failed schema validation: ${schemaResult.error.message.slice(0, 200)}`);
    } catch (error) {
      lastError = error;
      const msg = error instanceof Error ? error.message : "";
      const retryable =
        msg.includes("timed out") ||
        msg.includes("rate") ||
        msg.includes("overloaded") ||
        msg.includes("temporarily");
      if (attempt >= maxRetries || !retryable) throw error;
      await sleep(500 * Math.pow(2, attempt));
    }
    attempt += 1;
  }

  throw lastError instanceof Error ? lastError : new Error("Agent request failed.");
}
