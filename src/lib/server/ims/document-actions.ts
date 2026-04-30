// IMS document lifecycle handlers, shared between the MCP route and
// the in-portal assistant-action route (for GUARDIAN's proposedActions).
//
// These are server-only — they need Firestore admin and assume the
// caller has already authenticated and authorised the request.

import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";

const DIRECTOR_EMAIL = "joshua@asi-australia.com.au";

const VALID_RND_FOLDERS = new Set([
  "pm_planning",
  "engineering_design",
  "administration",
  "finance",
  "legal",
  "project_filing",
]);

const ALLOWED_UPDATE_FIELDS = new Set([
  "title",
  "content",
  "status",
  "processOwner",
  "isoClauses",
  "type",
  "docId",
  "rndProjectId",
  "rndNominationId",
  "rndFolder",
  "rndFinancialYear",
]);

function deriveAustralianFinancialYear(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth();
  const startYear = m >= 6 ? y : y - 1;
  const endShort = String((startYear + 1) % 100).padStart(2, "0");
  return `FY${startYear}-${endShort}`;
}

export async function createImsDocumentDraft(args: Record<string, unknown>) {
  const now = admin.firestore.FieldValue.serverTimestamp();
  const type = String(args.type || "procedure");

  const isManagementReview = type === "management_review";
  const managementReviewData = isManagementReview ? (args.managementReview || {}) : null;
  const meetingId = typeof args.meetingId === "string" ? args.meetingId : null;

  const rndProjectId =
    typeof args.rndProjectId === "string" && args.rndProjectId.trim()
      ? args.rndProjectId.trim()
      : null;
  const rndNominationId =
    typeof args.rndNominationId === "string" && args.rndNominationId.trim()
      ? args.rndNominationId.trim()
      : null;
  let rndFolder: string | null = null;
  if (typeof args.rndFolder === "string" && VALID_RND_FOLDERS.has(args.rndFolder)) {
    rndFolder = args.rndFolder;
  } else if (rndProjectId || rndNominationId) {
    rndFolder = "project_filing";
  }
  const rndFinancialYear =
    typeof args.rndFinancialYear === "string" && /^FY\d{4}-\d{2}$/.test(args.rndFinancialYear)
      ? args.rndFinancialYear
      : rndProjectId || rndNominationId
        ? deriveAustralianFinancialYear(new Date())
        : null;

  const payload: Record<string, unknown> = {
    title: String(args.title || ""),
    docId: args.docId ? String(args.docId) : null,
    type,
    status: "draft",
    approvalStatus: "draft",
    content: String(args.content || ""),
    processOwner: args.processOwner ? String(args.processOwner) : null,
    isoClauses: Array.isArray(args.isoClauses) ? args.isoClauses : [],
    revisionNumber: 1,
    revisionHistory: [],
    approvedBy: null,
    approvedAt: null,
    effectiveDate: null,
    reviewDueDate: null,
    nextReviewDate: null,
    supersededBy: null,
    supersedes: null,
    reviewOverdue: false,
    meetingId,
    managementReview: managementReviewData,
    rndProjectId,
    rndNominationId,
    rndFolder,
    rndFinancialYear,
    createdByAgent: true,
    createdAt: now,
    updatedAt: now,
  };
  const ref = await admin.firestore().collection(COLLECTIONS.IMS_DOCUMENTS).add(payload);
  return {
    id: ref.id,
    status: "draft",
    approvalStatus: "draft",
    title: payload.title,
    type,
    rndProjectId,
    rndNominationId,
    rndFolder,
    rndFinancialYear,
  };
}

export async function updateImsDocument(args: Record<string, unknown>) {
  const id = String(args.id || "");
  if (!id) throw new Error("id is required.");
  const updates = (args.updates || {}) as Record<string, unknown>;
  const changeNote = typeof args.changeNote === "string" ? args.changeNote : "";
  const updatedBy = typeof args.updatedBy === "string" ? args.updatedBy : "mcp-agent";

  const filtered: Record<string, unknown> = {};
  let contentChanged = false;
  for (const [k, v] of Object.entries(updates)) {
    if (ALLOWED_UPDATE_FIELDS.has(k)) {
      filtered[k] = v;
      if (k === "content" || k === "title") contentChanged = true;
    }
  }
  if (Object.keys(filtered).length === 0) throw new Error("No valid fields to update.");

  const db = admin.firestore();
  const docRef = db.collection(COLLECTIONS.IMS_DOCUMENTS).doc(id);
  const existing = await docRef.get();
  if (!existing.exists) throw new Error(`IMS document '${id}' not found.`);

  filtered.updatedAt = admin.firestore.FieldValue.serverTimestamp();

  if (contentChanged) {
    const currentRev = Number(existing.data()?.revisionNumber || 1);
    filtered.revisionNumber = currentRev + 1;
    filtered.revisionHistory = admin.firestore.FieldValue.arrayUnion({
      revision: currentRev + 1,
      updatedBy,
      updatedAt: new Date().toISOString(),
      changeNote: changeNote || "Content updated",
    });
  }

  await docRef.set(filtered, { merge: true });
  const updated = await docRef.get();
  return { id, ...(updated.data() || {}) };
}

export async function submitImsDocumentForReview(args: Record<string, unknown>) {
  const id = String(args.id || "");
  if (!id) throw new Error("id is required.");
  const db = admin.firestore();
  const docRef = db.collection(COLLECTIONS.IMS_DOCUMENTS).doc(id);
  const snap = await docRef.get();
  if (!snap.exists) throw new Error(`IMS document '${id}' not found.`);

  const current = snap.data()!;
  const currentStatus = String(current.approvalStatus || current.status || "draft");
  if (currentStatus !== "draft") {
    throw new Error(`Cannot submit for review: document is currently '${currentStatus}'. Must be 'draft'.`);
  }

  const submittedBy = typeof args.submittedBy === "string" ? args.submittedBy : "mcp-agent";
  await docRef.set(
    {
      approvalStatus: "under_review",
      status: "under_review",
      submittedForReviewAt: new Date().toISOString(),
      submittedForReviewBy: submittedBy,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { id, approvalStatus: "under_review", submittedBy, submittedAt: new Date().toISOString() };
}

export async function approveImsDocument(args: Record<string, unknown>) {
  const id = String(args.id || "");
  if (!id) throw new Error("id is required.");
  const approverUserId = String(args.approverUserId || "");
  const approverEmail =
    typeof args.approverEmail === "string" ? args.approverEmail.toLowerCase() : "";
  if (!approverUserId) throw new Error("approverUserId is required.");
  if (approverEmail && approverEmail !== DIRECTOR_EMAIL) {
    throw new Error(`Only the Director (${DIRECTOR_EMAIL}) can approve IMS documents.`);
  }
  const effectiveDate = String(args.effectiveDate || new Date().toISOString().split("T")[0]);
  const reviewDueDate = String(args.reviewDueDate || args.nextReviewDate || "");
  const nextReviewDate = String(args.nextReviewDate || args.reviewDueDate || "");
  if (!reviewDueDate) throw new Error("reviewDueDate (or nextReviewDate) is required (ISO date).");

  const db = admin.firestore();
  const docRef = db.collection(COLLECTIONS.IMS_DOCUMENTS).doc(id);
  const snap = await docRef.get();
  if (!snap.exists) throw new Error(`IMS document '${id}' not found.`);

  const current = snap.data()!;
  const currentStatus = String(current.approvalStatus || current.status || "draft");
  if (currentStatus !== "under_review") {
    throw new Error(`Cannot approve: document is currently '${currentStatus}'. Must be 'under_review'.`);
  }

  const now = new Date().toISOString();
  await docRef.set(
    {
      approvalStatus: "approved",
      status: "approved",
      approvedBy: approverUserId,
      approvedByEmail: approverEmail || null,
      approvedAt: now,
      effectiveDate,
      reviewDueDate,
      nextReviewDate,
      reviewOverdue: false,
      reviewReminderLog: [],
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return {
    id,
    approvalStatus: "approved",
    approvedBy: approverUserId,
    approvedAt: now,
    effectiveDate,
    reviewDueDate,
    nextReviewDate,
  };
}

export async function activateImsDocument(args: Record<string, unknown>) {
  const id = String(args.id || "");
  if (!id) throw new Error("id is required.");

  const db = admin.firestore();
  const docRef = db.collection(COLLECTIONS.IMS_DOCUMENTS).doc(id);
  const snap = await docRef.get();
  if (!snap.exists) throw new Error(`IMS document '${id}' not found.`);

  const current = snap.data()!;
  const currentStatus = String(current.approvalStatus || current.status || "draft");
  if (currentStatus !== "approved") {
    throw new Error(`Cannot activate: document is currently '${currentStatus}'. Must be 'approved'.`);
  }

  const docIdRef = current.docId ? String(current.docId) : null;
  const obsoletedIds: string[] = [];
  let supersedesId: string | null = null;
  if (docIdRef) {
    const priorSnap = await db
      .collection(COLLECTIONS.IMS_DOCUMENTS)
      .where("docId", "==", docIdRef)
      .where("approvalStatus", "==", "active")
      .get();
    const batch = db.batch();
    priorSnap.docs.forEach((d) => {
      if (d.id !== id) {
        batch.set(
          d.ref,
          {
            approvalStatus: "obsolete",
            status: "obsolete",
            obsoletedAt: new Date().toISOString(),
            obsoletedReason: `Superseded by revision ${current.revisionNumber || 1}`,
            supersededBy: id,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        obsoletedIds.push(d.id);
        supersedesId = d.id;
      }
    });
    await batch.commit();
  }

  await docRef.set(
    {
      approvalStatus: "active",
      status: "active",
      activatedAt: new Date().toISOString(),
      supersedes: supersedesId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { id, approvalStatus: "active", obsoletedPriorVersions: obsoletedIds };
}

export async function obsoleteImsDocument(args: Record<string, unknown>) {
  const id = String(args.id || "");
  if (!id) throw new Error("id is required.");
  const reason = String(args.reason || "");
  if (!reason) throw new Error("reason is required for audit trail.");

  const db = admin.firestore();
  const docRef = db.collection(COLLECTIONS.IMS_DOCUMENTS).doc(id);
  const snap = await docRef.get();
  if (!snap.exists) throw new Error(`IMS document '${id}' not found.`);

  const current = snap.data()!;
  const currentStatus = String(current.approvalStatus || current.status || "draft");
  if (currentStatus !== "active") {
    throw new Error(`Cannot obsolete: document is currently '${currentStatus}'. Must be 'active'.`);
  }

  await docRef.set(
    {
      approvalStatus: "obsolete",
      status: "obsolete",
      obsoletedAt: new Date().toISOString(),
      obsoletedReason: reason,
      obsoletedBy: typeof args.obsoletedBy === "string" ? args.obsoletedBy : "mcp-agent",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { id, approvalStatus: "obsolete", reason };
}
