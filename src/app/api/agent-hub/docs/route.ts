import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    await requireAdminUser(req);

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
    const { userId, user } = await requireAdminUser(req);

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

    let extractionError: string | null = null;
    if (payload.storagePath) {
      try {
        const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
        const bucket = bucketName ? admin.storage().bucket(bucketName) : admin.storage().bucket();
        const file = bucket.file(payload.storagePath);
        const [buffer] = await file.download();
        const { extractTextFromBuffer, summarizeTextWithAi } = await import("@/lib/assistant/doc-extract");
        extractedText = await extractTextFromBuffer(
          buffer,
          payload.contentType || null,
          payload.fileName
        );
        if (!summary) {
          summary = await summarizeTextWithAi(extractedText);
        }
      } catch (error) {
        extractionError = error instanceof Error ? error.message : "Unable to extract document text.";
      }
    }

    if (!extractedText && payload.downloadUrl && !summary) {
      try {
        const response = await fetch(payload.downloadUrl);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const { extractTextFromBuffer, summarizeTextWithAi } = await import("@/lib/assistant/doc-extract");
          extractedText = await extractTextFromBuffer(
            buffer,
            payload.contentType || null,
            payload.fileName
          );
          summary = await summarizeTextWithAi(extractedText);
        }
      } catch (error) {
        extractionError = extractionError || (error instanceof Error ? error.message : "Unable to fetch document.");
      }
    }

    if (!extractedText && payload.sourceUrl && !summary) {
      try {
        const response = await fetch(payload.sourceUrl);
        if (response.ok) {
          const html = await response.text();
          const text = html
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          extractedText = text.slice(0, 20000);
          const { summarizeTextWithAi } = await import("@/lib/assistant/doc-extract");
          summary = await summarizeTextWithAi(extractedText);
        }
      } catch (error) {
        extractionError =
          extractionError || (error instanceof Error ? error.message : "Unable to fetch source URL.");
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
        extractionError,
        createdAt: now,
        createdById: userId,
        createdByName: user.name || user.email || "Admin",
      });

    return NextResponse.json({ id: docRef.id, warning: extractionError });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to add document.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
