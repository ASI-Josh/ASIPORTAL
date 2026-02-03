"use server";

import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";
import { runWorkflowJson } from "@/lib/openai-workflow";
import { z } from "zod";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

const SUMMARY_SCHEMA = z
  .object({
    summary: z.string(),
    keyPoints: z.array(z.string()),
  })
  .strict();

const extractText = async (buffer: Buffer, contentType: string | null, fileName: string) => {
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

const summarizeText = async (text: string) => {
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

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const userSnap = await admin.firestore().collection(COLLECTIONS.USERS).doc(userId).get();
    const user = userSnap.data() as { role?: string } | undefined;
    if (!user || user.role !== "admin") {
      return NextResponse.json({ error: "Not authorised." }, { status: 403 });
    }

    const docsSnap = await admin
      .firestore()
      .collection(COLLECTIONS.AGENT_HUB_DOCS)
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    const docs = docsSnap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        title: data.title || data.fileName,
        fileName: data.fileName,
        contentType: data.contentType,
        size: data.size,
        summary: data.summary,
        sourceUrl: data.sourceUrl || null,
        downloadUrl: data.downloadUrl || null,
        createdAt: data.createdAt?.toDate?.().toISOString?.() || null,
      };
    });

    return NextResponse.json({ docs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load documents.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const userSnap = await admin.firestore().collection(COLLECTIONS.USERS).doc(userId).get();
    const user = userSnap.data() as { role?: string; name?: string; email?: string } | undefined;
    if (!user || user.role !== "admin") {
      return NextResponse.json({ error: "Not authorised." }, { status: 403 });
    }

    const payload = (await req.json()) as {
      fileName: string;
      contentType?: string;
      size?: number;
      storagePath?: string;
      downloadUrl?: string;
      title?: string;
      sourceUrl?: string;
      tags?: string[];
      summary?: string;
    };

    if (!payload.fileName) {
      return NextResponse.json({ error: "Missing file metadata." }, { status: 400 });
    }

    let extractedText = "";
    let summary = payload.summary ? { summary: payload.summary, keyPoints: [] as string[] } : null;

    if (payload.storagePath) {
      const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
      const bucket = bucketName ? admin.storage().bucket(bucketName) : admin.storage().bucket();
      const file = bucket.file(payload.storagePath);
      const [buffer] = await file.download();
      extractedText = await extractText(buffer, payload.contentType || null, payload.fileName);
      if (!summary) {
        summary = await summarizeText(extractedText);
      }
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const docRef = await admin
      .firestore()
      .collection(COLLECTIONS.AGENT_HUB_DOCS)
      .add({
        title: payload.title || payload.fileName,
        fileName: payload.fileName,
        contentType: payload.contentType || null,
        size: payload.size || null,
        storagePath: payload.storagePath || null,
        downloadUrl: payload.downloadUrl || null,
        sourceUrl: payload.sourceUrl || null,
        tags: Array.isArray(payload.tags) ? payload.tags : [],
        summary: summary?.summary || "",
        keyPoints: summary?.keyPoints || [],
        extractedText: extractedText ? extractedText.slice(0, 12000) : "",
        createdAt: now,
        createdById: userId,
        createdByName: user.name || user.email || "Admin",
      });

    return NextResponse.json({ id: docRef.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to add document.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
