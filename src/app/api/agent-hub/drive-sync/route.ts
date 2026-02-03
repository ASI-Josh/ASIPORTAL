import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";
import {
  downloadDriveFile,
  exportDriveFile,
  listDriveFiles,
} from "@/lib/integrations/google-drive";

export const runtime = "nodejs";

const GOOGLE_DOC = "application/vnd.google-apps.document";
const GOOGLE_SHEET = "application/vnd.google-apps.spreadsheet";
const GOOGLE_SLIDE = "application/vnd.google-apps.presentation";

const resolveDriveBuffer = async (file: {
  id?: string | null;
  mimeType?: string | null;
  name?: string | null;
}) => {
  if (!file.id) return null;
  if (file.mimeType === GOOGLE_DOC) {
    const buffer = await exportDriveFile(file.id, "text/plain");
    return { buffer, contentType: "text/plain", fileName: `${file.name || file.id}.txt` };
  }
  if (file.mimeType === GOOGLE_SHEET) {
    const buffer = await exportDriveFile(file.id, "text/csv");
    return { buffer, contentType: "text/csv", fileName: `${file.name || file.id}.csv` };
  }
  if (file.mimeType === GOOGLE_SLIDE) {
    const buffer = await exportDriveFile(file.id, "text/plain");
    return { buffer, contentType: "text/plain", fileName: `${file.name || file.id}.txt` };
  }
  const buffer = await downloadDriveFile(file.id);
  return { buffer, contentType: file.mimeType || "application/octet-stream", fileName: file.name || file.id };
};

export async function POST(req: NextRequest) {
  try {
    const { userId, user } = await requireAdminUser(req);

    const payload = (await req.json()) as { folderId?: string; maxFiles?: number };
    const folderId = payload.folderId?.trim();
    if (!folderId) {
      return NextResponse.json({ error: "Folder ID is required." }, { status: 400 });
    }

    const maxFiles = payload.maxFiles && payload.maxFiles > 0 ? payload.maxFiles : 25;
    const files = await listDriveFiles(folderId, maxFiles);

    const now = admin.firestore.FieldValue.serverTimestamp();
    const results = {
      synced: 0,
      skipped: 0,
      errors: [] as string[],
    };

    for (const file of files) {
      if (!file.id) continue;
      const existingSnap = await admin
        .firestore()
        .collection(COLLECTIONS.AGENT_HUB_DOCS)
        .where("driveFileId", "==", file.id)
        .limit(1)
        .get();

      const existing = existingSnap.docs[0];
      if (existing?.data()?.driveModifiedTime === file.modifiedTime) {
        results.skipped += 1;
        continue;
      }

      try {
        const resolved = await resolveDriveBuffer(file);
        if (!resolved) {
          results.errors.push(`Unable to read file ${file.name || file.id}`);
          continue;
        }
        const { extractTextFromBuffer, summarizeTextWithAi } = await import("@/lib/assistant/doc-extract");
        const extractedText = await extractTextFromBuffer(
          resolved.buffer,
          resolved.contentType,
          resolved.fileName
        );
        const summary = await summarizeTextWithAi(extractedText);

        const docPayload = {
          title: file.name || resolved.fileName,
          fileName: resolved.fileName,
          contentType: resolved.contentType,
          size: file.size ? Number(file.size) : null,
          sourceUrl: file.webViewLink || file.webContentLink || null,
          tags: ["google-drive"],
          summary: summary?.summary || "",
          keyPoints: summary?.keyPoints || [],
          extractedText: extractedText ? extractedText.slice(0, 12000) : "",
          driveFileId: file.id,
          driveModifiedTime: file.modifiedTime || null,
          createdAt: existing ? existing.data().createdAt : now,
          updatedAt: now,
          createdById: existing ? existing.data().createdById : userId,
          createdByName: existing ? existing.data().createdByName : user?.name || user?.email || "Admin",
        };

        if (existing) {
          await existing.ref.set(docPayload, { merge: true });
        } else {
          await admin.firestore().collection(COLLECTIONS.AGENT_HUB_DOCS).add(docPayload);
        }

        results.synced += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Drive sync failed";
        results.errors.push(`${file.name || file.id}: ${message}`);
      }
    }

    return NextResponse.json({ status: "ok", results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sync Drive.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
