/**
 * GET /api/rnd/data
 * Single-call dashboard data for Sophie Archer's workspace.
 * Returns projects, grants, opportunities, and grant programmes in
 * one round trip so the UI doesn't need four separate subscriptions.
 *
 * Staff-authenticated (not admin-only) — the workspace is visible to
 * all staff so ATHENA can view Sophie's register without admin rights.
 */
import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";

function serializeTimestamp(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "object" && value !== null) {
    const v = value as { toDate?: () => Date; toMillis?: () => number; _seconds?: number };
    if (typeof v.toMillis === "function") return new Date(v.toMillis()).toISOString();
    if (typeof v.toDate === "function") return v.toDate().toISOString();
    if (typeof v._seconds === "number") return new Date(v._seconds * 1000).toISOString();
  }
  if (typeof value === "string") return value;
  return null;
}

function serializeDoc(doc: admin.firestore.DocumentSnapshot): Record<string, unknown> {
  const data = doc.data() || {};
  const out: Record<string, unknown> = { id: doc.id };
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "toMillis" in (v as Record<string, unknown>)) {
      out[k] = serializeTimestamp(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const db = admin.firestore();
    const userSnap = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    const user = userSnap.data() as { role?: string } | undefined;
    if (!user || !["admin", "technician"].includes(user.role || "")) {
      return NextResponse.json({ error: "Staff access required." }, { status: 403 });
    }

    // Fetch all five collections in parallel. Nominations may be absent on
    // older tenants — catch + empty list, don't fail the whole dashboard.
    const [projectsSnap, grantsSnap, oppsSnap, programmesSnap, nominationsSnap] = await Promise.all([
      db.collection(COLLECTIONS.RND_PROJECTS)
        .orderBy("updatedAt", "desc")
        .limit(100)
        .get(),
      db.collection(COLLECTIONS.GRANT_APPLICATIONS)
        .orderBy("updatedAt", "desc")
        .limit(100)
        .get(),
      db.collection(COLLECTIONS.RND_OPPORTUNITY_LOG)
        .orderBy("createdAt", "desc")
        .limit(100)
        .get(),
      db.collection(COLLECTIONS.RND_GRANT_PROGRAMMES)
        .where("isActive", "==", true)
        .limit(100)
        .get(),
      db.collection(COLLECTIONS.RND_PROJECT_NOMINATIONS)
        .orderBy("createdAt", "desc")
        .limit(100)
        .get()
        .catch(() => null),
    ]);

    const projects = projectsSnap.docs.map(serializeDoc);
    const grants = grantsSnap.docs.map(serializeDoc);
    const opportunities = oppsSnap.docs.map(serializeDoc);
    const programmes = programmesSnap.docs.map(serializeDoc);
    const nominations = nominationsSnap ? nominationsSnap.docs.map(serializeDoc) : [];

    // Summary metrics computed server-side
    const now = new Date();
    const currentYear = now.getFullYear();
    const today = now.toISOString().split("T")[0];
    const thirtyDaysOut = new Date(now.getTime() + 30 * 86400_000).toISOString().split("T")[0];

    // Project metrics
    const projectMetrics = {
      total: projects.length,
      active: projects.filter((p) => p.status === "active").length,
      onHold: projects.filter((p) => p.status === "on_hold").length,
      completed: projects.filter((p) => p.status === "completed").length,
      byPhase: {} as Record<string, number>,
      byDomain: {} as Record<string, number>,
      totalBudget: 0,
      totalSpend: 0,
      pendingAthenaApproval: 0,
      pendingDirectorApproval: 0,
    };
    for (const p of projects) {
      const phase = String(p.phase || "unknown");
      const domain = String(p.domain || "unknown");
      projectMetrics.byPhase[phase] = (projectMetrics.byPhase[phase] || 0) + 1;
      projectMetrics.byDomain[domain] = (projectMetrics.byDomain[domain] || 0) + 1;
      if (typeof p.estimatedBudget === "number") projectMetrics.totalBudget += p.estimatedBudget;
      if (typeof p.actualSpendToDate === "number") projectMetrics.totalSpend += p.actualSpendToDate;
      const approvals = p.approvals as { athena?: { decision?: string }; director?: { decision?: string } } | undefined;
      if (approvals?.athena?.decision === "pending") projectMetrics.pendingAthenaApproval++;
      if (approvals?.director?.decision === "pending" && p.requiresDirectorApproval) projectMetrics.pendingDirectorApproval++;
    }

    // Grant metrics
    const grantMetrics = {
      total: grants.length,
      byStage: {} as Record<string, number>,
      totalAwardedYtd: 0,
      totalPotentialInFlight: 0,
      upcomingDeadlines: [] as Array<Record<string, unknown>>,
      overdueCompliance: [] as Array<Record<string, unknown>>,
    };
    const inFlightStages = ["scoping", "drafting", "internal_review", "submitted", "under_review", "interview_stage"];
    for (const g of grants) {
      const stage = String(g.stage || "monitoring");
      grantMetrics.byStage[stage] = (grantMetrics.byStage[stage] || 0) + 1;

      if ((stage === "approved" || stage === "acquitted") && g.decisionReceivedAt) {
        const decided = typeof g.decisionReceivedAt === "string" ? new Date(g.decisionReceivedAt) : null;
        if (decided && decided.getFullYear() === currentYear && typeof g.awardedAmount === "number") {
          grantMetrics.totalAwardedYtd += g.awardedAmount;
        }
      }

      if (inFlightStages.includes(stage) && typeof g.awardValue === "number") {
        grantMetrics.totalPotentialInFlight += g.awardValue;
      }

      if (typeof g.submissionDeadline === "string" && g.submissionDeadline >= today && g.submissionDeadline <= thirtyDaysOut) {
        grantMetrics.upcomingDeadlines.push({
          grantId: g.id,
          grantNumber: g.grantNumber,
          programmeName: g.programmeName,
          submissionDeadline: g.submissionDeadline,
          stage,
        });
      }

      const compliance = g.compliance as { reportsRequired?: Array<Record<string, unknown>>; milestonesRequired?: Array<Record<string, unknown>> } | undefined;
      if (compliance) {
        for (const r of compliance.reportsRequired || []) {
          if (r.status === "pending" && typeof r.dueDate === "string" && r.dueDate < today) {
            grantMetrics.overdueCompliance.push({
              grantId: g.id,
              grantNumber: g.grantNumber,
              type: "report",
              item: r.reportType,
              dueDate: r.dueDate,
            });
          }
        }
        for (const m of compliance.milestonesRequired || []) {
          if (m.status === "pending" && typeof m.dueDate === "string" && m.dueDate < today) {
            grantMetrics.overdueCompliance.push({
              grantId: g.id,
              grantNumber: g.grantNumber,
              type: "milestone",
              item: m.milestone,
              dueDate: m.dueDate,
            });
          }
        }
      }
    }
    grantMetrics.upcomingDeadlines.sort((a, b) =>
      String(a.submissionDeadline).localeCompare(String(b.submissionDeadline))
    );

    // Opportunity metrics
    const opportunityMetrics = {
      total: opportunities.length,
      byStatus: {} as Record<string, number>,
      byType: {} as Record<string, number>,
      awaitingReview: 0,
      readyForRevisit: 0,
    };
    for (const o of opportunities) {
      const status = String(o.status || "new");
      const type = String(o.type || "other");
      opportunityMetrics.byStatus[status] = (opportunityMetrics.byStatus[status] || 0) + 1;
      opportunityMetrics.byType[type] = (opportunityMetrics.byType[type] || 0) + 1;
      if (status === "new" || status === "under_review") opportunityMetrics.awaitingReview++;
      if (status === "parked" && typeof o.parkedUntil === "string" && o.parkedUntil <= today) {
        opportunityMetrics.readyForRevisit++;
      }
    }

    // Nomination metrics
    const nominationMetrics = {
      total: nominations.length,
      byStatus: {} as Record<string, number>,
      submittedAwaitingPreFeas: 0,
      prefeasCompleteAwaitingApproval: 0,
    };
    for (const n of nominations) {
      const status = String(n.status || "submitted");
      nominationMetrics.byStatus[status] = (nominationMetrics.byStatus[status] || 0) + 1;
      if (status === "submitted") nominationMetrics.submittedAwaitingPreFeas++;
      if (status === "prefeas_complete") nominationMetrics.prefeasCompleteAwaitingApproval++;
    }

    return NextResponse.json({
      projects,
      grants,
      opportunities,
      programmes,
      nominations,
      metrics: {
        projects: projectMetrics,
        grants: grantMetrics,
        opportunities: opportunityMetrics,
        nominations: nominationMetrics,
      },
      generatedAt: now.toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch R&D data." },
      { status: 400 }
    );
  }
}
