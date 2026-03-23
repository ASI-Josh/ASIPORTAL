/**
 * ASI Portal MCP Server
 *
 * Implements the Model Context Protocol (JSON-RPC 2.0 over HTTP POST).
 * Auth: Bearer token matching MCP_SECRET env var.
 *
 * Connect from Claude Desktop via claude_desktop_config.json:
 *   "mcpServers": {
 *     "asi-portal": {
 *       "command": "npx",
 *       "args": ["-y", "@modelcontextprotocol/server-fetch", "https://asiportal.live/api/mcp"],
 *       "env": { "MCP_BEARER_TOKEN": "<your MCP_SECRET>" }
 *     }
 *   }
 *
 * Connect from Claude.ai Projects: add https://asiportal.live/api/mcp as Remote MCP Server URL.
 */

import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";

// ─── Types ───────────────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.MCP_SECRET;
  if (!secret) return false;
  // Bearer token
  const auth = req.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ") && auth.slice(7) === secret) return true;
  // Custom header
  if (req.headers.get("x-mcp-secret") === secret) return true;
  // Query param (for Claude Desktop url mode)
  const token = new URL(req.url).searchParams.get("token");
  if (token === secret) return true;
  return false;
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS: McpTool[] = [
  {
    name: "get_jobs",
    description:
      "List jobs from the ASI Portal. Optionally filter by status or limit the number of results.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["pending", "scheduled", "in_progress", "completed", "closed", "cancelled"],
          description: "Filter by job status.",
        },
        limit: {
          type: "number",
          description: "Maximum number of jobs to return (default 20, max 100).",
        },
        clientName: {
          type: "string",
          description: "Filter jobs where client name contains this string (case-insensitive partial match).",
        },
      },
    },
  },
  {
    name: "get_job",
    description: "Get full details of a single job by its Firestore document ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The job document ID." },
      },
      required: ["id"],
    },
  },
  {
    name: "get_bookings",
    description: "List bookings from the ASI Portal. Optionally filter by status or limit results.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["pending", "confirmed", "completed", "cancelled"],
          description: "Filter by booking status.",
        },
        limit: {
          type: "number",
          description: "Maximum number of bookings to return (default 20, max 100).",
        },
      },
    },
  },
  {
    name: "get_inspections",
    description: "List vehicle inspections from the ASI Portal.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of inspections to return (default 20, max 100).",
        },
        organisationName: {
          type: "string",
          description: "Filter inspections by organisation name (partial match).",
        },
      },
    },
  },
  {
    name: "get_ims_documents",
    description:
      "List IMS (Integrated Management System) documents. Optionally filter by type or status.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "Filter by document type (e.g. 'procedure', 'register', 'form', 'policy').",
        },
        status: {
          type: "string",
          enum: ["draft", "active", "archived", "under_review"],
          description: "Filter by document status.",
        },
        limit: {
          type: "number",
          description: "Maximum number of documents to return (default 20, max 100).",
        },
      },
    },
  },
  {
    name: "get_ims_document",
    description: "Get full content of a single IMS document by its Firestore document ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The IMS document ID." },
      },
      required: ["id"],
    },
  },
  {
    name: "get_ims_incidents",
    description: "List IMS incidents. Optionally filter by status.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: "Filter by incident status (e.g. 'open', 'closed', 'under_review').",
        },
        limit: {
          type: "number",
          description: "Maximum number of incidents to return (default 20, max 100).",
        },
      },
    },
  },
  {
    name: "get_works_register",
    description: "List entries from the works register.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of entries to return (default 20, max 100).",
        },
      },
    },
  },
  {
    name: "get_dashboard_metrics",
    description:
      "Get a high-level summary of operational metrics: total jobs by status, recent bookings count, open IMS incidents, and active inspections.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "create_ims_document_draft",
    description:
      "Create a new IMS document draft in Firestore. Returns the new document ID.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Document title." },
        docId: { type: "string", description: "Document reference code (e.g. IMS-PROC-042)." },
        type: {
          type: "string",
          description: "Document type: procedure, policy, register, form, work_instruction, etc.",
        },
        content: { type: "string", description: "Full document content (markdown or plain text)." },
        processOwner: { type: "string", description: "Name or role of the process owner." },
        isoClauses: {
          type: "array",
          items: { type: "string" },
          description: "ISO 9001 clauses this document addresses (e.g. ['4.2', '7.5']).",
        },
      },
      required: ["title", "type", "content"],
    },
  },
  {
    name: "update_ims_document",
    description:
      "Update fields on an existing IMS document (e.g. change status, update content). Returns the updated document.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The IMS document Firestore ID to update." },
        updates: {
          type: "object",
          description:
            "Key-value pairs of fields to update. Allowed fields: title, content, status, processOwner, isoClauses, type.",
        },
      },
      required: ["id", "updates"],
    },
  },

  // ─── Sales pipeline tools ─────────────────────────────────────────────────
  {
    name: "get_leads",
    description: "List CRM leads from the sales pipeline. Filter by stage, grade, or sector.",
    inputSchema: {
      type: "object",
      properties: {
        stage: {
          type: "string",
          enum: ["identified","researched","contacted","engaged","qualified","proposal_sent","negotiation","won","lost","nurture"],
          description: "Filter by pipeline stage.",
        },
        grade: { type: "string", enum: ["A","B","C","D","E"], description: "Filter by lead grade." },
        sector: { type: "string", description: "Filter by sector (e.g. mass-transit, manufacturing)." },
        limit: { type: "number", description: "Max leads to return (default 50, max 200)." },
      },
    },
  },
  {
    name: "get_pipeline_stats",
    description: "Get sales pipeline summary: total leads, hot leads count, overdue follow-ups, estimated pipeline value, breakdown by stage and grade.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_lead",
    description: "Create a new CRM lead — typically from an OSINT finding. Accepts the standard OSINT-to-CRM workflow JSON structure.",
    inputSchema: {
      type: "object",
      properties: {
        company: { type: "string", description: "Company name." },
        sector: { type: "string", description: "Sector: mass-transit, manufacturing, wholesale-trade, structural, marine, other." },
        companyWebsite: { type: "string" },
        existingOrganizationId: { type: "string", description: "Link to existing org in portal if already a client." },
        isExistingClient: { type: "boolean", description: "True if already an ASI client (upsell lead)." },
        contact: {
          type: "object",
          description: "Primary contact.",
          properties: {
            name: { type: "string" }, title: { type: "string" },
            email: { type: "string" }, phone: { type: "string" }, linkedin: { type: "string" },
          },
        },
        pipeline_stage: { type: "number", description: "Stage number 1-10 (default 1 = identified)." },
        bant_score: { type: "number", description: "BANT-Plus score 0-100." },
        bant_breakdown: {
          type: "object",
          description: "Individual BANT scores: budget (0-20), authority (0-20), need (0-25), timing (0-20), fit (0-15).",
          properties: {
            budget: { type: "number" }, authority: { type: "number" },
            need: { type: "number" }, timing: { type: "number" }, fit: { type: "number" },
          },
        },
        source: {
          type: "object",
          description: "Lead source — include OSINT scan details.",
          properties: {
            osint_scan_date: { type: "string" }, finding: { type: "string" },
            pillar: { type: "string" }, relevance_score: { type: "number" },
          },
        },
        pain_points: { type: "array", items: { type: "string" } },
        asi_solution_fit: { type: "array", items: { type: "string" } },
        estimated_services: { type: "array", items: { type: "string" } },
        estimated_value: { type: "number", description: "Estimated deal value in AUD." },
        recommended_sequence: { type: "string", enum: ["A","B","C"], description: "Outreach sequence: A=Consultative, B=Direct, C=Partnership." },
        next_action: { type: "string" },
        follow_up_date: { type: "string", description: "ISO date for next follow-up." },
        notes: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        market_mode: { type: "string", enum: ["growth","downturn","neutral"] },
      },
      required: ["company"],
    },
  },
  {
    name: "update_lead_stage",
    description: "Move a lead to a new pipeline stage. Tracks stage history automatically.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Lead Firestore document ID." },
        stage: {
          type: "string",
          enum: ["identified","researched","contacted","engaged","qualified","proposal_sent","negotiation","won","lost","nurture"],
          description: "New pipeline stage.",
        },
        reason: { type: "string", description: "Optional reason for the stage change." },
      },
      required: ["id", "stage"],
    },
  },
  {
    name: "log_outreach_event",
    description: "Log an outreach event against a lead (LinkedIn message, email, phone call, meeting, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Lead Firestore document ID." },
        type: {
          type: "string",
          enum: ["linkedin_connect","linkedin_message","email","phone","meeting","proposal","follow_up"],
          description: "Type of outreach.",
        },
        date: { type: "string", description: "Date of outreach (ISO format, e.g. 2026-03-23)." },
        subject: { type: "string", description: "Subject line or topic." },
        summary: { type: "string", description: "What was sent/discussed." },
        response: { type: "string", description: "Their response (if any)." },
        nextStep: { type: "string", description: "The agreed or planned next step." },
      },
      required: ["id", "type", "date", "summary"],
    },
  },
  {
    name: "enrich_pipeline_from_osint",
    description: "Cross-reference OSINT findings against existing CRM leads. Identifies leads that have new intelligence, recommends stage changes, and flags urgent reactivations.",
    inputSchema: {
      type: "object",
      properties: {
        osintScanDate: { type: "string", description: "Date of the OSINT scan (e.g. 2026-03-23)." },
        findings: {
          type: "array",
          description: "OSINT findings to cross-reference.",
          items: {
            type: "object",
            properties: {
              headline: { type: "string" },
              companyMentions: { type: "array", items: { type: "string" }, description: "Company names mentioned in or implied by the finding." },
              relevance: { type: "number" },
              tags: { type: "array", items: { type: "string" } },
              pillar: { type: "string" },
            },
            required: ["headline", "companyMentions", "relevance"],
          },
        },
      },
      required: ["osintScanDate", "findings"],
    },
  },
  {
    name: "import_leads_from_osint",
    description: "Bulk-import leads from an OSINT scan into the CRM pipeline. Accepts the workflow JSON format. Skips duplicates, updates existing leads with new intelligence.",
    inputSchema: {
      type: "object",
      properties: {
        osintScanDate: { type: "string", description: "Date of the scan (e.g. 2026-03-23)." },
        leads: {
          type: "array",
          description: "Array of lead objects in OSINT-to-CRM workflow format.",
          items: { type: "object" },
        },
      },
      required: ["osintScanDate", "leads"],
    },
  },
];

// ─── Firestore helpers ────────────────────────────────────────────────────────

function safeLimit(raw: unknown, def = 20, max = 100) {
  const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
  return Number.isFinite(n) ? Math.min(Math.max(1, n), max) : def;
}

function serializeDoc(id: string, data: FirebaseFirestore.DocumentData) {
  const out: Record<string, unknown> = { id };
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "toDate" in v && typeof v.toDate === "function") {
      out[k] = (v as { toDate: () => Date }).toDate().toISOString();
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ─── Tool handlers ────────────────────────────────────────────────────────────

async function handleGetJobs(args: Record<string, unknown>) {
  const db = admin.firestore();
  const limit = safeLimit(args.limit);
  let q: FirebaseFirestore.Query = db.collection(COLLECTIONS.JOBS).orderBy("createdAt", "desc").limit(limit);
  if (typeof args.status === "string") q = q.where("status", "==", args.status);
  const snap = await q.get();
  let docs = snap.docs.map((d) => serializeDoc(d.id, d.data()));
  if (typeof args.clientName === "string" && args.clientName) {
    const term = args.clientName.toLowerCase();
    docs = docs.filter((d) => {
      const cn = String(d.clientName || d.clientOrganisationName || "").toLowerCase();
      return cn.includes(term);
    });
  }
  return docs;
}

async function handleGetJob(args: Record<string, unknown>) {
  const id = String(args.id);
  const snap = await admin.firestore().collection(COLLECTIONS.JOBS).doc(id).get();
  if (!snap.exists) throw new Error(`Job '${id}' not found.`);
  return serializeDoc(snap.id, snap.data()!);
}

async function handleGetBookings(args: Record<string, unknown>) {
  const db = admin.firestore();
  const limit = safeLimit(args.limit);
  let q: FirebaseFirestore.Query = db.collection(COLLECTIONS.BOOKINGS).orderBy("createdAt", "desc").limit(limit);
  if (typeof args.status === "string") q = q.where("status", "==", args.status);
  const snap = await q.get();
  return snap.docs.map((d) => serializeDoc(d.id, d.data()));
}

async function handleGetInspections(args: Record<string, unknown>) {
  const db = admin.firestore();
  const limit = safeLimit(args.limit);
  const snap = await db.collection(COLLECTIONS.INSPECTIONS).orderBy("createdAt", "desc").limit(limit).get();
  let docs = snap.docs.map((d) => serializeDoc(d.id, d.data()));
  if (typeof args.organisationName === "string" && args.organisationName) {
    const term = args.organisationName.toLowerCase();
    docs = docs.filter((d) =>
      String(d.organisationName || d.organizationName || "").toLowerCase().includes(term)
    );
  }
  return docs;
}

async function handleGetImsDocuments(args: Record<string, unknown>) {
  const db = admin.firestore();
  const limit = safeLimit(args.limit);
  let q: FirebaseFirestore.Query = db.collection(COLLECTIONS.IMS_DOCUMENTS).orderBy("createdAt", "desc").limit(limit);
  if (typeof args.type === "string") q = q.where("type", "==", args.type);
  if (typeof args.status === "string") q = q.where("status", "==", args.status);
  const snap = await q.get();
  return snap.docs.map((d) => serializeDoc(d.id, d.data()));
}

async function handleGetImsDocument(args: Record<string, unknown>) {
  const id = String(args.id);
  const snap = await admin.firestore().collection(COLLECTIONS.IMS_DOCUMENTS).doc(id).get();
  if (!snap.exists) throw new Error(`IMS document '${id}' not found.`);
  return serializeDoc(snap.id, snap.data()!);
}

async function handleGetImsIncidents(args: Record<string, unknown>) {
  const db = admin.firestore();
  const limit = safeLimit(args.limit);
  let q: FirebaseFirestore.Query = db.collection(COLLECTIONS.IMS_INCIDENTS).orderBy("createdAt", "desc").limit(limit);
  if (typeof args.status === "string") q = q.where("status", "==", args.status);
  const snap = await q.get();
  return snap.docs.map((d) => serializeDoc(d.id, d.data()));
}

async function handleGetWorksRegister(args: Record<string, unknown>) {
  const db = admin.firestore();
  const limit = safeLimit(args.limit);
  const snap = await db.collection(COLLECTIONS.WORKS_REGISTER).orderBy("createdAt", "desc").limit(limit).get();
  return snap.docs.map((d) => serializeDoc(d.id, d.data()));
}

async function handleGetDashboardMetrics() {
  const db = admin.firestore();
  const [jobsSnap, bookingsSnap, incidentsSnap, inspectionsSnap] = await Promise.all([
    db.collection(COLLECTIONS.JOBS).get(),
    db.collection(COLLECTIONS.BOOKINGS).where("status", "==", "pending").limit(50).get(),
    db.collection(COLLECTIONS.IMS_INCIDENTS).where("status", "==", "open").limit(50).get(),
    db.collection(COLLECTIONS.INSPECTIONS).limit(50).get(),
  ]);

  const jobsByStatus: Record<string, number> = {};
  jobsSnap.docs.forEach((d) => {
    const s = String(d.data().status || "unknown");
    jobsByStatus[s] = (jobsByStatus[s] || 0) + 1;
  });

  return {
    totalJobs: jobsSnap.size,
    jobsByStatus,
    pendingBookings: bookingsSnap.size,
    openIncidents: incidentsSnap.size,
    totalInspections: inspectionsSnap.size,
    generatedAt: new Date().toISOString(),
  };
}

async function handleCreateImsDocumentDraft(args: Record<string, unknown>) {
  const now = admin.firestore.FieldValue.serverTimestamp();
  const payload: Record<string, unknown> = {
    title: String(args.title || ""),
    docId: args.docId ? String(args.docId) : null,
    type: String(args.type || "procedure"),
    status: "draft",
    content: String(args.content || ""),
    processOwner: args.processOwner ? String(args.processOwner) : null,
    isoClauses: Array.isArray(args.isoClauses) ? args.isoClauses : [],
    revision: 0,
    createdByAgent: true,
    createdAt: now,
    updatedAt: now,
  };
  const ref = await admin.firestore().collection(COLLECTIONS.IMS_DOCUMENTS).add(payload);
  return { id: ref.id, status: "draft", title: payload.title };
}

const ALLOWED_UPDATE_FIELDS = new Set([
  "title", "content", "status", "processOwner", "isoClauses", "type",
]);

async function handleUpdateImsDocument(args: Record<string, unknown>) {
  const id = String(args.id);
  const updates = (args.updates || {}) as Record<string, unknown>;
  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (ALLOWED_UPDATE_FIELDS.has(k)) filtered[k] = v;
  }
  if (Object.keys(filtered).length === 0) throw new Error("No valid fields to update.");
  filtered.updatedAt = admin.firestore.FieldValue.serverTimestamp();
  await admin.firestore().collection(COLLECTIONS.IMS_DOCUMENTS).doc(id).set(filtered, { merge: true });
  const updated = await admin.firestore().collection(COLLECTIONS.IMS_DOCUMENTS).doc(id).get();
  if (!updated.exists) throw new Error(`IMS document '${id}' not found.`);
  return serializeDoc(updated.id, updated.data()!);
}

// ─── Lead tool handlers ───────────────────────────────────────────────────────

function calcLeadGrade(s: number): string {
  if (s >= 80) return "A";
  if (s >= 65) return "B";
  if (s >= 50) return "C";
  if (s >= 35) return "D";
  return "E";
}

async function nextMcpLeadNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const db = admin.firestore();
  const counterRef = db.collection("counters").doc("leads");
  let num = 1;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const data = snap.data() as { seq?: number; year?: number } | undefined;
    if (!snap.exists || data?.year !== year) {
      tx.set(counterRef, { seq: 1, year });
      num = 1;
    } else {
      num = (data?.seq || 0) + 1;
      tx.update(counterRef, { seq: num });
    }
  });
  return `LD-${year}-${String(num).padStart(4, "0")}`;
}

async function handleGetLeads(args: Record<string, unknown>) {
  const db = admin.firestore();
  const limit = safeLimit(args.limit, 50, 200);
  const snap = await db.collection(COLLECTIONS.LEADS)
    .where("isDeleted", "!=", true)
    .orderBy("isDeleted")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  let leads = snap.docs.map((d) => serializeDoc(d.id, d.data()));
  if (typeof args.stage === "string") leads = leads.filter((l) => l.stage === args.stage);
  if (typeof args.grade === "string") leads = leads.filter((l) => l.leadGrade === args.grade);
  if (typeof args.sector === "string") {
    const s = args.sector.toLowerCase();
    leads = leads.filter((l) => String(l.sector || "").toLowerCase().includes(s));
  }
  return leads;
}

async function handleGetPipelineStats() {
  const db = admin.firestore();
  const snap = await db.collection(COLLECTIONS.LEADS).where("isDeleted", "!=", true).get();
  const byStage: Record<string, number> = {};
  const byGrade: Record<string, number> = {};
  let totalValue = 0;
  let overdueFollowUps = 0;
  const today = new Date().toISOString().split("T")[0];
  snap.docs.forEach((d) => {
    const l = d.data() as Record<string, unknown>;
    const stage = String(l.stage || "unknown");
    byStage[stage] = (byStage[stage] || 0) + 1;
    const grade = String(l.leadGrade || "E");
    byGrade[grade] = (byGrade[grade] || 0) + 1;
    totalValue += typeof l.estimatedValue === "number" ? l.estimatedValue : 0;
    if (typeof l.nextActionDate === "string" && l.nextActionDate < today && stage !== "won" && stage !== "lost") {
      overdueFollowUps += 1;
    }
  });
  return {
    total: snap.size,
    totalActive: snap.docs.filter((d) => !["won","lost"].includes(String(d.data().stage))).length,
    hotLeads: (byGrade["A"] || 0) + (byGrade["B"] || 0),
    overdueFollowUps,
    totalEstimatedValue: totalValue,
    byStage,
    byGrade,
  };
}

async function handleCreateLead(args: Record<string, unknown>) {
  if (!args.company) throw new Error("company is required.");
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const leadNumber = await nextMcpLeadNumber();

  const stageMap: Record<number, string> = {
    1: "identified", 2: "researched", 3: "contacted", 4: "engaged",
    5: "qualified", 6: "proposal_sent", 7: "negotiation", 8: "won", 9: "lost", 10: "nurture",
  };
  const stageNum = typeof args.pipeline_stage === "number" ? args.pipeline_stage : 1;
  const stage = stageMap[stageNum] || "identified";

  const bd = (args.bant_breakdown || {}) as Record<string, number>;
  const bantBreakdown = {
    budget: bd.budget || 0, authority: bd.authority || 0,
    need: bd.need || 0, timing: bd.timing || 0, fit: bd.fit || 0,
  };
  const bantScore = typeof args.bant_score === "number" ? args.bant_score :
    Object.values(bantBreakdown).reduce((a, b) => a + b, 0);
  const leadGrade = calcLeadGrade(bantScore);

  const contactRaw = (args.contact || {}) as Record<string, string>;
  const contacts = contactRaw.name ? [{
    id: crypto.randomUUID(), name: contactRaw.name, title: contactRaw.title,
    email: contactRaw.email, phone: contactRaw.phone,
    linkedInUrl: contactRaw.linkedin, isPrimary: true,
  }] : [];

  const sourceRaw = (args.source || {}) as Record<string, unknown>;
  const payload = {
    leadNumber,
    companyName: String(args.company),
    companyWebsite: args.companyWebsite as string | undefined,
    sector: String(args.sector || "other"),
    existingOrganizationId: args.existingOrganizationId as string | undefined,
    isExistingClient: Boolean(args.isExistingClient),
    contacts,
    bantScore,
    bantBreakdown,
    leadGrade,
    stage,
    stageHistory: [],
    stageEnteredAt: new Date().toISOString(),
    source: {
      type: "osint",
      osintScanDate: sourceRaw.osint_scan_date as string | undefined,
      osintFinding: sourceRaw.finding as string | undefined,
      osintPillar: sourceRaw.pillar as string | undefined,
      osintRelevanceScore: sourceRaw.relevance_score as number | undefined,
    },
    estimatedValue: args.estimated_value as number | undefined,
    estimatedServices: (args.estimated_services as string[]) || [],
    painPoints: (args.pain_points as string[]) || [],
    asiSolutionFit: (args.asi_solution_fit as string[]) || [],
    outreachSequence: (args.recommended_sequence as string | null) || null,
    outreachStatus: {
      linkedInConnected: false, linkedInMessageSent: false, emailsSent: 0,
      responseReceived: false, meetingScheduled: false,
    },
    outreachHistory: [],
    marketMode: String(args.market_mode || "growth"),
    nextAction: args.next_action as string | undefined,
    nextActionDate: args.follow_up_date as string | undefined,
    notes: String(args.notes || ""),
    tags: ((args.tags as string[]) || []).concat(["osint"]).filter((v, i, a) => a.indexOf(v) === i),
    createdAt: now,
    updatedAt: now,
    createdBy: "mcp-agent",
    isDeleted: false,
  };

  const ref = await db.collection(COLLECTIONS.LEADS).add(payload);
  return { id: ref.id, leadNumber, stage, bantScore, leadGrade, companyName: payload.companyName };
}

async function handleUpdateLeadStage(args: Record<string, unknown>) {
  const id = String(args.id);
  const stage = String(args.stage);
  const db = admin.firestore();
  const ref = db.collection(COLLECTIONS.LEADS).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Lead '${id}' not found.`);
  const lead = snap.data() as Record<string, unknown>;
  const now = new Date().toISOString();
  const change = { fromStage: lead.stage, toStage: stage, changedAt: now, changedBy: "mcp-agent", reason: args.reason };
  await ref.set({
    stage, stageEnteredAt: now,
    stageHistory: admin.firestore.FieldValue.arrayUnion(change),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return { ok: true, leadId: id, stage };
}

async function handleLogOutreachEvent(args: Record<string, unknown>) {
  const id = String(args.id);
  const db = admin.firestore();
  const event = {
    id: crypto.randomUUID(),
    type: String(args.type),
    date: String(args.date),
    subject: args.subject as string | undefined,
    summary: String(args.summary),
    response: args.response as string | undefined,
    nextStep: args.nextStep as string | undefined,
    loggedBy: "mcp-agent",
  };
  const updates: Record<string, unknown> = {
    outreachHistory: admin.firestore.FieldValue.arrayUnion(event),
    "outreachStatus.lastContactDate": event.date,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (event.type === "linkedin_connect") updates["outreachStatus.linkedInConnected"] = true;
  if (event.type === "linkedin_message") updates["outreachStatus.linkedInMessageSent"] = true;
  if (event.type === "email") updates["outreachStatus.emailsSent"] = admin.firestore.FieldValue.increment(1);
  if (event.type === "meeting") updates["outreachStatus.meetingScheduled"] = true;
  if (event.response) {
    updates["outreachStatus.responseReceived"] = true;
    updates["outreachStatus.lastResponseDate"] = event.date;
  }
  await db.collection(COLLECTIONS.LEADS).doc(id).set(updates, { merge: true });
  return { ok: true, event };
}

async function handleEnrichPipelineFromOsint(args: Record<string, unknown>) {
  const findings = (args.findings as Array<{ headline: string; companyMentions: string[]; relevance: number; tags?: string[]; pillar?: string }>) || [];
  const scanDate = String(args.osintScanDate || "");
  const db = admin.firestore();
  const snap = await db.collection(COLLECTIONS.LEADS).where("isDeleted", "!=", true).limit(200).get();
  const leads = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Array<Record<string, unknown>>;
  const now = admin.firestore.FieldValue.serverTimestamp();

  function normalise(s: string) { return s.toLowerCase().replace(/[^a-z0-9]/g, ""); }
  function matches(leadName: string, mention: string) {
    const ln = normalise(leadName); const mn = normalise(mention);
    if (ln === mn || ln.includes(mn) || mn.includes(ln)) return true;
    const strip = (s: string) => s.replace(/ptyltd|pty|ltd|limited|group|holdings|australia|aust/g,"").trim();
    return strip(ln) === strip(mn) && strip(ln).length > 3;
  }

  const matched = [];
  for (const finding of findings) {
    for (const mention of (finding.companyMentions || [])) {
      const lead = leads.find((l) => matches(String(l.companyName || ""), mention));
      if (!lead) continue;
      const isUrgent = (finding.tags || []).includes("high-urgency");
      const intel = `[OSINT ${scanDate}] ${finding.headline} (relevance: ${finding.relevance}/5)`;
      const notes = String(lead.notes || "");
      await db.collection(COLLECTIONS.LEADS).doc(String(lead.id)).set({
        notes: notes ? `${notes}\n\n${intel}` : intel,
        updatedAt: now,
      }, { merge: true });
      let recommendedAction;
      let stageChangeRecommended = false;
      if (lead.stage === "nurture" && finding.relevance >= 4) {
        recommendedAction = "Reactivate — new high-relevance signal warrants re-engagement";
        stageChangeRecommended = true;
      } else if (isUrgent) {
        recommendedAction = "High-urgency signal — ensure follow-up is scheduled immediately";
        if (lead.stage === "identified") stageChangeRecommended = true;
      } else if (finding.relevance >= 4) {
        recommendedAction = "Review and update outreach context with new intelligence";
      }
      matched.push({ leadId: lead.id, leadNumber: lead.leadNumber, companyName: lead.companyName,
        currentStage: lead.stage, currentGrade: lead.leadGrade, newIntelligence: finding.headline,
        relevance: finding.relevance, urgencyFlag: isUrgent, recommendedAction, stageChangeRecommended });
    }
  }
  return { matchedLeads: matched, total: matched.length,
    urgentCount: matched.filter((m) => m.urgencyFlag).length,
    reactivationCount: matched.filter((m) => m.stageChangeRecommended).length };
}

async function handleImportLeadsFromOsint(args: Record<string, unknown>) {
  // Delegate to the import API logic inline for MCP
  const leads = (args.leads as unknown[]) || [];
  const scanDate = String(args.osintScanDate || "");
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const year = new Date().getFullYear();
  let created = 0, updated = 0, skipped = 0;
  const results = [];

  for (const item of leads as Array<Record<string, unknown>>) {
    const company = String(item.company || "").trim();
    if (!company) { skipped++; continue; }
    const existing = await db.collection(COLLECTIONS.LEADS)
      .where("companyName", "==", company).where("isDeleted", "!=", true).limit(1).get();
    const bd = (item.bant_breakdown || {}) as Record<string, number>;
    const bantBreakdown = { budget: bd.budget||0, authority: bd.authority||0, need: bd.need||0, timing: bd.timing||0, fit: bd.fit||0 };
    const bantScore = typeof item.bant_score === "number" ? item.bant_score : Object.values(bantBreakdown).reduce((a,b)=>a+b,0);
    const leadGrade = calcLeadGrade(bantScore);
    const stageMap: Record<number,string> = {1:"identified",2:"researched",3:"contacted",4:"engaged",5:"qualified",6:"proposal_sent",7:"negotiation",8:"won",9:"lost",10:"nurture"};
    const stage = (item.stage as string) || stageMap[typeof item.pipeline_stage === "number" ? item.pipeline_stage : 1] || "identified";
    if (!existing.empty) {
      const ed = existing.docs[0];
      await ed.ref.set({ bantScore: Math.max((ed.data().bantScore||0), bantScore), leadGrade: calcLeadGrade(Math.max((ed.data().bantScore||0),bantScore)), updatedAt: now,
        notes: ed.data().notes ? `${ed.data().notes}\n\n[OSINT ${scanDate}] ${item.notes||""}` : (item.notes||"") }, { merge: true });
      updated++;
      results.push({ id: ed.id, companyName: company, action: "updated" });
    } else {
      const leadNumber = await nextMcpLeadNumber();
      const contactRaw = (item.contact||{}) as Record<string,string>;
      const contacts = contactRaw.name ? [{ id: crypto.randomUUID(), name: contactRaw.name, title: contactRaw.title, email: contactRaw.email, phone: contactRaw.phone, linkedInUrl: contactRaw.linkedin, isPrimary: true }] : [];
      const sourceRaw = (item.source||{}) as Record<string,unknown>;
      const ref = await db.collection(COLLECTIONS.LEADS).add({
        leadNumber, companyName: company, sector: String(item.sector||"other"),
        existingOrganizationId: item.existingOrganizationId, isExistingClient: Boolean(item.isExistingClient),
        contacts, bantScore, bantBreakdown, leadGrade, stage, stageHistory: [], stageEnteredAt: new Date().toISOString(),
        source: { type:"osint", osintScanDate: sourceRaw.osint_scan_date||scanDate, osintFinding: sourceRaw.finding, osintPillar: sourceRaw.pillar, osintRelevanceScore: sourceRaw.relevance_score },
        estimatedValue: item.estimated_value, estimatedServices: item.estimated_services||[], painPoints: item.pain_points||[], asiSolutionFit: item.asi_solution_fit||[],
        outreachSequence: item.recommended_sequence||null, outreachStatus: { linkedInConnected:false, linkedInMessageSent:false, emailsSent:0, responseReceived:false, meetingScheduled:false },
        outreachHistory: [], marketMode: String(item.market_mode||"growth"), nextAction: item.next_action, nextActionDate: item.follow_up_date,
        notes: String(item.notes||""), tags: ((item.tags as string[])||[]).concat(["osint"]).filter((v,i,a)=>a.indexOf(v)===i),
        createdAt: now, updatedAt: now, createdBy:"mcp-agent", isDeleted:false,
      });
      created++;
      results.push({ id: ref.id, leadNumber, companyName: company, action: "created" });
    }
  }
  return { created, updated, skipped, leads: results };
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "get_jobs":             return handleGetJobs(args);
    case "get_job":              return handleGetJob(args);
    case "get_bookings":         return handleGetBookings(args);
    case "get_inspections":      return handleGetInspections(args);
    case "get_ims_documents":    return handleGetImsDocuments(args);
    case "get_ims_document":     return handleGetImsDocument(args);
    case "get_ims_incidents":    return handleGetImsIncidents(args);
    case "get_works_register":   return handleGetWorksRegister(args);
    case "get_dashboard_metrics": return handleGetDashboardMetrics();
    case "create_ims_document_draft": return handleCreateImsDocumentDraft(args);
    case "update_ims_document":  return handleUpdateImsDocument(args);
    // Sales pipeline
    case "get_leads":            return handleGetLeads(args);
    case "get_pipeline_stats":   return handleGetPipelineStats();
    case "create_lead":          return handleCreateLead(args);
    case "update_lead_stage":    return handleUpdateLeadStage(args);
    case "log_outreach_event":   return handleLogOutreachEvent(args);
    case "enrich_pipeline_from_osint": return handleEnrichPipelineFromOsint(args);
    case "import_leads_from_osint": return handleImportLeadsFromOsint(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── JSON-RPC helpers ─────────────────────────────────────────────────────────

function rpcOk(id: JsonRpcRequest["id"], result: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id, result });
}

function rpcError(id: JsonRpcRequest["id"], code: number, message: string) {
  return NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } });
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  let body: JsonRpcRequest;
  try {
    body = (await req.json()) as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, "Parse error");
  }

  const { id, method, params = {} } = body;

  try {
    switch (method) {
      case "initialize":
        return rpcOk(id, {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "asi-portal", version: "1.0.0" },
        });

      case "tools/list":
        return rpcOk(id, { tools: TOOLS });

      case "tools/call": {
        const toolName = String((params as { name?: unknown }).name || "");
        const toolArgs = ((params as { arguments?: unknown }).arguments || {}) as Record<string, unknown>;
        const result = await callTool(toolName, toolArgs);
        return rpcOk(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        });
      }

      case "ping":
        return rpcOk(id, {});

      default:
        return rpcError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return rpcError(id, -32603, message);
  }
}

// SSE transport — required by mcp-remote (Claude Desktop proxy)
// Sends an endpoint event pointing to this same URL for POST, then keeps alive.
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return new Response("Unauthorised.", { status: 401 });
  }

  const url = new URL(req.url);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Tell the client to POST messages to this same endpoint
      controller.enqueue(
        encoder.encode(`event: endpoint\ndata: ${url.pathname}\n\n`)
      );
      // Keep-alive comments so the connection doesn't time out immediately
      const timer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keep-alive\n\n`));
        } catch {
          clearInterval(timer);
        }
      }, 15000);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
