import { z } from "zod";
import { Agent, AgentInputItem, Runner } from "@openai/agents";
import {
  DOC_MANAGER_INSTRUCTIONS,
  IMS_AUDITOR_INSTRUCTIONS,
  INTERNAL_ADMIN_INSTRUCTIONS,
  INTERNAL_TECH_INSTRUCTIONS,
  FALLBACK_AGENT_INSTRUCTIONS,
} from "@/lib/assistant/agent-instructions";

type RunWorkflowParams<T extends z.ZodObject<any>> = {
  workflowId: string;
  input: string;
  schema: T;
  timeoutMs?: number;
  maxRetries?: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runWorkflowJson<T extends z.ZodObject<any>>({
  workflowId,
  input,
  schema,
  timeoutMs = 30000,
  maxRetries = 2,
}: RunWorkflowParams<T>) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_WORKFLOW_MODEL || "gpt-5.2";

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY.");
  }

  const resolveInstructions = () => {
    if (workflowId === process.env.OPENAI_DOC_MANAGER_WORKFLOW_ID) {
      return { name: "ASI IMS Doc Manager", instructions: DOC_MANAGER_INSTRUCTIONS };
    }
    if (workflowId === process.env.OPENAI_IMS_AUDITOR_WORKFLOW_ID) {
      return { name: "ASI Lead IMS Auditor", instructions: IMS_AUDITOR_INSTRUCTIONS };
    }
    if (workflowId === process.env.OPENAI_INTERNAL_ADMIN_WORKFLOW_ID) {
      return { name: "ASI Internal Knowledge Assistant (Admin)", instructions: INTERNAL_ADMIN_INSTRUCTIONS };
    }
    if (workflowId === process.env.OPENAI_INTERNAL_TECH_WORKFLOW_ID) {
      return { name: "ASI Internal Knowledge Assistant (Tech)", instructions: INTERNAL_TECH_INSTRUCTIONS };
    }
    return { name: "ASI Agent", instructions: FALLBACK_AGENT_INSTRUCTIONS };
  };

  const { name, instructions } = resolveInstructions();
  const inputItems: AgentInputItem[] = [
    { role: "user", content: [{ type: "input_text", text: input }] },
  ];

  let attempt = 0;
  let lastError: unknown;

  while (attempt <= maxRetries) {
    try {
      const agent = new Agent({
        name,
        instructions,
        model,
        outputType: schema,
      });
      const runner = new Runner({
        traceMetadata: { __trace_source__: "agent-builder" },
      });

      const result = await Promise.race([
        runner.run(agent, inputItems),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Agent request timed out.")), timeoutMs)
        ),
      ]);

      if (!result.finalOutput) {
        throw new Error("Agent returned no output.");
      }
      return {
        parsed: result.finalOutput as z.infer<T>,
        raw: JSON.stringify(result.finalOutput),
      };
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof Error &&
        (error.message.includes("timed out") ||
          error.message.includes("rate") ||
          error.message.includes("temporarily"));
      if (attempt >= maxRetries || retryable === false) {
        throw error;
      }
      await sleep(500 * Math.pow(2, attempt));
    }
    attempt += 1;
  }

  throw lastError instanceof Error ? lastError : new Error("Agent request failed.");
}
