import { z } from "zod";

type WorkflowResponse = {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

type RunWorkflowParams<T> = {
  workflowId: string;
  input: string;
  schema: z.ZodType<T>;
  timeoutMs?: number;
  maxRetries?: number;
};

const OPENAI_API_URL = "https://api.openai.com/v1/responses";

const extractOutputText = (payload: WorkflowResponse) => {
  if (payload.output_text && typeof payload.output_text === "string") {
    return payload.output_text;
  }
  if (!payload.output || !Array.isArray(payload.output)) return "";
  const chunks: string[] = [];
  payload.output.forEach((item) => {
    item.content?.forEach((content) => {
      if (content.type === "output_text" && content.text) {
        chunks.push(content.text);
      }
    });
  });
  return chunks.join("\n");
};

const parseJsonOutput = (text: string) => {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) {
      const sliced = trimmed.slice(first, last + 1);
      return JSON.parse(sliced);
    }
    throw error;
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runWorkflowJson<T>({
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

  let attempt = 0;
  let lastError: unknown;

  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workflow_id: workflowId,
          input,
          model,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(`Agent request failed: ${response.status} ${errorText}`);
        (error as Error & { retryable?: boolean }).retryable =
          response.status >= 500 || response.status === 429;
        throw error;
      }

      const payload = (await response.json()) as WorkflowResponse;
      const outputText = extractOutputText(payload);
      if (!outputText) {
        throw new Error("Agent returned no output.");
      }
      const parsedJson = parseJsonOutput(outputText);
      const parsed = schema.parse(parsedJson);
      return { parsed, raw: outputText };
    } catch (error) {
      lastError = error;
      const retryable =
        (error as Error & { retryable?: boolean }).retryable ??
        (error instanceof Error &&
          (error.name === "AbortError" || error.name === "TypeError"));
      if (attempt >= maxRetries || retryable === false) {
        throw error;
      }
      await sleep(500 * Math.pow(2, attempt));
    } finally {
      clearTimeout(timeout);
    }
    attempt += 1;
  }

  throw lastError instanceof Error ? lastError : new Error("Agent request failed.");
}
