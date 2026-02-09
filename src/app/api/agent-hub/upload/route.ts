import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { admin } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";

export const runtime = "nodejs";

const buildDownloadUrl = (bucketName: string, filePath: string, token: string) =>
  `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(
    filePath
  )}?alt=media&token=${token}`;

export async function POST(req: NextRequest) {
  try {
    let userId = "";
    let user: { role?: string; name?: string; email?: string } | null = null;
    try {
      const adminUser = await requireAdminUser(req);
      userId = adminUser.userId;
      user = adminUser.user;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Not authorised.";
      const status = message.toLowerCase().includes("missing authorization") ? 401 : 403;
      return NextResponse.json({ error: message }, { status });
    }

    const formData = await req.formData();
    const fileField = formData.get("file");
    const blob =
      fileField && typeof fileField === "object" && "arrayBuffer" in fileField
        ? (fileField as Blob)
        : null;
    if (!blob) {
      return NextResponse.json({ error: "File is required." }, { status: 400 });
    }

    // Netlify/Serverless safety limit: avoid huge bodies causing opaque 500s.
    const MAX_BYTES = 18 * 1024 * 1024; // 18MB
    if (typeof (blob as any).size === "number" && (blob as any).size > MAX_BYTES) {
      return NextResponse.json(
        { error: "File too large. Please upload a smaller file (max 18MB)." },
        { status: 413 }
      );
    }

    const fileName =
      fileField && typeof fileField === "object" && "name" in fileField && typeof (fileField as any).name === "string"
        ? ((fileField as any).name as string)
        : "document";
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const docId = crypto.randomUUID();
    const storagePath = `agent-hub/${docId}/${safeName}`;
    const buffer = Buffer.from(await blob.arrayBuffer());
    const contentType =
      fileField && typeof fileField === "object" && "type" in fileField && typeof (fileField as any).type === "string"
        ? ((fileField as any).type as string) || "application/octet-stream"
        : "application/octet-stream";

    const bucketName =
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET;
    if (!bucketName) {
      return NextResponse.json(
        {
          error:
            "Firebase Storage bucket not configured. Set NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET (or FIREBASE_STORAGE_BUCKET) in your runtime env vars.",
        },
        { status: 500 }
      );
    }
    const bucket = admin.storage().bucket(bucketName);
    const token = crypto.randomUUID();

    await bucket.file(storagePath).save(buffer, {
      contentType,
      metadata: {
        metadata: {
          firebaseStorageDownloadTokens: token,
        },
      },
    });

    let extractedText = "";
    let summary: { summary: string; keyPoints: string[] } | null = null;
    let extractionError: string | null = null;
    try {
      const { extractTextFromBuffer, summarizeTextWithAi } = await import(
        "@/lib/assistant/doc-extract"
      );
        extractedText = await extractTextFromBuffer(buffer, contentType, fileName);
        summary = await summarizeTextWithAi(extractedText);
      } catch (error) {
        extractionError =
          error instanceof Error ? error.message : "Unable to extract document text.";
      }

    const downloadUrl = buildDownloadUrl(bucket.name, storagePath, token);
    const now = admin.firestore.FieldValue.serverTimestamp();
    const docRef = await admin
      .firestore()
      .collection(COLLECTIONS.AGENT_HUB_DOCS)
      .add({
        title: fileName,
        fileName,
        contentType,
        size: buffer.length,
        storagePath,
        downloadUrl,
        sourceUrl: null,
        tags: [],
        summary: summary?.summary || "",
        keyPoints: summary?.keyPoints || [],
        extractedText: extractedText ? extractedText.slice(0, 12000) : "",
        extractionError,
        createdAt: now,
        createdById: userId,
        createdByName: user?.name || user?.email || "Admin",
      });

    return NextResponse.json({ id: docRef.id, warning: extractionError });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to upload document.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
