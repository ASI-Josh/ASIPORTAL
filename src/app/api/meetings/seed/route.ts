import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";

export async function POST(req: NextRequest) {
  const fdb = admin.firestore();

  // Check if already seeded
  const existing = await fdb.collection(COLLECTIONS.MEETING_TEMPLATES).limit(1).get();
  if (!existing.empty) {
    return NextResponse.json({ message: "Already seeded" }, { status: 200 });
  }

  const now = admin.firestore.Timestamp.now();
  const batch = fdb.batch();

  // ─── Template 1: Management Review (ISO 9001 Clause 9.3) ────────────
  const t1Ref = fdb.collection(COLLECTIONS.MEETING_TEMPLATES).doc();
  batch.set(t1Ref, {
    name: "Management Review (ISO 9001)",
    meetingType: "management_review",
    defaultDuration: 120,
    isoClause: "9.3",
    agendaTemplate: [
      { id: "item-1", order: 1, title: "Status of Actions from Previous Reviews", type: "action_review", status: "pending" },
      { id: "item-2", order: 2, title: "Changes in External/Internal Issues (VANGUARD)", type: "agent_report", agentDepartment: "VANGUARD", status: "pending" },
      { id: "item-3", order: 3, title: "Customer Satisfaction (SENTINEL)", type: "agent_report", agentDepartment: "SENTINEL", status: "pending" },
      { id: "item-4", order: 4, title: "Quality Objectives & Product Conformity (GUARDIAN)", type: "agent_report", agentDepartment: "GUARDIAN", status: "pending" },
      { id: "item-5", order: 5, title: "Process Performance (ATHENA)", type: "agent_report", agentDepartment: "ATHENA", status: "pending" },
      { id: "item-6", order: 6, title: "Nonconformities & Corrective Actions", type: "information", status: "pending" },
      { id: "item-7", order: 7, title: "Audit Results", type: "information", status: "pending" },
      { id: "item-8", order: 8, title: "External Provider Performance", type: "information", status: "pending" },
      { id: "item-9", order: 9, title: "Adequacy of Resources (LEDGER)", type: "agent_report", agentDepartment: "LEDGER", status: "pending" },
      { id: "item-10", order: 10, title: "Risk & Opportunity Actions", type: "discussion", status: "pending" },
      { id: "item-11", order: 11, title: "Opportunities for Improvement (CIPHER)", type: "agent_report", agentDepartment: "CIPHER", status: "pending" },
      { id: "item-12", order: 12, title: "General Discussion", type: "discussion", status: "pending" },
    ],
    createdAt: now,
    createdBy: "system",
    updatedAt: now,
  });

  // ─── Template 2: Startup Meeting ────────────────────────────────────
  const t2Ref = fdb.collection(COLLECTIONS.MEETING_TEMPLATES).doc();
  batch.set(t2Ref, {
    name: "Startup Meeting",
    meetingType: "startup",
    defaultDuration: 30,
    agendaTemplate: [
      { id: "item-1", order: 1, title: "Safety Brief", type: "information", status: "pending" },
      { id: "item-2", order: 2, title: "Previous Actions", type: "action_review", status: "pending" },
      { id: "item-3", order: 3, title: "Daily Priorities", type: "discussion", status: "pending" },
      { id: "item-4", order: 4, title: "Resource Allocation", type: "discussion", status: "pending" },
    ],
    createdAt: now,
    createdBy: "system",
    updatedAt: now,
  });

  // ─── Template 3: WHS Committee ──────────────────────────────────────
  const t3Ref = fdb.collection(COLLECTIONS.MEETING_TEMPLATES).doc();
  batch.set(t3Ref, {
    name: "WHS Committee",
    meetingType: "whs_committee",
    defaultDuration: 60,
    agendaTemplate: [
      { id: "item-1", order: 1, title: "Incident Review", type: "information", status: "pending" },
      { id: "item-2", order: 2, title: "Hazard Reports", type: "discussion", status: "pending" },
      { id: "item-3", order: 3, title: "Corrective Action Status", type: "action_review", status: "pending" },
      { id: "item-4", order: 4, title: "Training Updates", type: "information", status: "pending" },
    ],
    createdAt: now,
    createdBy: "system",
    updatedAt: now,
  });

  // ─── Template 4: Department Meeting ─────────────────────────────────
  const t4Ref = fdb.collection(COLLECTIONS.MEETING_TEMPLATES).doc();
  batch.set(t4Ref, {
    name: "Department Meeting",
    meetingType: "department",
    defaultDuration: 45,
    agendaTemplate: [
      { id: "item-1", order: 1, title: "Department Report", type: "agent_report", status: "pending" },
      { id: "item-2", order: 2, title: "Open Actions", type: "action_review", status: "pending" },
      { id: "item-3", order: 3, title: "Discussion", type: "discussion", status: "pending" },
      { id: "item-4", order: 4, title: "New Business", type: "discussion", status: "pending" },
    ],
    createdAt: now,
    createdBy: "system",
    updatedAt: now,
  });

  // ─── First Meeting: MTG-2026-001 ───────────────────────────────────
  const m1Ref = fdb.collection(COLLECTIONS.MEETINGS).doc();
  // 30 March 2026 07:00 AEDT = 29 March 2026 20:00 UTC
  const scheduledDate = admin.firestore.Timestamp.fromDate(new Date("2026-03-29T20:00:00Z"));
  batch.set(m1Ref, {
    meetingNumber: "MTG-2026-001",
    title: "ASI Startup Meeting — Dineen/McKenzie's Proposal Review",
    meetingType: "startup",
    status: "scheduled",
    scheduledDate,
    scheduledDuration: 30,
    location: "",
    chair: { id: "josh", name: "Josh Hyde", email: "josh@asi-australia.com.au" },
    attendees: [
      { id: "josh", name: "Josh Hyde", email: "josh@asi-australia.com.au", role: "chair", attended: false },
      { id: "bobby", name: "Bobby", role: "attendee", attended: false },
      { id: "jaydan", name: "Jaydan", role: "attendee", attended: false },
      { id: "athena", name: "ATHENA", role: "agent", attended: false, department: "ATHENA" },
    ],
    agendaItems: [
      { id: "item-1", order: 1, title: "Safety Brief", type: "information", status: "pending" },
      { id: "item-2", order: 2, title: "Previous Actions", type: "action_review", status: "pending" },
      { id: "item-3", order: 3, title: "Dineen/McKenzie's Proposal Review", type: "discussion", status: "pending" },
      { id: "item-4", order: 4, title: "Daily Priorities", type: "discussion", status: "pending" },
    ],
    agentReports: [
      { department: "ATHENA", reportId: "startup-briefing-001", reportType: "executive", summary: "Startup meeting briefing", attachedAt: now },
    ],
    decisions: [],
    summary: "",
    createdAt: now,
    createdBy: "system",
    createdByName: "ATHENA",
    updatedAt: now,
  });

  await batch.commit();

  return NextResponse.json({ message: "Seeded 4 templates and MTG-2026-001", templateIds: [t1Ref.id, t2Ref.id, t3Ref.id, t4Ref.id], meetingId: m1Ref.id });
}
