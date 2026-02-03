import { z } from "zod";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import { runWorkflowJson } from "@/lib/openai-workflow";

const SUMMARY_SCHEMA = z
  .object({
    summary: z.string(),
    keyPoints: z.array(z.string()),
  })
  .strict();

export const extractTextFromBuffer = async (
  buffer: Buffer,
  contentType: string | null,
  fileName: string
) => {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (contentType?.includes("pdf") || extension === "pdf") {
    const parser = new PDFParse({ data: buffer });
    const parsed = await parser.getText();
    await parser.destroy();
    return parsed.text || "";
  }
  if (
    contentType?.includes("word") ||
    extension === "docx" ||
    extension === "doc"
  ) {
    const parsed = await mammoth.extractRawText({ buffer });
    return parsed.value || "";
  }
  if (contentType?.startsWith("text/") || extension === "txt" || extension === "md") {
    return buffer.toString("utf8");
  }
  return "";
};

export const summarizeTextWithAi = async (text: string) => {
  if (!text.trim()) return null;
  if (!process.env.OPENAI_API_KEY) return null;
  const prompt = [
    "Summarise the following content for an internal knowledge base.",
    "Return JSON with keys: summary, keyPoints.",
    "summary should be 3-5 sentences. keyPoints should be 4-6 bullets.",
    "",
    "Content:",
    text.slice(0, 12000),
  ].join("\n");

  try {
    const result = await runWorkflowJson({
      workflowId: process.env.OPENAI_INTERNAL_ADMIN_WORKFLOW_ID || "knowledge",
      input: prompt,
      schema: SUMMARY_SCHEMA,
      timeoutMs: 45000,
      maxRetries: 1,
      instructionsOverride: [
        "You are a summarisation assistant.",
        "Return ONLY JSON with keys: summary, keyPoints.",
      ].join("\n"),
    });
    return result.parsed;
  } catch (error) {
    return null;
  }
};
