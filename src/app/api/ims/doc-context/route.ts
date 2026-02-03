import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";

export const runtime = "nodejs";

type ImsRevisionData = {
  revisionNumber?: number;
  draftOutput?: {
    metadata?: { title?: string };
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
    const payload = (await req.json()) as { docNumber?: string; revisionId?: string | null };
    const docNumber = payload.docNumber?.trim();
    if (!docNumber) {
      return NextResponse.json({ error: "docNumber is required." }, { status: 400 });
    }

    const docRef = admin.firestore().collection(COLLECTIONS.IMS_DOCUMENTS).doc(docNumber);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return NextResponse.json({ error: "IMS document not found." }, { status: 404 });
    }
    const docData = docSnap.data() as { title?: string; docType?: string } | undefined;

    let revisionSnap: admin.firestore.DocumentSnapshot | null = null;
    if (payload.revisionId) {
      revisionSnap = await docRef.collection("revisions").doc(payload.revisionId).get();
    }
    if (!revisionSnap || !revisionSnap.exists) {
      const latestSnap = await docRef
        .collection("revisions")
        .orderBy("revisionNumber", "desc")
        .limit(1)
        .get();
      revisionSnap = latestSnap.docs[0] || null;
    }

    const revisionData = revisionSnap?.data() as ImsRevisionData | undefined;
    const revisionNumber = revisionData?.revisionNumber ?? null;
    const issueDate = revisionData?.issueDate?.toDate?.().toISOString?.() || null;
    let extractedText = buildTextFromDraft(revisionData?.draftOutput);
    let summary = buildSummaryFromDraft(revisionData?.draftOutput);
    let extractionError: string | null = null;

    if (!extractedText && revisionData?.file?.path) {
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
          revisionData.file.name || docData?.title || docNumber
        );
        const aiSummary = await summarizeTextWithAi(extractedText);
        summary = aiSummary?.summary || summary;
      } catch (error) {
        extractionError =
          error instanceof Error ? error.message : "Unable to extract revision file.";
      }
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const title = `IMS ${docNumber} ${docData?.title || ""}`.trim();
    const docRefHub = await admin.firestore().collection(COLLECTIONS.AGENT_HUB_DOCS).add({
      title,
      fileName: revisionData?.file?.name || `${docNumber}.json`,
      contentType: "text/plain",
      size: extractedText ? extractedText.length : null,
      storagePath: null,
      downloadUrl: null,
      sourceUrl: `/dashboard/ims/doc-manager/${docNumber}`,
      tags: ["ims", docData?.docType || "doc"],
      summary: summary || "",
      keyPoints: [],
      extractedText: extractedText ? extractedText.slice(0, 12000) : "",
      extractionError,
      createdAt: now,
      createdById: userId,
      createdByName: user?.name || user?.email || "Admin",
      imsDocNumber: docNumber,
      imsRevisionNumber: revisionNumber,
      imsIssueDate: issueDate,
    });

    return NextResponse.json({ id: docRefHub.id, warning: extractionError });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to share IMS document.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
