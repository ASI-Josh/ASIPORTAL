/**
 * /api/rnd/nomination — R&D project nomination workflow.
 *
 * POST body action:
 *   - create         : Josh submits a nomination (+ optional programme IDs)
 *   - update_prefeas : Archer writes the pre-feas brief, moves status to prefeas_complete
 *   - approve        : Director approves → creates RndProject (+ optional draft GrantApplications)
 *   - reject         : Director rejects
 *   - withdraw       : Submitter withdraws
 *
 * Staff-authenticated. approve/reject are admin-only (Director role).
 */

import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NominationAction =
  | "create"
  | "update_prefeas"
  | "approve"
  | "reject"
  | "withdraw";

interface PreFeasInput {
  strategicFitScore?: number;
  technicalFeasibilityScore?: number;
  marketRegulatoryContext?: string;
  grantMatch?: string;
  costEnvelopeMin?: number;
  costEnvelopeMax?: number;
  flagsAndRisks?: string[];
  verdict?: "pursue" | "park" | "reject";
}

interface NominationPayload {
  action?: NominationAction;
  id?: string;                       // required for all actions except create

  // create-only
  title?: string;
  rationale?: string;
  domain?: string;
  priority?: "low" | "medium" | "high" | "critical";
  targetCompletionDate?: string;
  suggestedProgrammeIds?: string[];
  selectedProgrammeIds?: string[];

  // update_prefeas
  preFeas?: PreFeasInput;

  // approve/reject/withdraw
  note?: string;

  // approve-only: tagged programme IDs to auto-draft grants against.
  // If omitted, uses nomination.selectedProgrammeIds.
  createGrantDraftsFor?: string[];
}

function clampScore(n: unknown): number {
  const v = typeof n === "number" ? n : 0;
  return Math.max(1, Math.min(5, Math.round(v)));
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const db = admin.firestore();
    const userSnap = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    const user = userSnap.data() as { role?: string; name?: string; email?: string } | undefined;
    if (!user || !["admin", "technician"].includes(user.role || "")) {
      return NextResponse.json({ error: "Staff access required." }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as NominationPayload;
    const action = body.action;
    const actorName = user.name || user.email || "staff";
    const nowIso = new Date().toISOString();
    const serverTs = admin.firestore.FieldValue.serverTimestamp();

    if (!action) {
      return NextResponse.json({ error: "action is required." }, { status: 400 });
    }

    // ─── create ────────────────────────────────────────────────────────────
    if (action === "create") {
      const title = (body.title || "").trim();
      const rationale = (body.rationale || "").trim();
      if (!title || !rationale) {
        return NextResponse.json(
          { error: "title and rationale are required for create." },
          { status: 400 }
        );
      }

      const payload: Record<string, unknown> = {
        title,
        rationale,
        status: "submitted",
        submittedBy: userId,
        submittedByName: actorName,
        createdAt: serverTs,
        updatedAt: serverTs,
      };
      if (body.domain) payload.domain = body.domain;
      if (body.priority) payload.priority = body.priority;
      if (body.targetCompletionDate) payload.targetCompletionDate = body.targetCompletionDate;
      if (Array.isArray(body.suggestedProgrammeIds) && body.suggestedProgrammeIds.length > 0) {
        payload.suggestedProgrammeIds = body.suggestedProgrammeIds.filter(
          (v): v is string => typeof v === "string"
        );
      }
      if (Array.isArray(body.selectedProgrammeIds) && body.selectedProgrammeIds.length > 0) {
        payload.selectedProgrammeIds = body.selectedProgrammeIds.filter(
          (v): v is string => typeof v === "string"
        );
      }

      const ref = await db.collection(COLLECTIONS.RND_PROJECT_NOMINATIONS).add(payload);
      return NextResponse.json({ ok: true, id: ref.id, status: "submitted" });
    }

    // All other actions require id
    const id = body.id;
    if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

    const ref = db.collection(COLLECTIONS.RND_PROJECT_NOMINATIONS).doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Nomination not found." }, { status: 404 });
    }
    const existing = snap.data()!;

    // ─── update_prefeas ────────────────────────────────────────────────────
    if (action === "update_prefeas") {
      const pf = body.preFeas || {};
      if (!pf.marketRegulatoryContext || !pf.grantMatch || !pf.verdict) {
        return NextResponse.json(
          { error: "preFeas.marketRegulatoryContext, grantMatch, and verdict are required." },
          { status: 400 }
        );
      }
      const preFeas = {
        strategicFitScore: clampScore(pf.strategicFitScore),
        technicalFeasibilityScore: clampScore(pf.technicalFeasibilityScore),
        marketRegulatoryContext: String(pf.marketRegulatoryContext),
        grantMatch: String(pf.grantMatch),
        costEnvelopeMin: typeof pf.costEnvelopeMin === "number" ? pf.costEnvelopeMin : null,
        costEnvelopeMax: typeof pf.costEnvelopeMax === "number" ? pf.costEnvelopeMax : null,
        flagsAndRisks: Array.isArray(pf.flagsAndRisks) ? pf.flagsAndRisks : [],
        verdict: pf.verdict,
        writtenBy: actorName,
        writtenAt: nowIso,
      };
      await ref.update({
        preFeas,
        status: "prefeas_complete",
        updatedAt: serverTs,
      });
      return NextResponse.json({ ok: true, status: "prefeas_complete" });
    }

    // ─── approve ────────────────────────────────────────────────────────────
    if (action === "approve") {
      if (user.role !== "admin") {
        return NextResponse.json({ error: "Only admins can approve nominations." }, { status: 403 });
      }

      // Create the RndProject.
      const title = String(existing.title || "Untitled R&D Project");
      const rationale = String(existing.rationale || "");
      const projectNumber = await generateRndProjectNumber(db);
      const preFeas = (existing.preFeas || {}) as Record<string, unknown>;
      const estimatedBudget =
        typeof preFeas.costEnvelopeMax === "number"
          ? preFeas.costEnvelopeMax
          : typeof preFeas.costEnvelopeMin === "number"
            ? preFeas.costEnvelopeMin
            : null;

      const projectPayload: Record<string, unknown> = {
        projectNumber,
        title,
        shortDescription: rationale.slice(0, 400),
        phase: "scoping",
        status: "active",
        priority: existing.priority || "medium",
        domain: existing.domain || "other",
        leadAgent: "ARCHER",
        requiresDirectorApproval: false, // already approved via nomination
        approvals: {
          athena: { decision: "pending", approver: "ATHENA" },
          director: {
            decision: "approved",
            approver: "DIRECTOR",
            decidedAt: nowIso,
            decidedBy: actorName,
            note: body.note || "Approved via nomination pipeline.",
          },
        },
        estimatedBudget,
        actualSpendToDate: 0,
        targetCompletionDate: existing.targetCompletionDate || null,
        nominationId: id,
        nominationPreFeas: existing.preFeas || null,
        statusLog: [
          {
            changedAt: nowIso,
            changedBy: actorName,
            note: `Project created from nomination ${id}.`,
          },
        ],
        createdAt: serverTs,
        updatedAt: serverTs,
        createdBy: actorName,
      };
      const projectRef = await db.collection(COLLECTIONS.RND_PROJECTS).add(projectPayload);

      // Optionally draft grant applications against tagged programmes.
      const programmeIds = Array.isArray(body.createGrantDraftsFor)
        ? body.createGrantDraftsFor
        : (existing.selectedProgrammeIds as string[] | undefined) || [];

      const convertedGrantIds: string[] = [];
      for (const programmeId of programmeIds) {
        try {
          const progSnap = await db
            .collection(COLLECTIONS.RND_GRANT_PROGRAMMES)
            .doc(programmeId)
            .get();
          if (!progSnap.exists) continue;
          const prog = progSnap.data()!;
          const grantNumber = await generateGrantNumber(db);
          const grantRef = await db.collection(COLLECTIONS.GRANT_APPLICATIONS).add({
            grantNumber,
            programmeName: prog.programmeName,
            programmeBody: prog.programmeBody,
            programmeId,
            fundingType: prog.fundingType || "grant",
            stage: "scoping",
            awardValue: prog.typicalValueMax || prog.typicalValueMin || null,
            linkedRndProjectIds: [projectRef.id],
            nominationId: id,
            statusLog: [
              {
                stage: "scoping",
                changedAt: nowIso,
                changedBy: actorName,
                note: `Drafted from nomination ${id} approval (project ${projectRef.id}).`,
              },
            ],
            createdAt: serverTs,
            updatedAt: serverTs,
            createdBy: actorName,
          });
          convertedGrantIds.push(grantRef.id);
        } catch (err) {
          console.error("Failed to draft grant for programme", programmeId, err);
        }
      }

      await ref.update({
        status: "approved",
        directorDecision: "approved",
        directorNote: body.note || null,
        directorDecidedAt: nowIso,
        directorDecidedBy: actorName,
        convertedProjectId: projectRef.id,
        convertedGrantIds,
        updatedAt: serverTs,
      });

      return NextResponse.json({
        ok: true,
        status: "approved",
        convertedProjectId: projectRef.id,
        convertedGrantIds,
      });
    }

    // ─── reject ─────────────────────────────────────────────────────────────
    if (action === "reject") {
      if (user.role !== "admin") {
        return NextResponse.json({ error: "Only admins can reject nominations." }, { status: 403 });
      }
      await ref.update({
        status: "rejected",
        directorDecision: "rejected",
        directorNote: body.note || null,
        directorDecidedAt: nowIso,
        directorDecidedBy: actorName,
        updatedAt: serverTs,
      });
      return NextResponse.json({ ok: true, status: "rejected" });
    }

    // ─── withdraw ───────────────────────────────────────────────────────────
    if (action === "withdraw") {
      // Only the submitter or an admin can withdraw.
      if (existing.submittedBy !== userId && user.role !== "admin") {
        return NextResponse.json(
          { error: "Only the submitter or an admin can withdraw." },
          { status: 403 }
        );
      }
      await ref.update({
        status: "withdrawn",
        updatedAt: serverTs,
      });
      return NextResponse.json({ ok: true, status: "withdrawn" });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Nomination action failed." },
      { status: 400 }
    );
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

async function generateRndProjectNumber(db: admin.firestore.Firestore): Promise<string> {
  // Mirror the MCP nextRndNumber pattern — atomic counter in rndCounters.
  const year = new Date().getFullYear();
  const counterRef = db.collection(COLLECTIONS.RND_COUNTERS).doc(`projects-${year}`);
  const next = await db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists ? (snap.data() as { count?: number }).count || 0 : 0;
    const n = current + 1;
    tx.set(counterRef, { count: n }, { merge: true });
    return n;
  });
  return `RND-${year}-${String(next).padStart(4, "0")}`;
}

async function generateGrantNumber(db: admin.firestore.Firestore): Promise<string> {
  const year = new Date().getFullYear();
  const counterRef = db.collection(COLLECTIONS.RND_COUNTERS).doc(`grants-${year}`);
  const next = await db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists ? (snap.data() as { count?: number }).count || 0 : 0;
    const n = current + 1;
    tx.set(counterRef, { count: n }, { merge: true });
    return n;
  });
  return `GRT-${year}-${String(next).padStart(4, "0")}`;
}
