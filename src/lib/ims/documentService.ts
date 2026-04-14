/**
 * IMS Document Service — canonical read/write layer.
 *
 * This service is the single source of truth for all Firestore reads and
 * writes against the `imsDocuments` collection. Every page, button, and
 * component that touches an IMS document must go through this service.
 *
 * Background / why this exists
 * ----------------------------
 * The `imsDocuments` collection has two schemas that coexist:
 *
 *   1. LEGACY schema — used by the original Doc Manager UI. Documents have
 *      a `revisions` subcollection and a `status` field with three values:
 *      "draft" | "active" | "obsolete". Approval happens on the revision
 *      record, then the parent doc gets `status: "active"` + a
 *      `currentRevisionId` pointer. Field names: `docNumber`, `docType`.
 *
 *   2. MCP schema — used by GUARDIAN and the agents via the MCP endpoints.
 *      No subcollection. Full lifecycle `approvalStatus` on the parent doc
 *      with five values: "draft" | "under_review" | "approved" | "active"
 *      | "obsolete". Approval writes canonical fields directly to the
 *      parent: approverEmail, approvedAt, effectiveDate, reviewDueDate,
 *      revisionHistory[]. Field names: `docId`, `type`.
 *
 * This service reads both and normalises them to a single `NormalisedDoc`
 * shape. Every write path updates BOTH schema's status fields atomically
 * so legacy reads and MCP reads stay in sync. That's how the split-brain
 * GUARDIAN caught (INC-2026-0001) is closed.
 *
 * All approval-state writes MUST go through the functions in this file.
 * Direct `updateDoc(doc(db, COLLECTIONS.IMS_DOCUMENTS, id), {...})` calls
 * from page components are forbidden under CAPA qwAtnxVNYiajLXk2CGc9.
 */

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";

// ─── Canonical normalised document shape ─────────────────────────────────────

/**
 * The five-state canonical lifecycle. This is the authoritative state machine.
 * Legacy three-state `status` is folded into this — legacy "draft" maps to
 * "draft", legacy "active" maps to "active", legacy "obsolete" maps to
 * "obsolete". Legacy docs never sit in "under_review" or "approved"
 * transient states.
 */
export type ApprovalState =
  | "draft"
  | "under_review"
  | "approved"
  | "active"
  | "obsolete";

export const APPROVAL_STATE_ORDER: ApprovalState[] = [
  "draft",
  "under_review",
  "approved",
  "active",
  "obsolete",
];

export interface RevisionHistoryEntry {
  revision: number;
  updatedBy: string;
  updatedAt: string;
  changeNote: string;
}

export interface NormalisedDoc {
  id: string;                          // Firestore document ID
  docId: string;                        // Display reference (ASI-POL-001, etc.) — resolved from docId OR docNumber
  title: string;
  type: string;                         // policy | manual | procedure | form | register | ...
  content: string;                      // Markdown body
  processOwner: string | null;
  isoClauses: string[];
  revisionNumber: number;
  revisionHistory: RevisionHistoryEntry[];

  // State — canonical 5-state lifecycle
  approvalStatus: ApprovalState;
  legacyStatus: string | null;          // Raw legacy `status` field for debugging

  // Approval metadata (populated once state >= "approved")
  approverEmail: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  effectiveDate: string | null;
  reviewDueDate: string | null;
  nextReviewDate: string | null;

  // Submission metadata (populated once state >= "under_review")
  submittedForReviewBy: string | null;
  submittedForReviewAt: string | null;

  // Lifecycle metadata
  activatedAt: string | null;
  obsoletedAt: string | null;
  obsoletedReason: string | null;
  obsoletedBy: string | null;
  supersedes: string | null;
  supersededBy: string | null;

  // Review tracking
  reviewOverdue: boolean;

  // Provenance
  createdAt: string | null;
  updatedAt: string | null;
  createdBy: string | null;

  // Legacy revision subcollection pointer (for docs that use it)
  currentRevisionId: string | null;
  currentRevisionNumber: number | null;

  // The raw document — used when we need fields not in the normalised shape
  raw: Record<string, unknown>;
}

// ─── Normalisation ───────────────────────────────────────────────────────────

function toIsoString(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (typeof v === "object" && v !== null && "toDate" in v && typeof (v as { toDate?: () => Date }).toDate === "function") {
    try {
      return (v as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Normalise a raw Firestore document into the canonical NormalisedDoc shape.
 * Handles both legacy (status) and MCP (approvalStatus) schemas.
 */
export function normaliseDoc(id: string, data: Record<string, unknown>): NormalisedDoc {
  // Resolve state: MCP approvalStatus takes precedence, fall back to legacy status
  const rawApprovalStatus = data.approvalStatus as string | undefined;
  const rawStatus = data.status as string | undefined;
  const effectiveState = (rawApprovalStatus || rawStatus || "draft") as string;
  // Coerce legacy values into canonical lifecycle
  const canonicalState: ApprovalState =
    effectiveState === "active" ? "active"
    : effectiveState === "obsolete" ? "obsolete"
    : effectiveState === "approved" ? "approved"
    : effectiveState === "under_review" ? "under_review"
    : "draft";

  // Resolve display reference: MCP docId OR legacy docNumber
  const displayRef = (data.docId as string) || (data.docNumber as string) || id.slice(0, 8);

  // Resolve type: MCP type OR legacy docType
  const docType = (data.type as string) || (data.docType as string) || "unknown";

  // Revision history — both schemas write to this array, just in different ways
  const rawHistory = (data.revisionHistory as RevisionHistoryEntry[] | undefined) || [];

  return {
    id,
    docId: displayRef,
    title: String(data.title || "Untitled"),
    type: docType,
    content: String(data.content || ""),
    processOwner: (data.processOwner as string) || null,
    isoClauses: Array.isArray(data.isoClauses) ? (data.isoClauses as string[]) : [],
    revisionNumber: Number(data.revisionNumber || data.currentRevisionNumber || 1),
    revisionHistory: rawHistory,
    approvalStatus: canonicalState,
    legacyStatus: rawStatus || null,
    approverEmail: (data.approverEmail as string) || (data.approvedByEmail as string) || null,
    approvedBy: (data.approvedBy as string) || null,
    approvedAt: toIsoString(data.approvedAt),
    effectiveDate: (data.effectiveDate as string) || null,
    reviewDueDate: (data.reviewDueDate as string) || null,
    nextReviewDate: (data.nextReviewDate as string) || null,
    submittedForReviewBy: (data.submittedForReviewBy as string) || null,
    submittedForReviewAt: toIsoString(data.submittedForReviewAt),
    activatedAt: toIsoString(data.activatedAt),
    obsoletedAt: toIsoString(data.obsoletedAt),
    obsoletedReason: (data.obsoletedReason as string) || null,
    obsoletedBy: (data.obsoletedBy as string) || null,
    supersedes: (data.supersedes as string) || null,
    supersededBy: (data.supersededBy as string) || null,
    reviewOverdue: Boolean(data.reviewOverdue),
    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt),
    createdBy: (data.createdBy as string) || (data.createdByAgent ? "agent" : null),
    currentRevisionId: (data.currentRevisionId as string) || null,
    currentRevisionNumber: (data.currentRevisionNumber as number) || null,
    raw: data,
  };
}

// ─── Reads ───────────────────────────────────────────────────────────────────

/**
 * Subscribe live to a single document by Firestore ID. Returns an unsubscribe
 * function. Callback receives the normalised doc or null if not found.
 */
export function subscribeDocument(
  id: string,
  callback: (doc: NormalisedDoc | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  return onSnapshot(
    doc(db, COLLECTIONS.IMS_DOCUMENTS, id),
    (snap) => {
      if (!snap.exists()) {
        callback(null);
        return;
      }
      callback(normaliseDoc(snap.id, snap.data()));
    },
    (err) => {
      if (onError) onError(err);
      else console.error("[documentService] subscribeDocument error:", err);
    }
  );
}

/**
 * One-shot fetch of a single document. Used for server-side or one-time reads.
 */
export async function fetchDocument(id: string): Promise<NormalisedDoc | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.IMS_DOCUMENTS, id));
  if (!snap.exists()) return null;
  return normaliseDoc(snap.id, snap.data());
}

/**
 * Subscribe live to all IMS documents, ordered by most recent first.
 * Performs NO status filter — list pages should filter in-memory using the
 * normalised `approvalStatus` to avoid schema-divergence bugs. This returns
 * every doc regardless of legacy vs MCP schema.
 */
export function subscribeAllDocuments(
  callback: (docs: NormalisedDoc[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  // Order by createdAt descending — works for both schemas since both set it
  const q = query(collection(db, COLLECTIONS.IMS_DOCUMENTS), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snap) => {
      callback(snap.docs.map((d) => normaliseDoc(d.id, d.data())));
    },
    (err) => {
      if (onError) onError(err);
      else console.error("[documentService] subscribeAllDocuments error:", err);
    }
  );
}

/**
 * Subscribe live to documents of a specific type. Used by the Policies
 * list, Procedures list, etc.
 *
 * We deliberately query by the legacy `docType` field AND the MCP `type`
 * field using two separate snapshots and merge in memory, because Firestore
 * doesn't support OR queries on different fields without a composite index
 * setup that would require both fields on every doc. This is a small
 * transitional cost that goes away once the dual-schema period ends.
 */
export function subscribeDocumentsByType(
  typeValue: string,
  callback: (docs: NormalisedDoc[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  // Subscribe to all docs and filter in-memory. Firestore collection is
  // small (<500 docs expected for ASI's IMS over its lifetime) so this is
  // cheap and avoids the OR-query problem.
  return subscribeAllDocuments((allDocs) => {
    const filtered = allDocs.filter((d) => d.type === typeValue);
    callback(filtered);
  }, onError);
}

// ─── Writes — state transitions ──────────────────────────────────────────────

const DIRECTOR_EMAIL = "joshua@asi-australia.com.au";

export interface TransitionActor {
  uid: string;
  email: string;
  name: string;
}

function assertDirector(actor: TransitionActor, action: string): void {
  if (actor.email.toLowerCase().trim() !== DIRECTOR_EMAIL) {
    throw new Error(
      `${action} is restricted to the Director (${DIRECTOR_EMAIL}). Current user: ${actor.email}`
    );
  }
}

/**
 * Append a new entry to the revision history array. Used by every write path.
 */
function buildRevisionEntry(
  nextRevision: number,
  actor: TransitionActor,
  changeNote: string
): RevisionHistoryEntry {
  return {
    revision: nextRevision,
    updatedBy: `${actor.name} (${actor.email})`,
    updatedAt: new Date().toISOString(),
    changeNote,
  };
}

/**
 * Submit a document for review: draft → under_review.
 * Any staff member can submit. No director lock.
 */
export async function submitForReview(
  docId: string,
  actor: TransitionActor
): Promise<void> {
  const existing = await fetchDocument(docId);
  if (!existing) throw new Error(`Document ${docId} not found.`);
  if (existing.approvalStatus !== "draft") {
    throw new Error(
      `Cannot submit for review: document is currently "${existing.approvalStatus}". Must be "draft".`
    );
  }

  const nextRevision = (existing.revisionNumber || 1) + 1;
  const historyEntry = buildRevisionEntry(
    nextRevision,
    actor,
    `Submitted for Director review.`
  );

  await updateDoc(doc(db, COLLECTIONS.IMS_DOCUMENTS, docId), {
    approvalStatus: "under_review",
    status: "under_review",
    submittedForReviewBy: `${actor.name} (${actor.email})`,
    submittedForReviewAt: new Date().toISOString(),
    revisionNumber: nextRevision,
    revisionHistory: [...existing.revisionHistory, historyEntry],
    updatedAt: serverTimestamp(),
  });
}

/**
 * Approve a document: under_review → approved.
 *
 * DIRECTOR-ONLY. Enforced both client-side (here) and server-side (MCP
 * endpoint). Writes the FULL canonical field set atomically:
 *   - approvalStatus + legacy status
 *   - approverEmail, approvedBy, approvedAt
 *   - effectiveDate, reviewDueDate, nextReviewDate
 *   - appended revisionHistory entry
 *   - incremented revisionNumber
 *
 * This is the write path that closes INC-2026-0001 Gap 2.
 */
export async function approveDocument(
  docId: string,
  actor: TransitionActor,
  effectiveDate: string,
  reviewDueDate: string
): Promise<void> {
  assertDirector(actor, "Document approval");

  if (!effectiveDate || !reviewDueDate) {
    throw new Error("Both effectiveDate and reviewDueDate are required.");
  }

  const existing = await fetchDocument(docId);
  if (!existing) throw new Error(`Document ${docId} not found.`);
  if (existing.approvalStatus !== "under_review") {
    throw new Error(
      `Cannot approve: document is currently "${existing.approvalStatus}". Must be "under_review".`
    );
  }

  const nextRevision = (existing.revisionNumber || 1) + 1;
  const approvedAtIso = new Date().toISOString();
  const historyEntry = buildRevisionEntry(
    nextRevision,
    actor,
    `Approved by Director. Effective: ${effectiveDate}. Next review: ${reviewDueDate}.`
  );

  await updateDoc(doc(db, COLLECTIONS.IMS_DOCUMENTS, docId), {
    approvalStatus: "approved",
    status: "approved",
    approverEmail: actor.email,
    approvedByEmail: actor.email,
    approvedBy: `${actor.name}, Director`,
    approvedAt: approvedAtIso,
    effectiveDate,
    reviewDueDate,
    nextReviewDate: reviewDueDate,
    reviewOverdue: false,
    reviewReminderLog: [],
    revisionNumber: nextRevision,
    revisionHistory: [...existing.revisionHistory, historyEntry],
    updatedAt: serverTimestamp(),
  });
}

/**
 * Activate a document: approved → active.
 *
 * DIRECTOR-ONLY. Auto-obsoletes any prior document with the same docId
 * reference that is currently active (revision succession). This mirrors
 * the MCP `activate_ims_document` handler.
 */
export async function activateDocument(
  activateId: string,
  actor: TransitionActor
): Promise<void> {
  assertDirector(actor, "Document activation");

  const existing = await fetchDocument(activateId);
  if (!existing) throw new Error(`Document ${activateId} not found.`);
  if (existing.approvalStatus !== "approved") {
    throw new Error(
      `Cannot activate: document is currently "${existing.approvalStatus}". Must be "approved".`
    );
  }

  const nextRevision = (existing.revisionNumber || 1) + 1;
  const activatedAtIso = new Date().toISOString();
  const historyEntry = buildRevisionEntry(
    nextRevision,
    actor,
    `Activated by Director. Document is now the controlled current version.`
  );

  // Find and auto-obsolete prior active versions with the same docId reference
  const sameRefDocs = existing.docId
    ? await new Promise<{ id: string; approvalStatus: ApprovalState }[]>((resolve) => {
        const q = query(
          collection(db, COLLECTIONS.IMS_DOCUMENTS),
          where("docId", "==", existing.docId)
        );
        const unsub = onSnapshot(q, (snap) => {
          unsub();
          resolve(
            snap.docs
              .map((d) => ({
                id: d.id,
                approvalStatus: normaliseDoc(d.id, d.data()).approvalStatus,
              }))
              .filter((d) => d.id !== activateId && d.approvalStatus === "active")
          );
        });
      })
    : [];

  for (const prior of sameRefDocs) {
    await updateDoc(doc(db, COLLECTIONS.IMS_DOCUMENTS, prior.id), {
      approvalStatus: "obsolete",
      status: "obsolete",
      obsoletedAt: activatedAtIso,
      obsoletedReason: `Superseded by ${existing.docId} revision ${nextRevision}.`,
      obsoletedBy: `${actor.name}, Director (auto-supersede)`,
      supersededBy: activateId,
      updatedAt: serverTimestamp(),
    });
  }

  await updateDoc(doc(db, COLLECTIONS.IMS_DOCUMENTS, activateId), {
    approvalStatus: "active",
    status: "active",
    activatedAt: activatedAtIso,
    revisionNumber: nextRevision,
    revisionHistory: [...existing.revisionHistory, historyEntry],
    updatedAt: serverTimestamp(),
  });
}

/**
 * Obsolete a document: active → obsolete. Requires a reason (audit trail).
 * DIRECTOR-ONLY.
 */
export async function obsoleteDocument(
  docIdFs: string,
  actor: TransitionActor,
  reason: string
): Promise<void> {
  assertDirector(actor, "Document obsoleting");
  if (!reason || !reason.trim()) {
    throw new Error("A reason is required to obsolete a controlled document.");
  }

  const existing = await fetchDocument(docIdFs);
  if (!existing) throw new Error(`Document ${docIdFs} not found.`);
  if (existing.approvalStatus !== "active") {
    throw new Error(
      `Cannot obsolete: document is currently "${existing.approvalStatus}". Must be "active".`
    );
  }

  const nextRevision = (existing.revisionNumber || 1) + 1;
  const historyEntry = buildRevisionEntry(
    nextRevision,
    actor,
    `Obsoleted by Director. Reason: ${reason}`
  );

  await updateDoc(doc(db, COLLECTIONS.IMS_DOCUMENTS, docIdFs), {
    approvalStatus: "obsolete",
    status: "obsolete",
    obsoletedAt: new Date().toISOString(),
    obsoletedReason: reason,
    obsoletedBy: `${actor.name}, Director`,
    revisionNumber: nextRevision,
    revisionHistory: [...existing.revisionHistory, historyEntry],
    updatedAt: serverTimestamp(),
  });
}

// ─── Helpers for UI ──────────────────────────────────────────────────────────

export function canSubmit(d: NormalisedDoc): boolean {
  return d.approvalStatus === "draft";
}

export function canApprove(d: NormalisedDoc): boolean {
  return d.approvalStatus === "under_review";
}

export function canActivate(d: NormalisedDoc): boolean {
  return d.approvalStatus === "approved";
}

export function canObsolete(d: NormalisedDoc): boolean {
  return d.approvalStatus === "active";
}

export function isDirector(email?: string | null): boolean {
  if (!email) return false;
  return email.toLowerCase().trim() === DIRECTOR_EMAIL;
}

/**
 * Status → colour + label for the branded viewer's status badge.
 * Kept in this service so the colour mapping is consistent across every
 * component that displays a status badge.
 */
export function statusDisplay(state: ApprovalState): { label: string; className: string } {
  switch (state) {
    case "draft":
      return { label: "DRAFT", className: "bg-[var(--asi-grey-200)] text-[var(--asi-charcoal)] border-[var(--asi-grey-200)]" };
    case "under_review":
      return { label: "UNDER REVIEW", className: "bg-[var(--asi-yellow)] text-[var(--asi-black)] border-[var(--asi-yellow-dark)]" };
    case "approved":
      return { label: "APPROVED", className: "bg-[var(--asi-blue)] text-white border-[var(--asi-blue-dark)]" };
    case "active":
      return { label: "ACTIVE", className: "bg-[#2E7D32] text-white border-[#1B5E20]" };
    case "obsolete":
      return { label: "OBSOLETE", className: "bg-[var(--asi-red-alert)] text-white border-[var(--asi-red-alert)]" };
  }
}

