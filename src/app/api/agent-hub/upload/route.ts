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
    const { userId, user } = await requireAdminUser(req);
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "File is required." }, { status: 400 });
    }

    const fileName = file.name || "document";
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const docId = crypto.randomUUID();
    const storagePath = `agent-hub/${docId}/${safeName}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const contentType = file.type || "application/octet-stream";

    const bucketName =
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || admin.storage().bucket().name;
    const bucket = bucketName ? admin.storage().bucket(bucketName) : admin.storage().bucket();
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
