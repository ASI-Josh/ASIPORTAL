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
import {
  xeroCreateInvoice, xeroSendInvoice, xeroGetInvoice,
  xeroListContacts, xeroListInvoices, xeroGetConnectionStatus,
  xeroAttachFileToInvoice,
} from "@/lib/xero";

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
    name: "update_job",
    description:
      "Update a job's fields — use this to close out jobs with invoice details, change status, or update notes. Agents use this to complete the invoicing loop.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The job Firestore document ID." },
        updates: {
          type: "object",
          description:
            "Fields to update. Allowed: status ('pending','scheduled','in_progress','completed','closed','cancelled'), invoiceNumber (string), invoiceGeneratedDate (ISO date string), invoiceSentDate (ISO date string), notes (string). When setting status to 'closed', invoiceNumber is required.",
          properties: {
            status: {
              type: "string",
              enum: ["pending", "scheduled", "in_progress", "completed", "closed", "cancelled"],
            },
            invoiceNumber: { type: "string", description: "Invoice reference number (e.g. 'INV-2026-0045')." },
            invoiceGeneratedDate: { type: "string", description: "ISO date when invoice was generated (e.g. '2026-03-26')." },
            invoiceSentDate: { type: "string", description: "ISO date when invoice was sent to client (e.g. '2026-03-26')." },
            notes: { type: "string", description: "Append to existing job notes." },
          },
        },
      },
      required: ["id", "updates"],
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
    description: "List IMS incidents. Optionally filter by status or category.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["draft", "reported", "investigating", "actions_required", "closed"], description: "Filter by status." },
        category: { type: "string", enum: ["whs", "environment", "quality", "property", "security", "other"], description: "Filter by category (maps to ISO 45001/14001/9001)." },
        limit: { type: "number", description: "Max incidents (default 20, max 100)." },
      },
    },
  },
  {
    name: "create_ims_incident",
    description: "Log a new IMS incident (nonconformance, near miss, hazard, injury, quality issue, environmental event). Returns the incident ID and number.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["whs", "environment", "quality", "property", "security", "other"], description: "ISO domain: whs (45001), environment (14001), quality (9001)." },
        incidentType: { type: "string", enum: ["injury", "near_miss", "hazard", "unsafe_condition", "spill", "nonconformance", "property_damage", "other"] },
        severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
        description: { type: "string", description: "Full description of the incident." },
        immediateActions: { type: "string", description: "Immediate actions taken." },
        jobId: { type: "string", description: "Related job Firestore ID (optional)." },
        jobNumber: { type: "string", description: "Related job number (optional)." },
        organizationName: { type: "string", description: "Client/site organisation (optional)." },
        siteLocation: { type: "object", description: "{ name, address } of the incident location." },
      },
      required: ["category", "incidentType", "severity", "description"],
    },
  },
  {
    name: "update_ims_incident",
    description: "Update an IMS incident: change status, add investigation details, root cause, corrective actions, close with evidence.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Incident Firestore ID." },
        updates: {
          type: "object",
          description: "Fields to update: status, investigation (object with summary, rootCause, contributingFactors, correctiveActions array, lessonsLearned), closureNotes.",
        },
      },
      required: ["id", "updates"],
    },
  },
  {
    name: "get_ims_audits",
    description: "List IMS internal audit reports. Optionally filter by status or standard.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["planned", "in_progress", "completed"], description: "Filter by audit status." },
        standard: { type: "string", description: "Filter by standard (e.g. 'ISO9001:2015', 'ISO14001:2015', 'ISO45001:2018')." },
        limit: { type: "number", description: "Max audits (default 20, max 50)." },
      },
    },
  },
  {
    name: "get_ims_audit",
    description: "Get full details of a single IMS audit report by ID.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Audit Firestore ID." } },
      required: ["id"],
    },
  },
  {
    name: "create_ims_audit",
    description: "Create a new IMS internal audit report. Supports ISO 9001:2015, ISO 14001:2015, and ISO 45001:2018. Returns the audit ID.",
    inputSchema: {
      type: "object",
      properties: {
        metadata: {
          type: "object",
          description: "{ auditId, standard (ISO9001:2015 | ISO14001:2015 | ISO45001:2018), scope, period, sites[], processes[], leadAuditor, auditDate, status (planned|in_progress|completed) }",
        },
        plan: {
          type: "object",
          description: "{ objectives[], criteria[], methods[], schedule[{ area, time, owner }] }",
        },
        checklist: {
          type: "array",
          description: "Array of { clause, question, evidenceNeeded, records[] }",
        },
        findings: {
          type: "array",
          description: "Array of { id, type (conformity|observation|OFI|minor_nc|major_nc), clause, requirement, evidence, description, risk, correctiveAction, owner, dueDate, status }",
        },
        summary: {
          type: "object",
          description: "{ strengths[], risks[], overallConclusion }",
        },
      },
      required: ["metadata"],
    },
  },
  {
    name: "update_ims_audit",
    description: "Update an IMS audit: add findings, update status, close with conclusions.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Audit Firestore ID." },
        updates: { type: "object", description: "Fields to merge: metadata, findings, summary, checklist, plan." },
      },
      required: ["id", "updates"],
    },
  },
  {
    name: "get_ims_corrective_actions",
    description: "List IMS corrective/preventive actions (CAPAs). Filter by status or domain.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "in_progress", "closed"], description: "Filter by CAPA status." },
        domain: { type: "string", enum: ["quality", "environment", "whs"], description: "ISO domain filter." },
        limit: { type: "number", description: "Max CAPAs (default 20, max 100)." },
      },
    },
  },
  {
    name: "create_ims_corrective_action",
    description: "Create a new corrective/preventive action (CAPA). Link to an incident or audit finding.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "CAPA title." },
        description: { type: "string", description: "What needs to be done." },
        domain: { type: "string", enum: ["quality", "environment", "whs"], description: "ISO domain." },
        priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
        ownerName: { type: "string", description: "Person responsible." },
        dueDate: { type: "string", description: "ISO date when CAPA must be completed." },
        sourceType: { type: "string", enum: ["incident", "audit", "inspection", "management_review", "other"], description: "What triggered this CAPA." },
        sourceId: { type: "string", description: "Firestore ID of the source incident/audit." },
        sourceLabel: { type: "string", description: "Human-readable source reference." },
        isoClauses: { type: "array", items: { type: "string" }, description: "Related ISO clauses." },
      },
      required: ["title", "description", "domain"],
    },
  },
  {
    name: "update_ims_corrective_action",
    description: "Update a CAPA: change status, add progress notes, close with verification evidence.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "CAPA Firestore ID." },
        updates: { type: "object", description: "Fields: status, progressNotes, verificationEvidence, closureNotes, effectivenessReview." },
      },
      required: ["id", "updates"],
    },
  },
  {
    name: "get_ims_risk_register",
    description: "List IMS risk register entries. Filter by domain, status, or risk level.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", enum: ["quality", "environment", "whs"], description: "ISO domain filter." },
        status: { type: "string", enum: ["open", "in_progress", "closed"] },
        limit: { type: "number", description: "Max entries (default 30, max 100)." },
      },
    },
  },
  {
    name: "create_ims_risk_entry",
    description: "Add a risk or opportunity to the IMS risk register.",
    inputSchema: {
      type: "object",
      properties: {
        entryType: { type: "string", enum: ["risk", "opportunity"] },
        domain: { type: "string", enum: ["quality", "environment", "whs"] },
        title: { type: "string" },
        description: { type: "string" },
        riskLevel: { type: "string", enum: ["low", "medium", "high", "critical"] },
        existingControls: { type: "string" },
        additionalControls: { type: "string" },
        ownerName: { type: "string" },
        sourceType: { type: "string", enum: ["incident", "job_risk_assessment", "inspection", "prestart", "audit", "other"] },
        sourceId: { type: "string" },
        sourceLabel: { type: "string" },
      },
      required: ["entryType", "domain", "title"],
    },
  },
  {
    name: "update_ims_risk_entry",
    description: "Update a risk register entry: change status, controls, risk level, add review notes.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Risk register entry Firestore ID." },
        updates: { type: "object", description: "Fields: status, riskLevel, existingControls, additionalControls, reviewNotes." },
      },
      required: ["id", "updates"],
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
    description: "List CRM leads from the pipeline. Filter by stream (sales/supply_chain), stage, grade, or sector.",
    inputSchema: {
      type: "object",
      properties: {
        streamType: {
          type: "string",
          enum: ["sales", "supply_chain"],
          description: "Filter by stream type: 'sales' (customers) or 'supply_chain' (suppliers/partners). Omit for all.",
        },
        stage: {
          type: "string",
          description: "Filter by pipeline stage. Sales stages: identified, researched, qualified, outreach, engaged, discovery, proposal, negotiation, won, lost, nurture. Supply chain stages: identified, researched, qualified, outreach, engaged, evaluation, negotiation, agreement, onboarded, inactive, watchlist.",
        },
        grade: { type: "string", enum: ["A","B","C","D","E"], description: "Filter by lead grade." },
        sector: { type: "string", description: "Filter by sector (e.g. mass-transit, manufacturing)." },
        limit: { type: "number", description: "Max leads to return (default 50, max 200)." },
      },
    },
  },
  {
    name: "get_pipeline_stats",
    description: "Get pipeline summary with per-stream breakdowns: total leads, hot leads count, overdue follow-ups, estimated pipeline value, breakdown by stage and grade. Accepts optional streamType filter.",
    inputSchema: {
      type: "object",
      properties: {
        streamType: {
          type: "string",
          enum: ["sales", "supply_chain"],
          description: "Filter stats to a specific stream. Omit for combined stats.",
        },
      },
    },
  },
  {
    name: "create_lead",
    description: "Create a new CRM lead — typically from an OSINT finding. Accepts the standard OSINT-to-CRM workflow JSON structure.",
    inputSchema: {
      type: "object",
      properties: {
        company: { type: "string", description: "Company name." },
        streamType: { type: "string", enum: ["sales", "supply_chain"], description: "Stream type: 'sales' (customer) or 'supply_chain' (supplier/partner). Default: sales." },
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
  {
    name: "ingest_osint_scan",
    description:
      "Ingest a full daily OSINT scan into the portal. Stores the scan in Firestore and auto-creates CRM leads for high-relevance opportunities (score 4+). The scan appears on the /dashboard/osint page.",
    inputSchema: {
      type: "object",
      properties: {
        scan: {
          type: "object",
          description:
            "Full OSINTScan object with date, generatedAt, executiveSummary, pillars (with findings), opportunityMatrix, and metadata.",
        },
      },
      required: ["scan"],
    },
  },
  // ─── VANGUARD Report tools ──────────────────────────────────────────────────
  {
    name: "push_vanguard_report",
    description:
      "Push a VANGUARD daily intelligence report into the portal. One report per day — overwrites if same date. The report appears on the CRM dashboard widget.",
    inputSchema: {
      type: "object",
      properties: {
        report: {
          type: "object",
          description:
            "Full VANGUARD report object with: date, snapshot (sales/supplyChain pipeline stats), newLeads array, outreachEvents array, stageMovements array, priorityActions array, overdueFollowUps array, executiveSummary string, weekToDate object (or null).",
        },
      },
      required: ["report"],
    },
  },
  {
    name: "get_vanguard_report",
    description:
      "Get a VANGUARD daily report for a specific date. Returns null if no report exists for that date.",
    inputSchema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "ISO date string (e.g. '2026-03-25'). Defaults to today if omitted.",
        },
      },
    },
  },
  {
    name: "get_vanguard_reports",
    description: "Get recent VANGUARD daily reports, newest first.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of reports to return (default 7, max 30)." },
      },
    },
  },
  // ─── Xero Accounting tools ──────────────────────────────────────────────────
  {
    name: "xero_status",
    description: "Check whether Xero is connected and authorised. Returns connection status, organisation name, and token expiry.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "xero_create_invoice",
    description:
      "Create a DRAFT invoice in Xero. Returns the Xero invoice ID and number. The invoice is created as DRAFT — call xero_send_invoice to approve and email it to the client.",
    inputSchema: {
      type: "object",
      properties: {
        contactName: { type: "string", description: "Client/organisation name (must match or will be created in Xero)." },
        contactEmail: { type: "string", description: "Client email for invoice delivery." },
        reference: { type: "string", description: "ASI job number (e.g. 'MCK-26-0023') — appears as Reference on the invoice." },
        dueDate: { type: "string", description: "Invoice due date (ISO date, e.g. '2026-04-26')." },
        lineItems: {
          type: "array",
          description: "Invoice line items. Each: { description, quantity, unitAmount (ex-GST), accountCode (default '200'), taxType (default 'OUTPUT') }.",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              quantity: { type: "number" },
              unitAmount: { type: "number", description: "Amount per unit, ex-GST." },
              accountCode: { type: "string", description: "Xero account code (default '200' = Sales)." },
              taxType: { type: "string", description: "Xero tax type (default 'OUTPUT' = GST on Income)." },
            },
            required: ["description", "quantity", "unitAmount"],
          },
        },
        poNumber: { type: "string", description: "Client PO or works order number (optional)." },
      },
      required: ["contactName", "contactEmail", "reference", "dueDate", "lineItems"],
    },
  },
  {
    name: "xero_send_invoice",
    description:
      "Approve a DRAFT invoice and email it to the client. Moves the invoice from DRAFT → AUTHORISED, then sends via Xero's email system.",
    inputSchema: {
      type: "object",
      properties: {
        invoiceId: { type: "string", description: "The Xero InvoiceID (UUID) returned by xero_create_invoice." },
      },
      required: ["invoiceId"],
    },
  },
  {
    name: "xero_get_invoice",
    description: "Get details of a Xero invoice by its InvoiceID.",
    inputSchema: {
      type: "object",
      properties: {
        invoiceId: { type: "string", description: "The Xero InvoiceID (UUID)." },
      },
      required: ["invoiceId"],
    },
  },
  {
    name: "xero_list_contacts",
    description: "Search Xero contacts by name. Use this to find existing clients before creating invoices.",
    inputSchema: {
      type: "object",
      properties: {
        searchTerm: { type: "string", description: "Partial name match (e.g. 'McKenzie')." },
      },
    },
  },
  {
    name: "xero_attach_job_report",
    description:
      "Generate the Completed Job Report PDF for a job and attach it to a Xero invoice. The job must be in 'completed' or 'closed' status. Call this AFTER close_out_job or after manually closing the job so the report includes the invoice number.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "ASI Portal job Firestore document ID." },
        invoiceId: { type: "string", description: "Xero InvoiceID (UUID) to attach the report to." },
      },
      required: ["jobId", "invoiceId"],
    },
  },
  {
    name: "close_out_job",
    description:
      "Full turnkey job close-out: creates a Xero invoice from job data, attaches the Completed Job Report PDF, optionally sends the invoice, then closes the job in the portal. This is the single-call workflow for LEDGER agents.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "ASI Portal job Firestore document ID." },
        dueDate: { type: "string", description: "Invoice due date (ISO date). Defaults to 30 days from today." },
        accountCode: { type: "string", description: "Xero account code for line items (default '200' = Sales)." },
        skipSend: { type: "boolean", description: "If true, create invoice as DRAFT but don't send. Default false (sends and attaches report)." },
        attachReport: { type: "boolean", description: "If true (default), generates and attaches the Completed Job Report PDF to the Xero invoice." },
      },
      required: ["jobId"],
    },
  },
  // ─── Executive / Chief of Staff tools ───────────────────────────────────────
  {
    name: "get_company_overview",
    description:
      "Pull a comprehensive real-time snapshot of the entire ASI operation in a single call. Returns: jobs by status with revenue totals, sales + supply chain pipeline stats, recent VANGUARD report summary, overdue leads, invoicing queue, IMS incident count, prestart compliance, and recent department reports. Designed for the Executive Assistant / Chief of Staff agent.",
    inputSchema: {
      type: "object",
      properties: {
        includeJobDetails: { type: "boolean", description: "Include individual job records for completed/in-progress (default false — just counts and totals)." },
      },
    },
  },
  {
    name: "push_department_report",
    description:
      "Submit a weekly department report. Each agent team (LEDGER, SENTINEL, VANGUARD, OSINT) pushes their report here. The Executive Assistant reads them all to compile the company report.",
    inputSchema: {
      type: "object",
      properties: {
        department: {
          type: "string",
          enum: ["ledger", "sentinel", "vanguard", "osint", "operations", "chief_of_staff"],
          description: "Department identifier.",
        },
        weekEnding: { type: "string", description: "ISO date of the Friday this report covers (e.g. '2026-03-28')." },
        report: {
          type: "object",
          description: "Report content. Structure varies by department but should include: summary (string), metrics (object), highlights (string[]), risks (string[]), recommendations (string[]), rawData (optional object with supporting details).",
        },
      },
      required: ["department", "weekEnding", "report"],
    },
  },
  {
    name: "get_department_reports",
    description:
      "Retrieve department reports. Can filter by department and/or week. Returns all matching reports, newest first. The Executive Assistant uses this to pull all departments' weekly reports for synthesis.",
    inputSchema: {
      type: "object",
      properties: {
        department: { type: "string", description: "Filter by department (e.g. 'ledger'). Omit for all departments." },
        weekEnding: { type: "string", description: "Filter by specific week ending date. Omit for all weeks." },
        limit: { type: "number", description: "Max reports to return (default 20, max 50)." },
      },
    },
  },
  {
    name: "push_executive_report",
    description:
      "Store a compiled executive/company report. The Chief of Staff agent pushes the synthesised weekly report here after analysing all department reports.",
    inputSchema: {
      type: "object",
      properties: {
        weekEnding: { type: "string", description: "ISO date of the Friday this report covers." },
        report: {
          type: "object",
          description: "Full executive report: executiveSummary (string), operations (object), salesPipeline (object), accounts (object), intelligence (object), risks (string[]), recommendations (string[]), nextWeekPriorities (string[]), kpis (object).",
        },
      },
      required: ["weekEnding", "report"],
    },
  },
  {
    name: "get_executive_reports",
    description: "Retrieve past executive/company reports, newest first.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max reports to return (default 4, max 12)." },
      },
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
  const requestedLimit = safeLimit(args.limit);
  // Fetch all then filter in memory to avoid Firestore composite index requirements
  const snap = await db.collection(COLLECTIONS.JOBS).orderBy("createdAt", "desc").limit(200).get();
  let docs = snap.docs.map((d) => serializeDoc(d.id, d.data()));
  if (typeof args.status === "string") {
    docs = docs.filter((d) => d.status === args.status);
  }
  if (typeof args.clientName === "string" && args.clientName) {
    const term = args.clientName.toLowerCase();
    docs = docs.filter((d) => {
      const cn = String(d.clientName || d.clientOrganisationName || "").toLowerCase();
      return cn.includes(term);
    });
  }
  return docs.slice(0, requestedLimit);
}

async function handleGetJob(args: Record<string, unknown>) {
  const id = String(args.id);
  const snap = await admin.firestore().collection(COLLECTIONS.JOBS).doc(id).get();
  if (!snap.exists) throw new Error(`Job '${id}' not found.`);
  return serializeDoc(snap.id, snap.data()!);
}

async function handleUpdateJob(args: Record<string, unknown>) {
  const id = String(args.id);
  const updates = (args.updates || {}) as Record<string, unknown>;
  const db = admin.firestore();
  const ref = db.collection(COLLECTIONS.JOBS).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Job '${id}' not found.`);
  const existing = snap.data()!;

  const payload: Record<string, unknown> = {};

  // Status change
  if (typeof updates.status === "string") {
    const newStatus = updates.status;
    if (newStatus === "closed" && !updates.invoiceNumber && !existing.invoiceNumber) {
      throw new Error("Cannot close job without an invoiceNumber.");
    }
    payload.status = newStatus;

    // Auto-set closure fields
    if (newStatus === "closed") {
      payload.closedAt = admin.firestore.FieldValue.serverTimestamp();
      payload.closedBy = "mcp-agent";
    }

    // Add to statusLog
    const statusLog = (existing.statusLog as Array<Record<string, unknown>>) || [];
    statusLog.push({
      status: newStatus,
      changedAt: new Date().toISOString(),
      changedBy: "mcp-agent",
      note: typeof updates.notes === "string" ? updates.notes : `Status changed to ${newStatus} via MCP`,
    });
    payload.statusLog = statusLog;
  }

  // Invoice fields
  if (typeof updates.invoiceNumber === "string") {
    payload.invoiceNumber = updates.invoiceNumber;
  }
  if (typeof updates.invoiceGeneratedDate === "string") {
    payload.invoiceDate = admin.firestore.Timestamp.fromDate(new Date(updates.invoiceGeneratedDate + "T00:00:00"));
  }
  if (typeof updates.invoiceSentDate === "string") {
    payload.invoiceSentAt = admin.firestore.Timestamp.fromDate(new Date(updates.invoiceSentDate + "T00:00:00"));
  }

  // Notes — append to existing
  if (typeof updates.notes === "string" && !updates.status) {
    const existingNotes = typeof existing.notes === "string" ? existing.notes : "";
    payload.notes = existingNotes
      ? `${existingNotes}\n\n[${new Date().toISOString().split("T")[0]}] ${updates.notes}`
      : `[${new Date().toISOString().split("T")[0]}] ${updates.notes}`;
  }

  if (Object.keys(payload).length === 0) throw new Error("No valid fields to update.");

  payload.updatedAt = admin.firestore.FieldValue.serverTimestamp();
  await ref.set(payload, { merge: true });

  const updated = await ref.get();
  return serializeDoc(updated.id, updated.data()!);
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
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  let leads = snap.docs
    .map((d) => serializeDoc(d.id, d.data()))
    .filter((l) => !l.isDeleted);
  if (typeof args.streamType === "string") {
    leads = leads.filter((l) => (String(l.streamType || "sales")) === args.streamType);
  }
  if (typeof args.stage === "string") leads = leads.filter((l) => l.stage === args.stage);
  if (typeof args.grade === "string") leads = leads.filter((l) => l.leadGrade === args.grade);
  if (typeof args.sector === "string") {
    const s = args.sector.toLowerCase();
    leads = leads.filter((l) => String(l.sector || "").toLowerCase().includes(s));
  }
  return leads;
}

async function handleGetPipelineStats(args: Record<string, unknown>) {
  const db = admin.firestore();
  const snap = await db.collection(COLLECTIONS.LEADS).limit(500).get();
  const streamFilter = typeof args.streamType === "string" ? args.streamType : null;
  const terminalStages = ["won", "lost", "onboarded", "inactive"];
  const byStage: Record<string, number> = {};
  const byGrade: Record<string, number> = {};
  const byStream: Record<string, number> = { sales: 0, supply_chain: 0 };
  let totalValue = 0;
  let overdueFollowUps = 0;
  let total = 0;
  const today = new Date().toISOString().split("T")[0];
  snap.docs.filter((d) => !d.data().isDeleted).forEach((d) => {
    const l = d.data() as Record<string, unknown>;
    const st = String(l.streamType || "sales");
    byStream[st] = (byStream[st] || 0) + 1;
    if (streamFilter && st !== streamFilter) return;
    total++;
    const stage = String(l.stage || "unknown");
    byStage[stage] = (byStage[stage] || 0) + 1;
    const grade = String(l.leadGrade || "E");
    byGrade[grade] = (byGrade[grade] || 0) + 1;
    totalValue += typeof l.estimatedValue === "number" ? l.estimatedValue : 0;
    if (typeof l.nextActionDate === "string" && l.nextActionDate < today && !terminalStages.includes(stage)) {
      overdueFollowUps += 1;
    }
  });
  return {
    total,
    totalActive: total - (byStage["won"] || 0) - (byStage["lost"] || 0) - (byStage["onboarded"] || 0) - (byStage["inactive"] || 0),
    hotLeads: (byGrade["A"] || 0) + (byGrade["B"] || 0),
    overdueFollowUps,
    totalEstimatedValue: totalValue,
    byStage,
    byGrade,
    byStream,
    streamFilter: streamFilter || "all",
  };
}

async function handleCreateLead(args: Record<string, unknown>) {
  if (!args.company) throw new Error("company is required.");
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const leadNumber = await nextMcpLeadNumber();

  const streamType = String(args.streamType || "sales");
  const salesStageMap: Record<number, string> = {
    1: "identified", 2: "researched", 3: "qualified", 4: "outreach",
    5: "engaged", 6: "discovery", 7: "proposal", 8: "negotiation", 9: "won", 10: "lost", 11: "nurture",
  };
  const supplyStageMap: Record<number, string> = {
    1: "identified", 2: "researched", 3: "qualified", 4: "outreach",
    5: "engaged", 6: "evaluation", 7: "negotiation", 8: "agreement", 9: "onboarded", 10: "inactive", 11: "watchlist",
  };
  const stageMap = streamType === "supply_chain" ? supplyStageMap : salesStageMap;
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
    streamType,
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
  const snap = await db.collection(COLLECTIONS.LEADS).limit(200).get();
  const leads = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((d) => !(d as Record<string, unknown>).isDeleted) as Array<Record<string, unknown>>;
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
    const existingSnap = await db.collection(COLLECTIONS.LEADS)
      .where("companyName", "==", company).limit(5).get();
    const existing = { empty: existingSnap.docs.filter((d) => !d.data().isDeleted).length === 0, docs: existingSnap.docs.filter((d) => !d.data().isDeleted) };
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

async function handleIngestOsintScan(args: Record<string, unknown>) {
  const scan = args.scan as Record<string, unknown>;
  if (!scan || !scan.date) throw new Error("Scan must include a 'date' field.");
  const db = admin.firestore();
  const date = String(scan.date);

  // Store the scan
  await db.collection(COLLECTIONS.OSINT_SCANS).doc(date).set(scan);

  // Auto-create leads from high-relevance opportunities
  const matrix = (scan.opportunityMatrix as Array<Record<string, unknown>>) || [];
  const now = admin.firestore.FieldValue.serverTimestamp();
  let leadsCreated = 0;

  for (const opp of matrix) {
    const score = typeof opp.relevanceScore === "number" ? opp.relevanceScore : 0;
    if (score < 4) continue;
    const name = String(opp.name || "");
    if (!name) continue;

    const existing = await db.collection(COLLECTIONS.LEADS)
      .where("companyName", "==", name).limit(1).get();
    if (!existing.empty) continue;

    await db.collection(COLLECTIONS.LEADS).add({
      leadNumber: `LD-OSINT-${date}-${opp.rank}`,
      companyName: name,
      sector: String(opp.pillar || "other").toLowerCase().replace(/\s+/g, "-"),
      isExistingClient: false, contacts: [],
      bantScore: score * 17,
      bantBreakdown: { budget: 10, authority: 10, need: score * 5, timing: opp.urgency === "immediate" ? 20 : 10, fit: score * 3 },
      leadGrade: score >= 5 ? "A" : "B",
      stage: "identified", stageHistory: [], stageEnteredAt: new Date().toISOString(),
      source: { type: "osint", osintScanDate: date, osintFinding: name, osintPillar: opp.pillar, osintRelevanceScore: score },
      estimatedServices: [], painPoints: [], asiSolutionFit: [String(opp.action || "")],
      outreachSequence: null,
      outreachStatus: { linkedInConnected: false, linkedInMessageSent: false, emailsSent: 0, responseReceived: false, meetingScheduled: false },
      outreachHistory: [], marketMode: "growth",
      nextAction: String(opp.action || ""), nextActionDate: date,
      notes: `[Auto-imported from OSINT ${date}] Rank #${opp.rank}. Urgency: ${opp.urgency}. ${opp.action}`,
      tags: ["osint", "auto-imported", String(opp.urgency || "")],
      createdAt: now, updatedAt: now, createdBy: "mcp-agent", isDeleted: false,
    });
    leadsCreated++;
  }

  return { ok: true, date, totalFindings: scan.metadata ? (scan.metadata as Record<string, unknown>).totalFindings : 0, leadsCreated };
}

// ─── VANGUARD Report handlers ─────────────────────────────────────────────────

async function handlePushVanguardReport(args: Record<string, unknown>) {
  const report = args.report as Record<string, unknown>;
  if (!report || !report.date) throw new Error("Report must include a 'date' field.");
  const db = admin.firestore();
  const date = String(report.date);
  await db.collection(COLLECTIONS.VANGUARD_REPORTS).doc(date).set({
    ...report,
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ok: true, reportId: date, date };
}

async function handleGetVanguardReport(args: Record<string, unknown>) {
  const db = admin.firestore();
  const date = typeof args.date === "string" && args.date
    ? args.date
    : new Date().toISOString().split("T")[0];
  const snap = await db.collection(COLLECTIONS.VANGUARD_REPORTS).doc(date).get();
  if (!snap.exists) return null;
  return serializeDoc(snap.id, snap.data()!);
}

async function handleGetVanguardReports(args: Record<string, unknown>) {
  const db = admin.firestore();
  const limit = safeLimit(args.limit, 7, 30);
  const snap = await db.collection(COLLECTIONS.VANGUARD_REPORTS)
    .orderBy("date", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((d) => serializeDoc(d.id, d.data()));
}

// ─── IMS Audit / CAPA / Risk handlers ─────────────────────────────────────────

async function handleCreateImsIncident(args: Record<string, unknown>) {
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const counterRef = db.collection(COLLECTIONS.IMS_DOCUMENT_COUNTERS).doc("incidents");
  const counter = await counterRef.get();
  const seq = (counter.exists ? (counter.data()?.count || 0) : 0) + 1;
  await counterRef.set({ count: seq }, { merge: true });
  const incidentNumber = `INC-${new Date().getFullYear()}-${String(seq).padStart(4, "0")}`;

  const payload: Record<string, unknown> = {
    incidentNumber,
    category: String(args.category),
    incidentType: String(args.incidentType),
    severity: String(args.severity),
    status: "reported",
    description: String(args.description),
    immediateActions: typeof args.immediateActions === "string" ? args.immediateActions : "",
    jobId: typeof args.jobId === "string" ? args.jobId : null,
    jobNumber: typeof args.jobNumber === "string" ? args.jobNumber : null,
    organizationName: typeof args.organizationName === "string" ? args.organizationName : null,
    siteLocation: args.siteLocation || null,
    occurredAt: now, reportedAt: now,
    reportedById: "mcp-agent", reportedByName: "Lead Auditor Agent",
    createdAt: now, updatedAt: now,
  };
  const ref = await db.collection(COLLECTIONS.IMS_INCIDENTS).add(payload);
  return { ok: true, id: ref.id, incidentNumber };
}

async function handleUpdateImsIncident(args: Record<string, unknown>) {
  const id = String(args.id);
  const updates = (args.updates || {}) as Record<string, unknown>;
  const db = admin.firestore();
  const ref = db.collection(COLLECTIONS.IMS_INCIDENTS).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Incident '${id}' not found.`);

  const payload: Record<string, unknown> = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  if (typeof updates.status === "string") payload.status = updates.status;
  if (updates.investigation) payload.investigation = updates.investigation;
  if (updates.status === "closed") {
    payload.closedAt = admin.firestore.FieldValue.serverTimestamp();
    payload.closedByName = "Lead Auditor Agent";
  }

  await ref.set(payload, { merge: true });
  const updated = await ref.get();
  return serializeDoc(updated.id, updated.data()!);
}

async function handleGetImsAudits(args: Record<string, unknown>) {
  const db = admin.firestore();
  const limit = safeLimit(args.limit, 20, 50);
  const snap = await db.collection(COLLECTIONS.IMS_AUDITS).orderBy("createdAt", "desc").limit(limit).get();
  let docs = snap.docs.map((d) => serializeDoc(d.id, d.data()));
  if (typeof args.status === "string") docs = docs.filter((d) => (d.metadata as Record<string, unknown>)?.status === args.status);
  if (typeof args.standard === "string") docs = docs.filter((d) => (d.metadata as Record<string, unknown>)?.standard === args.standard);
  return docs;
}

async function handleGetImsAudit(args: Record<string, unknown>) {
  const id = String(args.id);
  const snap = await admin.firestore().collection(COLLECTIONS.IMS_AUDITS).doc(id).get();
  if (!snap.exists) throw new Error(`Audit '${id}' not found.`);
  return serializeDoc(snap.id, snap.data()!);
}

async function handleCreateImsAudit(args: Record<string, unknown>) {
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const payload: Record<string, unknown> = {
    metadata: args.metadata || {},
    plan: args.plan || { objectives: [], criteria: [], methods: [], schedule: [] },
    checklist: args.checklist || [],
    findings: args.findings || [],
    summary: args.summary || { strengths: [], risks: [], overallConclusion: "" },
    source: "agent",
    createdAt: now, updatedAt: now,
    createdById: "mcp-agent", createdByName: "Lead Auditor Agent", createdByEmail: "",
  };
  const ref = await db.collection(COLLECTIONS.IMS_AUDITS).add(payload);
  return { ok: true, id: ref.id, auditId: (args.metadata as Record<string, unknown>)?.auditId || ref.id };
}

async function handleUpdateImsAudit(args: Record<string, unknown>) {
  const id = String(args.id);
  const updates = (args.updates || {}) as Record<string, unknown>;
  const db = admin.firestore();
  const ref = db.collection(COLLECTIONS.IMS_AUDITS).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Audit '${id}' not found.`);

  const payload: Record<string, unknown> = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  for (const key of ["metadata", "plan", "checklist", "findings", "summary"]) {
    if (updates[key]) payload[key] = updates[key];
  }
  await ref.set(payload, { merge: true });
  const updated = await ref.get();
  return serializeDoc(updated.id, updated.data()!);
}

async function handleGetImsCorrActions(args: Record<string, unknown>) {
  const db = admin.firestore();
  const limit = safeLimit(args.limit, 20, 100);
  const snap = await db.collection(COLLECTIONS.IMS_CORRECTIVE_ACTIONS).orderBy("createdAt", "desc").limit(limit).get();
  let docs = snap.docs.map((d) => serializeDoc(d.id, d.data()));
  if (typeof args.status === "string") docs = docs.filter((d) => d.status === args.status);
  if (typeof args.domain === "string") docs = docs.filter((d) => d.domain === args.domain);
  return docs;
}

async function handleCreateImsCorrAction(args: Record<string, unknown>) {
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const payload: Record<string, unknown> = {
    title: String(args.title),
    description: String(args.description),
    domain: String(args.domain || "quality"),
    priority: String(args.priority || "medium"),
    status: "open",
    ownerName: typeof args.ownerName === "string" ? args.ownerName : "",
    dueDate: typeof args.dueDate === "string" ? args.dueDate : null,
    sourceType: typeof args.sourceType === "string" ? args.sourceType : "other",
    sourceId: typeof args.sourceId === "string" ? args.sourceId : "",
    sourceLabel: typeof args.sourceLabel === "string" ? args.sourceLabel : "",
    isoClauses: Array.isArray(args.isoClauses) ? args.isoClauses : [],
    createdAt: now, updatedAt: now,
    createdById: "mcp-agent", createdByName: "Lead Auditor Agent",
  };
  const ref = await db.collection(COLLECTIONS.IMS_CORRECTIVE_ACTIONS).add(payload);
  return { ok: true, id: ref.id, title: payload.title };
}

async function handleUpdateImsCorrAction(args: Record<string, unknown>) {
  const id = String(args.id);
  const updates = (args.updates || {}) as Record<string, unknown>;
  const db = admin.firestore();
  const ref = db.collection(COLLECTIONS.IMS_CORRECTIVE_ACTIONS).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`CAPA '${id}' not found.`);

  const payload: Record<string, unknown> = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  for (const key of ["status", "progressNotes", "verificationEvidence", "closureNotes", "effectivenessReview"]) {
    if (updates[key] !== undefined) payload[key] = updates[key];
  }
  if (updates.status === "closed") {
    payload.closedAt = admin.firestore.FieldValue.serverTimestamp();
    payload.closedByName = "Lead Auditor Agent";
  }
  await ref.set(payload, { merge: true });
  const updated = await ref.get();
  return serializeDoc(updated.id, updated.data()!);
}

async function handleGetImsRiskRegister(args: Record<string, unknown>) {
  const db = admin.firestore();
  const limit = safeLimit(args.limit, 30, 100);
  const snap = await db.collection(COLLECTIONS.IMS_RISK_REGISTER).orderBy("createdAt", "desc").limit(limit).get();
  let docs = snap.docs.map((d) => serializeDoc(d.id, d.data()));
  if (typeof args.domain === "string") docs = docs.filter((d) => d.domain === args.domain);
  if (typeof args.status === "string") docs = docs.filter((d) => d.status === args.status);
  return docs;
}

async function handleCreateImsRiskEntry(args: Record<string, unknown>) {
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const payload: Record<string, unknown> = {
    entryType: String(args.entryType || "risk"),
    domain: String(args.domain || "quality"),
    title: String(args.title),
    description: typeof args.description === "string" ? args.description : "",
    riskLevel: typeof args.riskLevel === "string" ? args.riskLevel : "medium",
    present: true,
    existingControls: typeof args.existingControls === "string" ? args.existingControls : "",
    additionalControls: typeof args.additionalControls === "string" ? args.additionalControls : "",
    owner: typeof args.ownerName === "string" ? { id: "mcp-agent", name: args.ownerName } : null,
    status: "open",
    source: {
      type: typeof args.sourceType === "string" ? args.sourceType : "other",
      id: typeof args.sourceId === "string" ? args.sourceId : "",
      label: typeof args.sourceLabel === "string" ? args.sourceLabel : "",
    },
    createdAt: now, updatedAt: now,
    createdById: "mcp-agent", createdByName: "Lead Auditor Agent",
  };
  const ref = await db.collection(COLLECTIONS.IMS_RISK_REGISTER).add(payload);
  return { ok: true, id: ref.id, title: payload.title };
}

async function handleUpdateImsRiskEntry(args: Record<string, unknown>) {
  const id = String(args.id);
  const updates = (args.updates || {}) as Record<string, unknown>;
  const db = admin.firestore();
  const ref = db.collection(COLLECTIONS.IMS_RISK_REGISTER).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Risk entry '${id}' not found.`);

  const payload: Record<string, unknown> = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  for (const key of ["status", "riskLevel", "existingControls", "additionalControls", "reviewNotes"]) {
    if (updates[key] !== undefined) payload[key] = updates[key];
  }
  if (updates.status === "closed") payload.closedAt = admin.firestore.FieldValue.serverTimestamp();
  payload.lastReviewedAt = admin.firestore.FieldValue.serverTimestamp();
  await ref.set(payload, { merge: true });
  const updated = await ref.get();
  return serializeDoc(updated.id, updated.data()!);
}

// ─── Xero handlers ────────────────────────────────────────────────────────────

async function handleXeroStatus() {
  return xeroGetConnectionStatus();
}

async function handleXeroCreateInvoice(args: Record<string, unknown>) {
  return xeroCreateInvoice({
    contactName: String(args.contactName),
    contactEmail: String(args.contactEmail),
    reference: String(args.reference),
    dueDate: String(args.dueDate),
    lineItems: (args.lineItems as Array<{ description: string; quantity: number; unitAmount: number; accountCode?: string; taxType?: string }>) || [],
    poNumber: typeof args.poNumber === "string" ? args.poNumber : undefined,
  });
}

async function handleXeroSendInvoice(args: Record<string, unknown>) {
  return xeroSendInvoice(String(args.invoiceId));
}

async function handleXeroGetInvoice(args: Record<string, unknown>) {
  return xeroGetInvoice(String(args.invoiceId));
}

async function handleXeroListContacts(args: Record<string, unknown>) {
  return xeroListContacts(typeof args.searchTerm === "string" ? args.searchTerm : undefined);
}

async function generateJobReportPdf(jobId: string): Promise<{ pdfBytes: Uint8Array; fileName: string }> {
  const db = admin.firestore();
  const jobSnap = await db.collection(COLLECTIONS.JOBS).doc(jobId).get();
  if (!jobSnap.exists) throw new Error(`Job '${jobId}' not found.`);
  const job = jobSnap.data()!;
  const status = String(job.status || "");
  if (status !== "completed" && status !== "closed") {
    throw new Error(`Job status is '${status}' — report only available for completed/closed jobs.`);
  }

  // Call the completion report endpoint internally
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://asiportal.live";
  const res = await fetch(`${baseUrl}/api/jobs/completion-report`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-mcp-internal": "true" },
    body: JSON.stringify({ jobId }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to generate report (${res.status}): ${text.slice(0, 200)}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const pdfBytes = new Uint8Array(arrayBuffer);
  const jobNumber = String(job.jobNumber || jobId).replace(/[^a-zA-Z0-9._-]/g, "_");
  return { pdfBytes, fileName: `${jobNumber}_Completion_Report.pdf` };
}

async function handleXeroAttachJobReport(args: Record<string, unknown>) {
  const jobId = String(args.jobId);
  const invoiceId = String(args.invoiceId);
  const { pdfBytes, fileName } = await generateJobReportPdf(jobId);
  const result = await xeroAttachFileToInvoice(invoiceId, fileName, pdfBytes);
  return { ok: true, fileName, attachmentId: result.attachmentId, invoiceId };
}

async function handleCloseOutJob(args: Record<string, unknown>) {
  const jobId = String(args.jobId);
  const accountCode = typeof args.accountCode === "string" ? args.accountCode : "200";
  const skipSend = args.skipSend === true;

  // 1. Get the job
  const db = admin.firestore();
  const jobRef = db.collection(COLLECTIONS.JOBS).doc(jobId);
  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) throw new Error(`Job '${jobId}' not found.`);
  const job = jobSnap.data()!;

  if (job.status !== "completed") {
    throw new Error(`Job status is '${job.status}' — only 'completed' jobs can be closed out.`);
  }

  const clientName = String(job.clientName || job.clientOrganisationName || "Unknown Client");
  const clientEmail = String(job.clientEmail || "");
  const jobNumber = String(job.jobNumber || jobId);

  if (!clientEmail) throw new Error("Job has no clientEmail — cannot send invoice.");

  // 2. Build line items from repair sites
  const lineItems: Array<{ description: string; quantity: number; unitAmount: number; accountCode: string }> = [];
  const vehicles = (job.jobVehicles || []) as Array<Record<string, unknown>>;

  for (const vehicle of vehicles) {
    const rego = String(vehicle.registration || vehicle.vin || "Vehicle");
    const repairs = (vehicle.repairSites || []) as Array<Record<string, unknown>>;
    for (const repair of repairs) {
      if (!repair.isCompleted) continue;
      const cost = typeof repair.totalCost === "number" ? repair.totalCost : 0;
      if (cost <= 0) continue;
      const repairType = String(repair.repairType || "Service");
      const location = String(repair.location || "");
      lineItems.push({
        description: `${repairType}${location ? ` — ${location}` : ""} (${rego})`,
        quantity: 1,
        unitAmount: cost,
        accountCode,
      });
    }
  }

  // Fallback: if no line items from repair sites, use job total
  if (lineItems.length === 0) {
    const total = typeof job.totalJobCost === "number" ? job.totalJobCost : 0;
    if (total <= 0) throw new Error("Job has no cost data to invoice.");
    lineItems.push({
      description: `Services — ${jobNumber}`,
      quantity: 1,
      unitAmount: total,
      accountCode,
    });
  }

  // 3. Due date: provided or 30 days from today
  const dueDate = typeof args.dueDate === "string"
    ? args.dueDate
    : new Date(Date.now() + 30 * 86400_000).toISOString().split("T")[0];

  // Get PO number from first vehicle if available
  const poNumber = vehicles.length > 0 ? String(vehicles[0].poWorksOrderNumber || "") : "";

  // 4. Create invoice in Xero
  const invoice = await xeroCreateInvoice({
    contactName: clientName,
    contactEmail: clientEmail,
    reference: jobNumber,
    dueDate,
    lineItems,
    poNumber: poNumber || undefined,
  });

  // 5. Send if not skipped
  if (!skipSend) {
    await xeroSendInvoice(invoice.invoiceId);
  }

  // 6. Close job in portal
  const today = new Date().toISOString().split("T")[0];
  const statusLog = (job.statusLog as Array<Record<string, unknown>>) || [];
  statusLog.push({
    status: "closed",
    changedAt: new Date().toISOString(),
    changedBy: "ledger-agent",
    note: `Invoice ${invoice.invoiceNumber} created and ${skipSend ? "drafted" : "sent"} via Xero.`,
  });

  await jobRef.set({
    status: "closed",
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: admin.firestore.Timestamp.fromDate(new Date(today + "T00:00:00")),
    invoiceSentAt: skipSend ? null : admin.firestore.FieldValue.serverTimestamp(),
    closedAt: admin.firestore.FieldValue.serverTimestamp(),
    closedBy: "ledger-agent",
    statusLog,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  // 7. Attach Completed Job Report PDF (job is now closed so report includes invoice number)
  let reportAttached = false;
  const shouldAttach = args.attachReport !== false; // default true
  if (shouldAttach) {
    try {
      const { pdfBytes, fileName } = await generateJobReportPdf(jobId);
      await xeroAttachFileToInvoice(invoice.invoiceId, fileName, pdfBytes);
      reportAttached = true;
    } catch (err) {
      // Non-fatal — invoice still created/sent, just no attachment
      console.error("[close_out_job] Failed to attach report:", err);
    }
  }

  return {
    ok: true,
    jobId,
    jobNumber,
    xeroInvoiceId: invoice.invoiceId,
    xeroInvoiceNumber: invoice.invoiceNumber,
    invoiceStatus: skipSend ? "DRAFT" : "SENT",
    reportAttached,
    lineItemCount: lineItems.length,
    clientName,
    clientEmail,
    dueDate,
  };
}

// ─── Executive / Chief of Staff handlers ──────────────────────────────────────

async function handleGetCompanyOverview(args: Record<string, unknown>) {
  const db = admin.firestore();
  const includeDetails = args.includeJobDetails === true;

  // Pull everything in parallel
  const [jobsSnap, bookingsSnap, leadsSnap, incidentsSnap, inspectionsSnap, prestartsSnap, vanguardSnap, deptReportsSnap] = await Promise.all([
    db.collection(COLLECTIONS.JOBS).orderBy("createdAt", "desc").limit(200).get(),
    db.collection(COLLECTIONS.BOOKINGS).limit(100).get(),
    db.collection(COLLECTIONS.LEADS).limit(300).get(),
    db.collection(COLLECTIONS.IMS_INCIDENTS).limit(50).get(),
    db.collection(COLLECTIONS.INSPECTIONS).limit(50).get(),
    db.collection(COLLECTIONS.PRESTART_CHECKS).limit(50).get(),
    db.collection(COLLECTIONS.VANGUARD_REPORTS).orderBy("date", "desc").limit(1).get(),
    db.collection(COLLECTIONS.DEPARTMENT_REPORTS).orderBy("submittedAt", "desc").limit(10).get(),
  ]);

  // Jobs analysis
  const jobs = jobsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as Array<Record<string, unknown>>;
  const jobsByStatus: Record<string, number> = {};
  let completedRevenue = 0;
  let closedRevenue = 0;
  let inProgressCount = 0;
  const completedJobs: Array<Record<string, unknown>> = [];
  const inProgressJobs: Array<Record<string, unknown>> = [];

  jobs.forEach((j) => {
    const s = String(j.status || "unknown");
    jobsByStatus[s] = (jobsByStatus[s] || 0) + 1;
    const cost = typeof j.totalJobCost === "number" ? j.totalJobCost : 0;
    if (s === "completed") {
      completedRevenue += cost;
      if (includeDetails) completedJobs.push(serializeDoc(String(j.id), j));
    }
    if (s === "closed") closedRevenue += cost;
    if (s === "in_progress") {
      inProgressCount += 1;
      if (includeDetails) inProgressJobs.push(serializeDoc(String(j.id), j));
    }
  });

  // Pipeline analysis
  const leads = leadsSnap.docs.map((d) => d.data());
  const activeLeads = leads.filter((l) => !l.isDeleted);
  const salesLeads = activeLeads.filter((l) => l.streamType !== "supply_chain");
  const supplyLeads = activeLeads.filter((l) => l.streamType === "supply_chain");
  const today = new Date().toISOString().split("T")[0];
  const overdueLeads = activeLeads.filter((l) => {
    const nad = String(l.nextActionDate || "");
    return nad && nad < today && !["won", "lost", "nurture", "inactive", "watchlist"].includes(String(l.stage));
  });

  const pipelineValue = activeLeads.reduce((sum, l) => sum + (typeof l.estimatedValue === "number" ? l.estimatedValue : 0), 0);
  const gradeA = activeLeads.filter((l) => l.leadGrade === "A").length;
  const gradeB = activeLeads.filter((l) => l.leadGrade === "B").length;

  // Bookings
  const pendingBookings = bookingsSnap.docs.filter((d) => d.data().status === "pending").length;
  const confirmedBookings = bookingsSnap.docs.filter((d) => d.data().status === "confirmed").length;

  // IMS
  const openIncidents = incidentsSnap.docs.filter((d) => d.data().status === "open").length;

  // Prestarts
  const completedPrestarts = prestartsSnap.docs.filter((d) => d.data().status === "completed").length;
  const prestartCompliance = prestartsSnap.size > 0
    ? Math.round((completedPrestarts / prestartsSnap.size) * 100)
    : 100;

  // Latest VANGUARD
  const latestVanguard = vanguardSnap.docs.length > 0
    ? { date: vanguardSnap.docs[0].id, ...vanguardSnap.docs[0].data() } as Record<string, unknown>
    : null;

  // Recent department reports
  const deptReports = deptReportsSnap.docs.map((d) => serializeDoc(d.id, d.data()));

  return {
    generatedAt: new Date().toISOString(),
    operations: {
      totalJobs: jobs.length,
      jobsByStatus,
      inProgressCount,
      completedAwaitingInvoice: jobsByStatus["completed"] || 0,
      completedRevenue: Math.round(completedRevenue * 100) / 100,
      closedRevenue: Math.round(closedRevenue * 100) / 100,
      pendingBookings,
      confirmedBookings,
      totalInspections: inspectionsSnap.size,
      ...(includeDetails ? { completedJobs, inProgressJobs } : {}),
    },
    salesPipeline: {
      totalLeads: activeLeads.length,
      salesLeads: salesLeads.length,
      supplyChainLeads: supplyLeads.length,
      gradeA,
      gradeB,
      pipelineValue: Math.round(pipelineValue * 100) / 100,
      overdueActions: overdueLeads.length,
      overdueLeadsSummary: overdueLeads.slice(0, 10).map((l) => ({
        company: l.companyName,
        grade: l.leadGrade,
        stage: l.stage,
        nextAction: l.nextAction,
        nextActionDate: l.nextActionDate,
      })),
    },
    accounts: {
      invoicingQueue: jobsByStatus["completed"] || 0,
      invoicingQueueValue: Math.round(completedRevenue * 100) / 100,
      closedThisPeriod: jobsByStatus["closed"] || 0,
      closedRevenue: Math.round(closedRevenue * 100) / 100,
    },
    ohs: {
      totalPrestarts: prestartsSnap.size,
      completedPrestarts,
      prestartCompliance,
      openIncidents,
    },
    latestVanguardReport: latestVanguard
      ? { date: latestVanguard.date, executiveSummary: latestVanguard.executiveSummary }
      : null,
    recentDepartmentReports: deptReports,
  };
}

async function handlePushDepartmentReport(args: Record<string, unknown>) {
  const department = String(args.department);
  const weekEnding = String(args.weekEnding);
  const report = args.report as Record<string, unknown>;
  if (!department || !weekEnding || !report) throw new Error("department, weekEnding, and report are required.");

  const db = admin.firestore();
  const docId = `${department}_${weekEnding}`;
  await db.collection(COLLECTIONS.DEPARTMENT_REPORTS).doc(docId).set({
    department,
    weekEnding,
    report,
    submittedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ok: true, reportId: docId, department, weekEnding };
}

async function handleGetDepartmentReports(args: Record<string, unknown>) {
  const db = admin.firestore();
  const limit = safeLimit(args.limit, 20, 50);
  let q: FirebaseFirestore.Query = db.collection(COLLECTIONS.DEPARTMENT_REPORTS)
    .orderBy("submittedAt", "desc")
    .limit(limit);

  const snap = await q.get();
  let docs = snap.docs.map((d) => serializeDoc(d.id, d.data()));

  if (typeof args.department === "string") {
    docs = docs.filter((d) => d.department === args.department);
  }
  if (typeof args.weekEnding === "string") {
    docs = docs.filter((d) => d.weekEnding === args.weekEnding);
  }

  return docs;
}

async function handlePushExecutiveReport(args: Record<string, unknown>) {
  const weekEnding = String(args.weekEnding);
  const report = args.report as Record<string, unknown>;
  if (!weekEnding || !report) throw new Error("weekEnding and report are required.");

  const db = admin.firestore();
  await db.collection(COLLECTIONS.EXECUTIVE_REPORTS).doc(weekEnding).set({
    weekEnding,
    report,
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ok: true, weekEnding };
}

async function handleGetExecutiveReports(args: Record<string, unknown>) {
  const db = admin.firestore();
  const limit = safeLimit(args.limit, 4, 12);
  const snap = await db.collection(COLLECTIONS.EXECUTIVE_REPORTS)
    .orderBy("weekEnding", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((d) => serializeDoc(d.id, d.data()));
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "get_jobs":             return handleGetJobs(args);
    case "get_job":              return handleGetJob(args);
    case "update_job":           return handleUpdateJob(args);
    case "get_bookings":         return handleGetBookings(args);
    case "get_inspections":      return handleGetInspections(args);
    case "get_ims_documents":    return handleGetImsDocuments(args);
    case "get_ims_document":     return handleGetImsDocument(args);
    case "get_ims_incidents":    return handleGetImsIncidents(args);
    case "create_ims_incident":  return handleCreateImsIncident(args);
    case "update_ims_incident":  return handleUpdateImsIncident(args);
    case "get_ims_audits":       return handleGetImsAudits(args);
    case "get_ims_audit":        return handleGetImsAudit(args);
    case "create_ims_audit":     return handleCreateImsAudit(args);
    case "update_ims_audit":     return handleUpdateImsAudit(args);
    case "get_ims_corrective_actions": return handleGetImsCorrActions(args);
    case "create_ims_corrective_action": return handleCreateImsCorrAction(args);
    case "update_ims_corrective_action": return handleUpdateImsCorrAction(args);
    case "get_ims_risk_register": return handleGetImsRiskRegister(args);
    case "create_ims_risk_entry": return handleCreateImsRiskEntry(args);
    case "update_ims_risk_entry": return handleUpdateImsRiskEntry(args);
    case "get_works_register":   return handleGetWorksRegister(args);
    case "get_dashboard_metrics": return handleGetDashboardMetrics();
    case "create_ims_document_draft": return handleCreateImsDocumentDraft(args);
    case "update_ims_document":  return handleUpdateImsDocument(args);
    // Sales pipeline
    case "get_leads":            return handleGetLeads(args);
    case "get_pipeline_stats":   return handleGetPipelineStats(args);
    case "create_lead":          return handleCreateLead(args);
    case "update_lead_stage":    return handleUpdateLeadStage(args);
    case "log_outreach_event":   return handleLogOutreachEvent(args);
    case "enrich_pipeline_from_osint": return handleEnrichPipelineFromOsint(args);
    case "import_leads_from_osint": return handleImportLeadsFromOsint(args);
    case "ingest_osint_scan":    return handleIngestOsintScan(args);
    case "push_vanguard_report": return handlePushVanguardReport(args);
    case "get_vanguard_report":  return handleGetVanguardReport(args);
    case "get_vanguard_reports": return handleGetVanguardReports(args);
    // Xero accounting
    case "xero_status":          return handleXeroStatus();
    case "xero_create_invoice":  return handleXeroCreateInvoice(args);
    case "xero_send_invoice":    return handleXeroSendInvoice(args);
    case "xero_get_invoice":     return handleXeroGetInvoice(args);
    case "xero_list_contacts":   return handleXeroListContacts(args);
    case "xero_attach_job_report": return handleXeroAttachJobReport(args);
    case "close_out_job":        return handleCloseOutJob(args);
    // Executive / Chief of Staff
    case "get_company_overview": return handleGetCompanyOverview(args);
    case "push_department_report": return handlePushDepartmentReport(args);
    case "get_department_reports": return handleGetDepartmentReports(args);
    case "push_executive_report": return handlePushExecutiveReport(args);
    case "get_executive_reports": return handleGetExecutiveReports(args);
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
