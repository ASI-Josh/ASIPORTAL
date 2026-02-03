import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";

export const runtime = "nodejs";

type ImsRevisionData = {
  revisionNumber?: number;
  draftOutput?: {
    sections?: Array<{ title: string; content: string }>;
    changeSummary?: string[];
  };
  file?: { path?: string; name?: string; contentType?: string };
  issueDate?: admin.firestore.Timestamp;
};

const buildTextFromDraft = (draft?: ImsRevisionData["draftOutput"]) => {
  if (!draft?.sections?.length) return "";
  return draft.sections
    .map((section) => `## ${section.title}\n${section.content}`)
    .join("\n\n");
};

const buildSummaryFromDraft = (draft?: ImsRevisionData["draftOutput"]) => {
  if (draft?.changeSummary?.length) return draft.changeSummary.join(" ");
  if (draft?.sections?.length) return draft.sections[0]?.content?.slice(0, 240) || "";
  return "";
};

export async function POST(req: NextRequest) {
  try {
    const { userId, user } = await requireAdminUser(req);
    const payload = (await req.json().catch(() => ({}))) as { maxDocs?: number };
    const maxDocs = payload.maxDocs && payload.maxDocs > 0 ? payload.maxDocs : 25;

    const docsSnap = await admin
      .firestore()
      .collection(COLLECTIONS.IMS_DOCUMENTS)
      .orderBy("docNumber", "asc")
      .limit(maxDocs)
      .get();

    const results = { synced: 0, skipped: 0, errors: [] as string[] };

    for (const docSnap of docsSnap.docs) {
      const docData = docSnap.data() as { docNumber?: string; title?: string; docType?: string };
      const docNumber = docData.docNumber || docSnap.id;
      try {
        const docRef = admin.firestore().collection(COLLECTIONS.IMS_DOCUMENTS).doc(docNumber);
        let revisionSnap: admin.firestore.DocumentSnapshot | null = null;
        if (docData.currentRevisionId) {
          revisionSnap = await docRef.collection("revisions").doc(docData.currentRevisionId).get();
        }
        if (!revisionSnap || !revisionSnap.exists) {
          const latestSnap = await docRef
            .collection("revisions")
            .orderBy("revisionNumber", "desc")
            .limit(1)
            .get();
          revisionSnap = latestSnap.docs[0] || null;
        }

        if (!revisionSnap || !revisionSnap.exists) {
          results.skipped += 1;
          continue;
        }

        const revisionData = revisionSnap.data() as ImsRevisionData;
        const revisionNumber = revisionData.revisionNumber ?? null;
        const existingSnap = await admin
          .firestore()
          .collection(COLLECTIONS.AGENT_HUB_DOCS)
          .where("imsDocNumber", "==", docNumber)
          .where("imsRevisionNumber", "==", revisionNumber)
          .limit(1)
          .get();
        if (!existingSnap.empty) {
          results.skipped += 1;
          continue;
        }

        let extractedText = buildTextFromDraft(revisionData.draftOutput);
        let summary = buildSummaryFromDraft(revisionData.draftOutput);
        let extractionError: string | null = null;

        if (!extractedText && revisionData.file?.path) {
          try {
            const bucketName =
              process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || admin.storage().bucket().name;
            const bucket = bucketName ? admin.storage().bucket(bucketName) : admin.storage().bucket();
            const [buffer] = await bucket.file(revisionData.file.path).download();
            const { extractTextFromBuffer, summarizeTextWithAi } = await import(
              "@/lib/assistant/doc-extract"
            );
            extractedText = await extractTextFromBuffer(
              buffer,
              revisionData.file.contentType || null,
              revisionData.file.name || docData.title || docNumber
            );
            const aiSummary = await summarizeTextWithAi(extractedText);
            summary = aiSummary?.summary || summary;
          } catch (error) {
            extractionError =
              error instanceof Error ? error.message : "Unable to extract revision file.";
          }
        }

        const now = admin.firestore.FieldValue.serverTimestamp();
        const title = `IMS ${docNumber} ${docData.title || ""}`.trim();
        await admin.firestore().collection(COLLECTIONS.AGENT_HUB_DOCS).add({
          title,
          fileName: revisionData.file?.name || `${docNumber}.json`,
          contentType: "text/plain",
          size: extractedText ? extractedText.length : null,
          storagePath: null,
          downloadUrl: null,
          sourceUrl: `/dashboard/ims/doc-manager/${docNumber}`,
          tags: ["ims", docData.docType || "doc"],
          summary: summary || "",
          keyPoints: [],
          extractedText: extractedText ? extractedText.slice(0, 12000) : "",
          extractionError,
          createdAt: now,
          createdById: userId,
          createdByName: user?.name || user?.email || "Admin",
          imsDocNumber: docNumber,
          imsRevisionNumber: revisionNumber,
          imsIssueDate: revisionData.issueDate?.toDate?.().toISOString?.() || null,
        });

        results.synced += 1;
      } catch (error) {
        results.errors.push(`${docNumber}: ${error instanceof Error ? error.message : "Failed"}`);
      }
    }

    return NextResponse.json({ status: "ok", results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to share IMS docs.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
