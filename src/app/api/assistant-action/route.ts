import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";
import { requireUserId } from "@/lib/server/firebaseAuth";
import {
  ProposedActionSchema,
  type ProposedAction,
} from "@/lib/assistant/internal-knowledge-schema";
import {
  createImsDocumentDraft,
  updateImsDocument,
  submitImsDocumentForReview,
  approveImsDocument,
  activateImsDocument,
  obsoleteImsDocument,
} from "@/lib/server/ims/document-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DIRECTOR_EMAIL = "joshua@asi-australia.com.au";

// Actions that require the principal's email to match the Director.
// These mirror the document-control sign-off boundary in ISO 7.5.3 —
// authoring (draft / submit / update) is open to any admin, but
// approval/activation/obsoletion is a Director-only signature.
const DIRECTOR_ONLY_KINDS = new Set<ProposedAction["kind"]>([
  "approve_ims_document",
  "activate_ims_document",
  "obsolete_ims_document",
]);

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const userSnap = await admin
      .firestore()
      .collection(COLLECTIONS.USERS)
      .doc(userId)
      .get();
    if (!userSnap.exists) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }
    const user = userSnap.data() as {
      role?: string;
      name?: string;
      email?: string;
    };
    if (user.role !== "admin") {
      return NextResponse.json(
        { error: "Only admins can execute assistant actions." },
        { status: 403 }
      );
    }

    const body = await req.json();
    const parsed = ProposedActionSchema.safeParse(body?.action);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid action payload.", issues: parsed.error.issues },
        { status: 400 }
      );
    }
    const action = parsed.data;

    const principalEmail = (user.email || "").toLowerCase();
    if (DIRECTOR_ONLY_KINDS.has(action.kind) && principalEmail !== DIRECTOR_EMAIL) {
      return NextResponse.json(
        {
          error: `Action '${action.kind}' is Director-only. Only ${DIRECTOR_EMAIL} can confirm document approval, activation, or obsoletion.`,
        },
        { status: 403 }
      );
    }

    const principalLabel =
      user.name || user.email?.split("@")[0] || `user:${userId}`;

    let result: unknown;
    switch (action.kind) {
      case "create_ims_document_draft":
        result = await createImsDocumentDraft({
          ...action.payload,
          createdBy: principalLabel,
        });
        break;
      case "update_ims_document":
        result = await updateImsDocument({
          ...action.payload,
          updatedBy: principalLabel,
        });
        break;
      case "submit_ims_document_for_review":
        result = await submitImsDocumentForReview({
          ...action.payload,
          submittedBy: principalLabel,
        });
        break;
      case "approve_ims_document":
        result = await approveImsDocument({
          ...action.payload,
          approverUserId: userId,
          approverEmail: principalEmail,
        });
        break;
      case "activate_ims_document":
        result = await activateImsDocument(action.payload);
        break;
      case "obsolete_ims_document":
        result = await obsoleteImsDocument({
          ...action.payload,
          obsoletedBy: principalLabel,
        });
        break;
    }

    // Audit trail — every confirmed action gets logged so we can trace
    // who clicked which button and when, alongside agent-initiated MCP
    // writes captured elsewhere.
    await admin
      .firestore()
      .collection(COLLECTIONS.ASSISTANT_MESSAGES)
      .add({
        userId,
        role: user.role,
        kind: "assistant-action",
        actionKind: action.kind,
        payload: action.payload,
        result,
        confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Assistant action failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
