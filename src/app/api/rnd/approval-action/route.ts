/**
 * POST /api/rnd/approval-action
 * Director-facing approval actions on Sophie Archer's R&D workspace.
 *
 * One endpoint, three action types:
 *   - rnd_project:  approve | reject | request_amendments  (writes to approvals.director)
 *   - grant:        approve | reject | request_amendments  (writes to internalApprovals.director)
 *   - opportunity:  accept | park | reject | request_amendments
 *
 * "request_amendments" is the new review-notes path: writes a note to
 * statusLog but does NOT set the approval decision, so Sophie can see
 * the ask and cycle back.
 *
 * Staff-authenticated. Mirrors the MCP handlers (record_rnd_project_approval,
 * record_grant_internal_approval, review_rnd_opportunity) but driven from
 * the UI with the current user as the decider — no MCP secret required.
 */

import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ActionPayload {
  type?: "rnd_project" | "grant" | "opportunity";
  id?: string;
  decision?:
    | "approved"
    | "rejected"
    | "request_amendments"
    | "accept"
    | "park"
    | "reject";
  note?: string;
  parkedUntil?: string; // opportunity park only
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
    // Approvals are a Director-level action. Technicians can see the queue
    // but not action items — that's a human-in-the-loop policy decision.
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Only admins can action approvals." }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as ActionPayload;
    const { type, id, decision, note, parkedUntil } = body;
    if (!type || !id || !decision) {
      return NextResponse.json(
        { error: "type, id, and decision are required." },
        { status: 400 }
      );
    }

    const actorName = user.name || user.email || "Director";
    const nowIso = new Date().toISOString();
    const serverTs = admin.firestore.FieldValue.serverTimestamp();

    if (type === "rnd_project") {
      const ref = db.collection(COLLECTIONS.RND_PROJECTS).doc(id);
      const snap = await ref.get();
      if (!snap.exists) return NextResponse.json({ error: "Project not found." }, { status: 404 });
      const existing = snap.data()!;
      const statusLog = (existing.statusLog as unknown[]) || [];

      if (decision === "request_amendments") {
        // Don't change approval state — just log the ask so Archer sees it.
        statusLog.push({
          changedAt: nowIso,
          changedBy: actorName,
          note: `Director requested amendments${note ? `: ${note}` : ""}`,
        });
        await ref.update({
          statusLog,
          directorReviewNote: note || null,
          directorReviewRequestedAt: nowIso,
          updatedAt: serverTs,
        });
      } else if (decision === "approved" || decision === "rejected") {
        const approvals = (existing.approvals as Record<string, unknown>) || {};
        approvals.director = {
          decision,
          approver: "DIRECTOR",
          decidedAt: nowIso,
          decidedBy: actorName,
          ...(note ? { note } : {}),
        };
        statusLog.push({
          changedAt: nowIso,
          changedBy: actorName,
          note: `Director ${decision}${note ? `: ${note}` : ""}`,
        });
        await ref.update({ approvals, statusLog, updatedAt: serverTs });
      } else {
        return NextResponse.json(
          { error: "Invalid decision for rnd_project." },
          { status: 400 }
        );
      }
      return NextResponse.json({ ok: true });
    }

    if (type === "grant") {
      const ref = db.collection(COLLECTIONS.GRANT_APPLICATIONS).doc(id);
      const snap = await ref.get();
      if (!snap.exists) return NextResponse.json({ error: "Grant not found." }, { status: 404 });
      const existing = snap.data()!;
      const statusLog = (existing.statusLog as unknown[]) || [];
      const stage = String(existing.stage || "scoping");

      if (decision === "request_amendments") {
        statusLog.push({
          stage,
          changedAt: nowIso,
          changedBy: actorName,
          note: `Director requested amendments${note ? `: ${note}` : ""}`,
        });
        await ref.update({
          statusLog,
          directorReviewNote: note || null,
          directorReviewRequestedAt: nowIso,
          updatedAt: serverTs,
        });
      } else if (decision === "approved" || decision === "rejected") {
        const internalApprovals = (existing.internalApprovals as Record<string, unknown>) || {};
        internalApprovals.director = {
          decision,
          approver: "DIRECTOR",
          decidedAt: nowIso,
          decidedBy: actorName,
          ...(note ? { note } : {}),
        };
        statusLog.push({
          stage,
          changedAt: nowIso,
          changedBy: actorName,
          note: `Director ${decision}${note ? `: ${note}` : ""}`,
        });
        await ref.update({
          internalApprovals,
          statusLog,
          updatedAt: serverTs,
        });
      } else {
        return NextResponse.json(
          { error: "Invalid decision for grant." },
          { status: 400 }
        );
      }
      return NextResponse.json({ ok: true });
    }

    if (type === "opportunity") {
      const ref = db.collection(COLLECTIONS.RND_OPPORTUNITY_LOG).doc(id);
      const snap = await ref.get();
      if (!snap.exists)
        return NextResponse.json({ error: "Opportunity not found." }, { status: 404 });
      const existing = snap.data()!;
      const statusLog = (existing.statusLog as unknown[]) || [];

      if (decision === "request_amendments") {
        statusLog.push({
          changedAt: nowIso,
          changedBy: actorName,
          note: `Director requested amendments${note ? `: ${note}` : ""}`,
        });
        await ref.update({
          statusLog,
          directorReviewNote: note || null,
          directorReviewRequestedAt: nowIso,
          updatedAt: serverTs,
        });
      } else if (decision === "accept" || decision === "park" || decision === "reject") {
        const updates: Record<string, unknown> = { updatedAt: serverTs };
        if (decision === "accept") updates.status = "accepted";
        else if (decision === "park") {
          updates.status = "parked";
          if (parkedUntil) updates.parkedUntil = parkedUntil;
        } else updates.status = "rejected";

        statusLog.push({
          changedAt: nowIso,
          changedBy: actorName,
          note: `Director ${decision}${note ? `: ${note}` : ""}`,
        });
        updates.statusLog = statusLog;
        await ref.update(updates);
      } else {
        return NextResponse.json(
          { error: "Invalid decision for opportunity." },
          { status: 400 }
        );
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown type." }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Action failed." },
      { status: 400 }
    );
  }
}
