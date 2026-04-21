import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";

export const runtime = "nodejs";

/**
 * GET /api/agent-hub/docs/:id — single-doc lookup used by chat UIs
 * (like ArcherChat) to pull the post-upload summary + extracted text
 * so the attached file can be surfaced to the agent inline.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminUser(req);
    const { id } = await context.params;
    if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

    const snap = await admin
      .firestore()
      .collection(COLLECTIONS.AGENT_HUB_DOCS)
      .doc(id)
      .get();
    if (!snap.exists) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const data = snap.data()!;

    return NextResponse.json({
      id: snap.id,
      title: data.title || data.fileName,
      fileName: data.fileName,
      contentType: data.contentType,
      size: data.size,
      summary: data.summary || "",
      keyPoints: data.keyPoints || [],
      extractedText: data.extractedText || "",
      downloadUrl: data.downloadUrl || null,
      sourceUrl: data.sourceUrl || null,
      createdAt: data.createdAt?.toDate?.().toISOString?.() || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load document.";
    const status = message.toLowerCase().includes("missing authorization") ? 401 : 403;
    return NextResponse.json({ error: message }, { status });
  }
}
