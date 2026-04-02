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
  xeroAttachFileToInvoice, xeroSetInvoiceRecipients, xeroCreateBill,
  xeroCreatePurchaseOrder, xeroSendPurchaseOrder, xeroGetPurchaseOrder,
  xeroListItems, xeroGetItem,
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
      "Full turnkey job close-out: creates a Xero invoice from job data, attaches the Completed Job Report PDF, optionally sends the invoice, then closes the job in the portal. Invoice emails are targeted to the job's contact email PLUS the organisation's accounts department email (if set via accountsEmail on the org, or a billing-role contact). This is the single-call workflow for LEDGER agents.",
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
  // ─── Xero Purchase Orders & Items ────────────────────────────────────────────
  {
    name: "xero_create_purchase_order",
    description: "Create a DRAFT purchase order in Xero for a supplier. Line items should reference Xero item codes where possible.",
    inputSchema: {
      type: "object",
      properties: {
        contactName: { type: "string", description: "Supplier name (must match Xero contact or will be created)." },
        reference: { type: "string", description: "PO reference (e.g. 'PO-ASI-2026-001')." },
        deliveryDate: { type: "string", description: "Expected delivery date (ISO date)." },
        lineItems: {
          type: "array",
          items: {
            type: "object",
            properties: {
              itemCode: { type: "string", description: "Xero item code (from xero_list_items)." },
              description: { type: "string" },
              quantity: { type: "number" },
              unitAmount: { type: "number", description: "Cost per unit, ex-GST." },
              accountCode: { type: "string", description: "Xero account code (default '300' = Purchases)." },
            },
            required: ["description", "quantity", "unitAmount"],
          },
        },
      },
      required: ["contactName", "lineItems"],
    },
  },
  {
    name: "xero_send_purchase_order",
    description: "Approve a DRAFT purchase order and email it to the supplier.",
    inputSchema: {
      type: "object",
      properties: {
        purchaseOrderId: { type: "string", description: "Xero PurchaseOrderID (UUID)." },
      },
      required: ["purchaseOrderId"],
    },
  },
  {
    name: "xero_get_purchase_order",
    description: "Get details of a Xero purchase order by its ID.",
    inputSchema: {
      type: "object",
      properties: {
        purchaseOrderId: { type: "string", description: "Xero PurchaseOrderID (UUID)." },
      },
      required: ["purchaseOrderId"],
    },
  },
  {
    name: "xero_list_items",
    description: "List products/items from Xero's inventory catalogue. Use to find item codes, cost prices, and supplier info for purchase orders.",
    inputSchema: {
      type: "object",
      properties: {
        searchTerm: { type: "string", description: "Partial name match (e.g. 'HydroGuard')." },
      },
    },
  },
  {
    name: "xero_get_item",
    description: "Get full details of a single Xero inventory item by code or ID.",
    inputSchema: {
      type: "object",
      properties: {
        identifier: { type: "string", description: "Xero item code or ItemID." },
      },
      required: ["identifier"],
    },
  },
  {
    name: "xero_create_bill",
    description:
      "Create a supplier bill (accounts payable) in Xero. This is the AP counterpart to xero_create_invoice (AR). Optionally authorise and record payment in one call. Use for recording supplier invoices, goods received costs, and expense tracking.",
    inputSchema: {
      type: "object",
      properties: {
        contactName: { type: "string", description: "Supplier name (must match Xero contact or will be created)." },
        contactEmail: { type: "string", description: "Supplier email (optional, used if creating a new contact)." },
        reference: { type: "string", description: "Supplier invoice number (e.g. 'H1126356')." },
        date: { type: "string", description: "Bill date (ISO date, e.g. '2026-04-01')." },
        dueDate: { type: "string", description: "Due date (ISO date)." },
        lineItems: {
          type: "array",
          description: "Bill line items.",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              quantity: { type: "number" },
              unitAmount: { type: "number", description: "Cost per unit, ex-GST." },
              accountCode: { type: "string", description: "Xero account code (default '310' = Cost of Goods Sold)." },
              taxType: { type: "string", description: "Xero tax type (default 'INPUT' = GST on Expenses)." },
              itemCode: { type: "string", description: "Xero catalogue item code (optional)." },
            },
            required: ["description", "quantity", "unitAmount"],
          },
        },
        status: { type: "string", enum: ["DRAFT", "AUTHORISED"], description: "Bill status (default 'DRAFT'). Set to 'AUTHORISED' to approve immediately." },
        paidDate: { type: "string", description: "If provided, records a payment on this date (marks bill as PAID). Requires status 'AUTHORISED'." },
        paidAccount: { type: "string", description: "Payment account name in Xero (e.g. 'Mastercard', 'ANZ Business Account'). Required if paidDate is set." },
      },
      required: ["contactName", "reference", "date", "dueDate", "lineItems"],
    },
  },
  // ─── Portal Stock & Procurement tools ───────────────────────────────────────
  {
    name: "get_stock_items",
    description: "List stock items from ASI Portal with current quantities and reorder thresholds. Returns only active items by default.",
    inputSchema: {
      type: "object",
      properties: {
        belowReorder: { type: "boolean", description: "If true, only return items below their reorder threshold." },
        limit: { type: "number", description: "Max items (default 50, max 200)." },
        includeArchived: { type: "boolean", description: "If true, include archived and discontinued items (default false — active only)." },
      },
    },
  },
  {
    name: "update_stock_item",
    description: "Update a stock item's quantity, reorder threshold, or supplier info.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Stock item Firestore ID." },
        updates: {
          type: "object",
          description: "Fields: quantity, reorderThreshold, reorderQuantity, supplierName, xeroItemCode, notes, status (active/archived/discontinued).",
        },
      },
      required: ["id", "updates"],
    },
  },
  {
    name: "create_goods_received",
    description: "Log a goods received record against a purchase order. Updates stock levels for received items.",
    inputSchema: {
      type: "object",
      properties: {
        poNumber: { type: "string", description: "Purchase order number or reference." },
        supplierName: { type: "string", description: "Supplier name." },
        receivedBy: { type: "string", description: "Name of person who received the goods." },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              stockItemId: { type: "string", description: "Portal stock item Firestore ID (optional)." },
              itemCode: { type: "string", description: "Xero item code (optional)." },
              description: { type: "string" },
              quantityOrdered: { type: "number" },
              quantityReceived: { type: "number" },
              condition: { type: "string", enum: ["good", "damaged", "short"], description: "Condition on receipt." },
              notes: { type: "string" },
            },
            required: ["description", "quantityReceived"],
          },
        },
        notes: { type: "string", description: "General notes about the delivery." },
      },
      required: ["poNumber", "supplierName", "items"],
    },
  },
  {
    name: "get_goods_received",
    description: "List goods received records.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max records (default 20, max 100)." },
      },
    },
  },
  {
    name: "check_and_draft_reorders",
    description:
      "Automated reorder check: scans all portal stock items below their reorder threshold, groups them by supplier, matches to Xero item codes, and creates DRAFT purchase orders in Xero (one PO per supplier). Returns the list of drafted POs for Josh's review. Does NOT send — drafts only. LEDGER's scheduled task calls this daily.",
    inputSchema: {
      type: "object",
      properties: {
        dryRun: { type: "boolean", description: "If true, return what WOULD be ordered without creating POs. Default false." },
        deliveryLeadDays: { type: "number", description: "Days to add to today for delivery date on POs. Default 7." },
      },
    },
  },
  {
    name: "create_stock_item",
    description: "Create a single stock item in the ASI Portal inventory. Validates against duplicate supplierPartNumber + supplierId combos.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Item description, e.g. 'Polishing Compound 4oz Tube'." },
        supplierPartNumber: { type: "string", description: "Supplier's part number, e.g. 'GW-S03101'." },
        supplierName: { type: "string", description: "Supplier name, e.g. 'Elegant IG Supply Line'." },
        supplierId: { type: "string", description: "Firestore ID from suppliers collection (optional)." },
        internalStockNumber: { type: "string", description: "Internal stock number (defaults to supplierPartNumber)." },
        category: { type: "string", description: "Item category, e.g. 'GForce Scratch Removal Consumables'." },
        itemType: { type: "string", enum: ["consumable", "plant"], description: "Item type: consumable or plant." },
        quantityOnHand: { type: "number", description: "Current quantity on hand (default 0)." },
        reorderThreshold: { type: "number", description: "Quantity at which reorder is triggered (default 0)." },
        reorderQuantity: { type: "number", description: "Quantity to order when below threshold (default 0)." },
        unit: { type: "string", description: "Unit of measure (default 'Ea')." },
        costPrice: { type: "number", description: "Cost price ex-GST from supplier price list." },
        xeroItemCode: { type: "string", description: "Xero catalogue item code (warns if not found in Xero)." },
        lookupKey: { type: "string", description: "Quick search key, e.g. 'GWS03101'." },
        notes: { type: "string", description: "Free text notes." },
      },
      required: ["description", "supplierPartNumber", "supplierName", "category", "itemType"],
    },
  },
  {
    name: "bulk_create_stock_items",
    description: "Create multiple stock items in one call. Validates all items first, then batch-writes. Supports duplicate skipping.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "Array of stock item objects matching create_stock_item schema (description, supplierPartNumber, supplierName, category, itemType required per item).",
          items: { type: "object" },
        },
        skipDuplicates: { type: "boolean", description: "If true (default), skip items where supplierPartNumber already exists for that supplier." },
      },
      required: ["items"],
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
          enum: ["ledger", "sentinel", "vanguard", "osint", "operations", "chief_of_staff", "cipher", "guardian"],
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
  // ─── Meetings ───────────────────────────────────────────────────────────────
  {
    name: "get_meetings",
    description: "List meetings from ASI Portal. Optionally filter by status or type.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["draft","scheduled","in_progress","completed","cancelled"], description: "Filter by status" },
        meetingType: { type: "string", description: "Filter by meeting type" },
        limit: { type: "number", description: "Max results (default 20)" },
      },
    },
  },
  {
    name: "get_meeting",
    description: "Get a single meeting by its Firestore document ID.",
    inputSchema: {
      type: "object",
      properties: { meetingId: { type: "string", description: "Meeting document ID" } },
      required: ["meetingId"],
    },
  },
  {
    name: "create_meeting",
    description: "Create a new scheduled meeting.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        meetingType: { type: "string", enum: ["management_review","startup","whs_committee","department","project","incident_review","custom"] },
        scheduledDate: { type: "string", description: "ISO 8601 date string" },
        scheduledDuration: { type: "number", description: "Duration in minutes" },
        location: { type: "string" },
        chairName: { type: "string" },
        chairEmail: { type: "string" },
      },
      required: ["title", "meetingType", "scheduledDate"],
    },
  },
  {
    name: "update_meeting",
    description: "Update fields on an existing meeting.",
    inputSchema: {
      type: "object",
      properties: {
        meetingId: { type: "string" },
        status: { type: "string", enum: ["draft","scheduled","in_progress","completed","cancelled"] },
        summary: { type: "string" },
        location: { type: "string" },
        attachments: { type: "array", description: "Array of {id, name, url} file attachments", items: { type: "object" } },
      },
      required: ["meetingId"],
    },
  },
  {
    name: "get_meeting_actions",
    description: "List meeting action items with optional filters.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["open","in_progress","completed","overdue","cancelled"] },
        meetingId: { type: "string" },
        overdueOnly: { type: "boolean" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "create_meeting_action",
    description: "Create a new action item linked to a meeting.",
    inputSchema: {
      type: "object",
      properties: {
        meetingId: { type: "string" },
        meetingNumber: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        assigneeName: { type: "string" },
        assigneeEmail: { type: "string" },
        dueDate: { type: "string", description: "ISO 8601 date" },
        priority: { type: "string", enum: ["low","medium","high","critical"] },
      },
      required: ["meetingId", "meetingNumber", "title", "assigneeName", "dueDate"],
    },
  },
  {
    name: "update_meeting_action",
    description: "Update a meeting action item status or closure notes.",
    inputSchema: {
      type: "object",
      properties: {
        actionId: { type: "string" },
        status: { type: "string", enum: ["open","in_progress","completed","overdue","cancelled"] },
        closureNotes: { type: "string" },
      },
      required: ["actionId"],
    },
  },
  {
    name: "attach_agent_report",
    description: "Attach an AI agent department report to a meeting.",
    inputSchema: {
      type: "object",
      properties: {
        meetingId: { type: "string" },
        department: { type: "string" },
        reportId: { type: "string" },
        reportType: { type: "string", enum: ["executive","department","vanguard"] },
        summary: { type: "string" },
      },
      required: ["meetingId", "department", "reportId", "reportType"],
    },
  },
  // ─── Film Management (APEAX OptiShield) ────────────────────────────────────
  {
    name: "create_film_installation",
    description: "Register a new protective film installation (APEAX OptiShield). Auto-calculates warranty dates, lifecycle status, and creates a warranty register entry.",
    inputSchema: {
      type: "object",
      properties: {
        filmType: { type: "string", enum: ["optishield", "grafshield", "paintshield", "radshield", "clearshield"], description: "Film product type. Use 'optishield' for APEAX Xtreme OptiShield." },
        filmProduct: { type: "string", description: "Full product name, e.g. 'APEAX Xtreme OptiShield'." },
        clientId: { type: "string", description: "Organisation Firestore ID." },
        clientName: { type: "string", description: "Organisation name." },
        assetIdentifier: { type: "string", description: "Vehicle rego, fleet number, or asset tag." },
        assetType: { type: "string", enum: ["windscreen", "side_glass", "rear_glass", "destination_panel", "headlight_lens", "body_panel", "other"], description: "Type of glass/surface the film is applied to." },
        installedDate: { type: "string", description: "ISO date of installation." },
        installedBy: { type: "string", description: "Technician name who performed the installation." },
        installedByTechId: { type: "string", description: "Technician Firestore ID (optional)." },
        installationJobId: { type: "string", description: "Link to jobs collection (optional)." },
        installationJobNumber: { type: "string", description: "Job number e.g. 'MCK-26-0023' (optional)." },
        siteLocation: { type: "object", properties: { name: { type: "string" }, address: { type: "string" } }, description: "Installation site." },
        batchNumber: { type: "string", description: "APEAX batch/lot number for traceability." },
        rollNumber: { type: "string", description: "Specific roll used." },
        assetDescription: { type: "string", description: "e.g. 'Front windscreen - Driver side'." },
        vehicleMake: { type: "string" },
        vehicleModel: { type: "string" },
        vehicleYear: { type: "number" },
        notes: { type: "string" },
      },
      required: ["filmType", "clientId", "clientName", "assetIdentifier", "assetType", "installedDate", "installedBy"],
    },
  },
  {
    name: "get_film_installation",
    description: "Get a single film installation by ID, including full warranty registration, claims, and service history.",
    inputSchema: {
      type: "object",
      properties: {
        installationId: { type: "string", description: "Firestore document ID." },
      },
      required: ["installationId"],
    },
  },
  {
    name: "get_film_installations",
    description: "List film installations with optional filters. Returns up to 200 records.",
    inputSchema: {
      type: "object",
      properties: {
        clientId: { type: "string", description: "Filter by client organisation ID." },
        filmType: { type: "string", enum: ["optishield", "grafshield", "paintshield", "radshield", "clearshield"] },
        lifecycleStatus: { type: "string", description: "Filter by lifecycle status." },
        warrantyStatus: { type: "string", description: "Filter by warranty registration status." },
        healthStatus: { type: "string", enum: ["healthy", "monitor", "at_risk", "failed", "expired"] },
        serviceDueBefore: { type: "string", description: "ISO date — find installations with services due before this date." },
        limit: { type: "number", description: "Max results (default 50, max 200)." },
      },
    },
  },
  {
    name: "update_film_installation",
    description: "Update a film installation record. Can update lifecycle status, warranty registration, add claims, etc.",
    inputSchema: {
      type: "object",
      properties: {
        installationId: { type: "string", description: "Firestore document ID." },
        filmProduct: { type: "string" },
        filmGrade: { type: "string" },
        batchNumber: { type: "string" },
        rollNumber: { type: "string" },
        assetDescription: { type: "string" },
        vehicleMake: { type: "string" },
        vehicleModel: { type: "string" },
        vehicleYear: { type: "number" },
        lifecycleStatus: { type: "string", description: "New lifecycle status." },
        notes: { type: "string" },
        status: { type: "string", enum: ["active", "archived"] },
      },
      required: ["installationId"],
    },
  },
  {
    name: "get_film_installation_timeline",
    description: "Get the full lifecycle timeline for a single film installation — installation, warranty registration, all inspections, claims, and status transitions.",
    inputSchema: {
      type: "object",
      properties: {
        installationId: { type: "string", description: "Firestore document ID." },
      },
      required: ["installationId"],
    },
  },
  {
    name: "get_films_dashboard_metrics",
    description: "Get Films Management dashboard summary — total installations, lifecycle breakdown, warranty stats, health summary, claims, upcoming services, and replacements due.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "create_film_warranty_inspection",
    description: "Start a new warranty inspection for a film installation. Links to the installation and pre-populates client/asset details.",
    inputSchema: {
      type: "object",
      properties: {
        filmInstallationId: { type: "string", description: "Firestore ID of the film installation being inspected." },
        inspectionType: { type: "string", enum: ["year_1_inspection", "year_2_inspection", "year_3_inspection", "ad_hoc_inspection", "pre_replacement"], description: "Type of inspection." },
        inspectionDate: { type: "string", description: "ISO date of the inspection." },
        inspectedBy: { type: "string", description: "Technician name." },
        inspectedByTechId: { type: "string", description: "Technician Firestore ID (optional)." },
        jobId: { type: "string", description: "Link to jobs collection if part of a job (optional)." },
        jobNumber: { type: "string", description: "Job number (optional)." },
        siteLocation: { type: "object", properties: { name: { type: "string" }, address: { type: "string" } } },
      },
      required: ["filmInstallationId", "inspectionType", "inspectionDate", "inspectedBy"],
    },
  },
  {
    name: "get_film_warranty_inspection",
    description: "Get a single film warranty inspection by ID.",
    inputSchema: {
      type: "object",
      properties: {
        inspectionId: { type: "string", description: "Firestore document ID." },
      },
      required: ["inspectionId"],
    },
  },
  {
    name: "get_film_warranty_inspections",
    description: "List film warranty inspections with optional filters.",
    inputSchema: {
      type: "object",
      properties: {
        filmInstallationId: { type: "string", description: "Filter by installation." },
        clientId: { type: "string", description: "Filter by client." },
        inspectionType: { type: "string", description: "Filter by inspection type." },
        status: { type: "string", enum: ["draft", "in_progress", "completed", "cancelled"] },
        limit: { type: "number", description: "Max results (default 50, max 200)." },
      },
    },
  },
  {
    name: "update_film_warranty_inspection",
    description: "Update a film warranty inspection during or after the field visit. Can update visual inspection QA criteria, HydroGuard service, overall condition/result, sign-offs, and more.",
    inputSchema: {
      type: "object",
      properties: {
        inspectionId: { type: "string", description: "Firestore document ID." },
        overallCondition: { type: "string", enum: ["excellent", "good", "fair", "poor", "failed"] },
        visualInspection: { type: "object", description: "Object with QA criteria: filmAdhesion, edgeLift, bubbling, delamination, opticalClarity, discolouration, scratches, pitting, staining, hydrophobicPerformance, wiperCompatibility, adasCompatibility. Each criterion: { result: 'pass'|'fail'|'monitor', details?, location?, photoUrls? } plus criterion-specific fields." },
        hydroguardService: { type: "object", description: "HydroGuard application details: { applied, productUsed?, batchNumber?, applicationMethod?, coatsApplied?, cureTimeMinutes?, surfacePrepped?, surfacePrepMethod?, notes? }" },
        overallResult: { type: "string", enum: ["pass", "conditional_pass", "fail"] },
        conditions: { type: "array", description: "Conditional pass conditions: [{ conditionType, reviewDate, severity }]" },
        failureAction: { type: "string", enum: ["warranty_claim", "replacement_recommended", "customer_advised"] },
        technicianSignOff: { type: "object", description: "{ signed, signedAt?, signedBy? }" },
        customerSignOff: { type: "object", description: "{ signed, signedAt?, signedBy?, customerComments? }" },
        status: { type: "string", enum: ["draft", "in_progress", "completed", "cancelled"] },
        notes: { type: "string" },
      },
      required: ["inspectionId"],
    },
  },
  {
    name: "complete_film_warranty_inspection",
    description: "Finalise a warranty inspection and trigger all downstream automation: update installation service history, update warranty register, calculate next service date, auto-create warranty claim on fail, update health status.",
    inputSchema: {
      type: "object",
      properties: {
        inspectionId: { type: "string", description: "Firestore document ID of the inspection to complete." },
      },
      required: ["inspectionId"],
    },
  },
  // ─── Warranty Registration & Claims (Phase 3) ──────────────────────────────
  {
    name: "register_film_warranty",
    description: "Generate a structured APEAX warranty registration email body for a film installation. Creates a Gmail draft via gmail_create_draft for Josh to review and send. Updates registration status to 'submitted'.",
    inputSchema: {
      type: "object",
      properties: {
        filmInstallationId: { type: "string", description: "Firestore ID of the film installation to register." },
        apeaxEmail: { type: "string", description: "APEAX warranty department email address (optional — returns email body if not provided)." },
      },
      required: ["filmInstallationId"],
    },
  },
  {
    name: "confirm_warranty_registration",
    description: "Mark a film installation's warranty registration as confirmed after receiving APEAX's response.",
    inputSchema: {
      type: "object",
      properties: {
        filmInstallationId: { type: "string", description: "Firestore ID of the film installation." },
        apeaxRegistrationRef: { type: "string", description: "APEAX warranty confirmation reference number." },
        notes: { type: "string", description: "Optional notes about the confirmation." },
      },
      required: ["filmInstallationId", "apeaxRegistrationRef"],
    },
  },
  {
    name: "get_warranty_register",
    description: "Get the full APEAX warranty register with optional filters.",
    inputSchema: {
      type: "object",
      properties: {
        clientId: { type: "string", description: "Filter by client." },
        registrationStatus: { type: "string", enum: ["pending", "overdue", "submitted", "confirmed", "rejected", "expired"] },
        healthStatus: { type: "string", enum: ["healthy", "monitor", "at_risk", "failed", "expired"] },
        limit: { type: "number", description: "Max results (default 100)." },
      },
    },
  },
  {
    name: "get_overdue_registrations",
    description: "Get all film installations with warranty registrations past the 30-day deadline.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "create_warranty_claim",
    description: "Create a new warranty claim against a film installation. Auto-generates claim number and adds to the installation's warrantyClaims array.",
    inputSchema: {
      type: "object",
      properties: {
        filmInstallationId: { type: "string", description: "Firestore ID of the film installation." },
        claimType: { type: "string", enum: ["defect", "premature_failure", "delamination", "discolouration", "adhesive_failure", "optical_distortion", "other"] },
        description: { type: "string", description: "Detailed description of the issue." },
        severity: { type: "string", enum: ["minor", "major", "critical"] },
        evidencePhotos: { type: "array", description: "Array of { url, caption } objects." },
        inspectionId: { type: "string", description: "Link to the inspection that triggered this claim (optional)." },
      },
      required: ["filmInstallationId", "claimType", "description", "severity"],
    },
  },
  {
    name: "get_warranty_claims",
    description: "List all warranty claims across installations with optional filters.",
    inputSchema: {
      type: "object",
      properties: {
        clientId: { type: "string", description: "Filter by client." },
        claimStatus: { type: "string", enum: ["draft", "submitted_to_apeax", "under_review", "approved", "rejected", "resolved"] },
        severity: { type: "string", enum: ["minor", "major", "critical"] },
        filmType: { type: "string" },
        limit: { type: "number", description: "Max results (default 50)." },
      },
    },
  },
  {
    name: "update_warranty_claim",
    description: "Update a warranty claim's status, APEAX response, resolution, or credit amount.",
    inputSchema: {
      type: "object",
      properties: {
        filmInstallationId: { type: "string", description: "Firestore ID of the film installation." },
        claimId: { type: "string", description: "The claimId within the warrantyClaims array." },
        claimStatus: { type: "string", enum: ["draft", "submitted_to_apeax", "under_review", "approved", "rejected", "resolved"] },
        apeaxClaimRef: { type: "string", description: "APEAX claim reference number." },
        apeaxResponseDate: { type: "string", description: "ISO date APEAX responded." },
        resolution: { type: "string", description: "Resolution details." },
        resolutionDate: { type: "string", description: "ISO date claim resolved." },
        creditAmount: { type: "number", description: "Credit amount if approved." },
        replacementInstallationId: { type: "string", description: "Link to new installation if replaced under warranty." },
        notes: { type: "string" },
      },
      required: ["filmInstallationId", "claimId"],
    },
  },
  {
    name: "submit_warranty_claim_to_apeax",
    description: "Generate a structured warranty claim email to APEAX with all evidence. Returns the email body for Josh to review. Updates claim status to 'submitted_to_apeax'.",
    inputSchema: {
      type: "object",
      properties: {
        filmInstallationId: { type: "string", description: "Firestore ID of the film installation." },
        claimId: { type: "string", description: "The claimId within the warrantyClaims array." },
        apeaxEmail: { type: "string", description: "APEAX claims email address (optional — returns email body if not provided)." },
      },
      required: ["filmInstallationId", "claimId"],
    },
  },
  // ─── Scheduling, Alerts & Integrations (Phase 4) ───────────────────────────
  {
    name: "get_films_service_schedule",
    description: "Get upcoming film services grouped by time horizon (next30Days, next90Days, overdue, replacementsDue). Each item includes installation details, service type, due date, materials needed, estimated duration, and site location. Designed for ATHENA morning brief and procurement planning.",
    inputSchema: {
      type: "object",
      properties: {
        clientId: { type: "string", description: "Filter by client (optional)." },
        daysAhead: { type: "number", description: "Look-ahead window in days (default 90, max 365)." },
      },
    },
  },
  {
    name: "get_films_expiring_soon",
    description: "Get film installations approaching end-of-warranty or replacement. Returns installations grouped by urgency: next30Days, next90Days, next180Days.",
    inputSchema: {
      type: "object",
      properties: {
        clientId: { type: "string", description: "Filter by client (optional)." },
      },
    },
  },
  {
    name: "get_client_service_batch",
    description: "Get all services due for a single client within a date range — designed for fleet batch scheduling so Josh can service multiple assets in one depot visit.",
    inputSchema: {
      type: "object",
      properties: {
        clientId: { type: "string", description: "Client organisation Firestore ID." },
        fromDate: { type: "string", description: "ISO date range start (default: today)." },
        toDate: { type: "string", description: "ISO date range end (default: today + 90 days)." },
      },
      required: ["clientId"],
    },
  },
  {
    name: "get_films_alerts",
    description: "Get all active film management alerts across the portfolio — warranty registration deadlines, service reminders, overdue services, replacement approaching, and stale claims. Designed for ATHENA morning brief integration.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_films_procurement_forecast",
    description: "Forecast HydroGuard and OptiShield film stock demand based on upcoming services and replacements. Cross-references with current stock levels from the procurement module. Designed for LEDGER agent integration.",
    inputSchema: {
      type: "object",
      properties: {
        daysAhead: { type: "number", description: "Forecast window in days (default 90)." },
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

// ─── Xero PO & Items handlers ─────────────────────────────────────────────────

async function handleXeroCreatePO(args: Record<string, unknown>) {
  return xeroCreatePurchaseOrder({
    contactName: String(args.contactName),
    reference: typeof args.reference === "string" ? args.reference : undefined,
    deliveryDate: typeof args.deliveryDate === "string" ? args.deliveryDate : undefined,
    lineItems: (args.lineItems as Array<{ itemCode?: string; description: string; quantity: number; unitAmount: number; accountCode?: string }>) || [],
  });
}

async function handleXeroSendPO(args: Record<string, unknown>) {
  return xeroSendPurchaseOrder(String(args.purchaseOrderId));
}

async function handleXeroGetPO(args: Record<string, unknown>) {
  return xeroGetPurchaseOrder(String(args.purchaseOrderId));
}

async function handleXeroListItems(args: Record<string, unknown>) {
  return xeroListItems(typeof args.searchTerm === "string" ? args.searchTerm : undefined);
}

async function handleXeroGetItem(args: Record<string, unknown>) {
  return xeroGetItem(String(args.identifier));
}

async function handleXeroCreateBill(args: Record<string, unknown>) {
  return xeroCreateBill({
    contactName: String(args.contactName),
    contactEmail: typeof args.contactEmail === "string" ? args.contactEmail : undefined,
    reference: String(args.reference),
    date: String(args.date),
    dueDate: String(args.dueDate),
    lineItems: (args.lineItems as Array<{
      description: string; quantity: number; unitAmount: number;
      accountCode?: string; taxType?: string; itemCode?: string;
    }>) || [],
    status: args.status === "AUTHORISED" ? "AUTHORISED" : "DRAFT",
    paidDate: typeof args.paidDate === "string" ? args.paidDate : undefined,
    paidAccount: typeof args.paidAccount === "string" ? args.paidAccount : undefined,
  });
}

// ─── Portal Stock & Procurement handlers ──────────────────────────────────────

async function handleGetStockItems(args: Record<string, unknown>) {
  const db = admin.firestore();
  const limit = safeLimit(args.limit, 50, 200);
  const snap = await db.collection(COLLECTIONS.STOCK_ITEMS).orderBy("updatedAt", "desc").limit(limit).get();
  let docs = snap.docs.map((d) => serializeDoc(d.id, d.data()));
  // Default to active-only unless includeArchived is true
  if (args.includeArchived !== true) {
    docs = docs.filter((d) => {
      const status = typeof d.status === "string" ? d.status : "active";
      return status === "active";
    });
  }
  if (args.belowReorder === true) {
    docs = docs.filter((d) => {
      const qty = typeof d.quantityOnHand === "number" ? d.quantityOnHand : (typeof d.quantity === "number" ? d.quantity : 0);
      const threshold = typeof d.reorderThreshold === "number" ? d.reorderThreshold : 0;
      return threshold > 0 && qty <= threshold;
    });
  }
  return docs;
}

async function handleUpdateStockItem(args: Record<string, unknown>) {
  const id = String(args.id);
  const updates = (args.updates || {}) as Record<string, unknown>;
  const db = admin.firestore();
  const ref = db.collection(COLLECTIONS.STOCK_ITEMS).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Stock item '${id}' not found.`);

  const allowed = new Set(["quantity", "reorderThreshold", "reorderQuantity", "supplierName", "xeroItemCode", "notes", "status"]);
  const validStatuses = new Set(["active", "archived", "discontinued"]);
  const payload: Record<string, unknown> = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  for (const [k, v] of Object.entries(updates)) {
    if (allowed.has(k)) {
      if (k === "status" && !validStatuses.has(String(v))) {
        throw new Error(`Invalid status '${v}'. Must be one of: active, archived, discontinued.`);
      }
      payload[k] = v;
    }
  }
  await ref.set(payload, { merge: true });
  const updated = await ref.get();
  return serializeDoc(updated.id, updated.data()!);
}

async function handleCreateGoodsReceived(args: Record<string, unknown>) {
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const items = (args.items as Array<Record<string, unknown>>) || [];

  const payload = {
    poNumber: String(args.poNumber || ""),
    supplierName: String(args.supplierName || ""),
    receivedBy: typeof args.receivedBy === "string" ? args.receivedBy : "LEDGER Agent",
    items,
    notes: typeof args.notes === "string" ? args.notes : "",
    status: "received",
    createdAt: now,
    updatedAt: now,
    createdBy: "mcp-agent",
  };

  const ref = await db.collection(COLLECTIONS.GOODS_RECEIVED).add(payload);

  // Auto-update stock levels for items with stockItemId
  for (const item of items) {
    if (typeof item.stockItemId === "string" && item.stockItemId) {
      const condition = String(item.condition || "good");
      if (condition === "good") {
        const qty = typeof item.quantityReceived === "number" ? item.quantityReceived : 0;
        if (qty > 0) {
          const stockRef = db.collection(COLLECTIONS.STOCK_ITEMS).doc(item.stockItemId);
          await stockRef.set({
            quantity: admin.firestore.FieldValue.increment(qty),
            updatedAt: now,
          }, { merge: true });
        }
      }
    }
  }

  return { ok: true, id: ref.id, poNumber: payload.poNumber, itemCount: items.length };
}

async function handleGetGoodsReceived(args: Record<string, unknown>) {
  const db = admin.firestore();
  const limit = safeLimit(args.limit, 20, 100);
  const snap = await db.collection(COLLECTIONS.GOODS_RECEIVED).orderBy("createdAt", "desc").limit(limit).get();
  return snap.docs.map((d) => serializeDoc(d.id, d.data()));
}

async function handleCreateStockItem(args: Record<string, unknown>) {
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();

  // Required fields
  const description = String(args.description || "");
  const supplierPartNumber = String(args.supplierPartNumber || "");
  const supplierName = String(args.supplierName || "");
  const category = String(args.category || "");
  const itemType = String(args.itemType || "");

  if (!description || !supplierPartNumber || !supplierName || !category || !itemType) {
    throw new Error("Missing required fields: description, supplierPartNumber, supplierName, category, itemType.");
  }
  if (itemType !== "consumable" && itemType !== "plant") {
    throw new Error("itemType must be 'consumable' or 'plant'.");
  }

  // Duplicate check: supplierPartNumber + supplierId (or supplierName if no supplierId)
  const supplierId = typeof args.supplierId === "string" ? args.supplierId : "";
  let dupQuery: admin.firestore.Query = db.collection(COLLECTIONS.STOCK_ITEMS)
    .where("supplierPartNumber", "==", supplierPartNumber);
  if (supplierId) {
    dupQuery = dupQuery.where("supplierId", "==", supplierId);
  } else {
    dupQuery = dupQuery.where("supplierName", "==", supplierName);
  }
  const dupSnap = await dupQuery.limit(1).get();
  if (!dupSnap.empty) {
    throw new Error(`Duplicate: stock item with supplierPartNumber '${supplierPartNumber}' already exists for supplier '${supplierName}'.`);
  }

  // Xero item code warning (non-blocking)
  let xeroWarning: string | undefined;
  const xeroItemCode = typeof args.xeroItemCode === "string" ? args.xeroItemCode : "";
  if (xeroItemCode) {
    try {
      await xeroGetItem(xeroItemCode);
    } catch {
      xeroWarning = `Xero item code '${xeroItemCode}' not found in Xero catalogue — item created anyway.`;
    }
  }

  const internalStockNumber = typeof args.internalStockNumber === "string" ? args.internalStockNumber : supplierPartNumber;

  const payload: Record<string, unknown> = {
    description,
    supplierPartNumber,
    supplierName,
    category,
    itemType,
    internalStockNumber,
    quantityOnHand: typeof args.quantityOnHand === "number" ? args.quantityOnHand : 0,
    reorderThreshold: typeof args.reorderThreshold === "number" ? args.reorderThreshold : 0,
    reorderQuantity: typeof args.reorderQuantity === "number" ? args.reorderQuantity : 0,
    unit: typeof args.unit === "string" ? args.unit : "Ea",
    status: "active",
    createdAt: now,
    updatedAt: now,
  };

  if (supplierId) payload.supplierId = supplierId;
  if (typeof args.costPrice === "number") payload.costPrice = args.costPrice;
  if (xeroItemCode) payload.xeroItemCode = xeroItemCode;
  if (typeof args.lookupKey === "string") payload.lookupKey = args.lookupKey;
  if (typeof args.notes === "string") payload.notes = args.notes;

  const ref = await db.collection(COLLECTIONS.STOCK_ITEMS).add(payload);
  const created = await ref.get();
  const result = serializeDoc(created.id, created.data()!);
  if (xeroWarning) (result as Record<string, unknown>).xeroWarning = xeroWarning;
  return result;
}

async function handleBulkCreateStockItems(args: Record<string, unknown>) {
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const items = (args.items as Array<Record<string, unknown>>) || [];
  const skipDuplicates = args.skipDuplicates !== false; // default true

  if (!items.length) throw new Error("items array is empty.");

  // 1. Validate all items first
  const requiredFields = ["description", "supplierPartNumber", "supplierName", "category", "itemType"];
  const validTypes = new Set(["consumable", "plant"]);
  const errors: Array<{ index: number; field?: string; error: string }> = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    for (const field of requiredFields) {
      if (!item[field] || typeof item[field] !== "string" || !String(item[field]).trim()) {
        errors.push({ index: i, field, error: `required` });
      }
    }
    if (item.itemType && !validTypes.has(String(item.itemType))) {
      errors.push({ index: i, field: "itemType", error: "must be 'consumable' or 'plant'" });
    }
    if (item.costPrice !== undefined && item.costPrice !== null && typeof item.costPrice !== "number") {
      errors.push({ index: i, field: "costPrice", error: "must be numeric" });
    }
  }

  if (errors.length > 0) {
    return { created: 0, skipped: [], errors, total: items.length };
  }

  // 2. Check for duplicates if skipDuplicates is true
  const skipped: Array<{ index: number; supplierPartNumber: string; reason: string }> = [];
  let toCreate = items;

  if (skipDuplicates) {
    // Gather all unique supplier names to query existing items
    const supplierNames = [...new Set(items.map((it) => String(it.supplierName)))];
    const existingParts = new Set<string>();

    for (const sn of supplierNames) {
      const snap = await db.collection(COLLECTIONS.STOCK_ITEMS)
        .where("supplierName", "==", sn)
        .select("supplierPartNumber")
        .get();
      for (const d of snap.docs) {
        const pn = d.data().supplierPartNumber;
        if (pn) existingParts.add(`${sn}::${pn}`);
      }
    }

    toCreate = [];
    for (let i = 0; i < items.length; i++) {
      const key = `${String(items[i].supplierName)}::${String(items[i].supplierPartNumber)}`;
      if (existingParts.has(key)) {
        skipped.push({ index: i, supplierPartNumber: String(items[i].supplierPartNumber), reason: "duplicate" });
      } else {
        toCreate.push(items[i]);
        existingParts.add(key); // prevent intra-batch dupes
      }
    }
  }

  // 3. Batch write (Firestore limit 500 per batch — well under for 83 items)
  const batch = db.batch();
  const createdIds: string[] = [];

  for (const item of toCreate) {
    const internalStockNumber = typeof item.internalStockNumber === "string" ? item.internalStockNumber : String(item.supplierPartNumber);
    const payload: Record<string, unknown> = {
      description: String(item.description),
      supplierPartNumber: String(item.supplierPartNumber),
      supplierName: String(item.supplierName),
      category: String(item.category),
      itemType: String(item.itemType),
      internalStockNumber,
      quantityOnHand: typeof item.quantityOnHand === "number" ? item.quantityOnHand : 0,
      reorderThreshold: typeof item.reorderThreshold === "number" ? item.reorderThreshold : 0,
      reorderQuantity: typeof item.reorderQuantity === "number" ? item.reorderQuantity : 0,
      unit: typeof item.unit === "string" ? item.unit : "Ea",
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    if (typeof item.supplierId === "string" && item.supplierId) payload.supplierId = item.supplierId;
    if (typeof item.costPrice === "number") payload.costPrice = item.costPrice;
    if (typeof item.xeroItemCode === "string" && item.xeroItemCode) payload.xeroItemCode = item.xeroItemCode;
    if (typeof item.lookupKey === "string" && item.lookupKey) payload.lookupKey = item.lookupKey;
    if (typeof item.notes === "string" && item.notes) payload.notes = item.notes;

    const ref = db.collection(COLLECTIONS.STOCK_ITEMS).doc();
    batch.set(ref, payload);
    createdIds.push(ref.id);
  }

  await batch.commit();

  return {
    created: createdIds.length,
    skipped: skipped.length > 0 ? skipped : undefined,
    errors: undefined,
    total: items.length,
    ids: createdIds,
  };
}

async function handleCheckAndDraftReorders(args: Record<string, unknown>) {
  const db = admin.firestore();
  const dryRun = args.dryRun === true;
  const leadDays = typeof args.deliveryLeadDays === "number" ? args.deliveryLeadDays : 7;
  const deliveryDate = new Date(Date.now() + leadDays * 86400_000).toISOString().split("T")[0];

  // 1. Find all active stock items below reorder threshold
  const stockSnap = await db.collection(COLLECTIONS.STOCK_ITEMS).limit(500).get();
  const belowThreshold = stockSnap.docs
    .map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown>))
    .filter((item) => {
      // Skip non-active items (archived, discontinued)
      const status = typeof item.status === "string" ? item.status : "active";
      if (status !== "active") return false;
      const qty = typeof item.quantityOnHand === "number" ? item.quantityOnHand : (typeof item.quantity === "number" ? item.quantity : 0);
      const threshold = typeof item.reorderThreshold === "number" ? item.reorderThreshold : 0;
      return threshold > 0 && qty <= threshold;
    });

  if (belowThreshold.length === 0) {
    return { ok: true, message: "All stock levels are above reorder thresholds.", itemsChecked: stockSnap.size, reorderNeeded: 0, purchaseOrders: [] };
  }

  // 2. Group by supplier
  const bySupplier = new Map<string, Array<Record<string, unknown>>>();
  for (const item of belowThreshold) {
    const supplier = String(item.supplierName || item.supplier || "Unknown Supplier");
    const list = bySupplier.get(supplier) || [];
    list.push(item);
    bySupplier.set(supplier, list);
  }

  // 3. Build PO line items per supplier
  const poPlans: Array<{
    supplier: string;
    lineItems: Array<{ itemCode: string; description: string; quantity: number; unitAmount: number; currentStock: number; reorderThreshold: number }>;
  }> = [];

  for (const [supplier, items] of bySupplier) {
    const lineItems = items.map((item) => {
      const currentQty = typeof item.quantity === "number" ? item.quantity : 0;
      const reorderQty = typeof item.reorderQuantity === "number" && item.reorderQuantity > 0
        ? item.reorderQuantity
        : (typeof item.reorderThreshold === "number" ? item.reorderThreshold * 2 : 10);
      const orderQty = Math.max(1, reorderQty - currentQty);

      return {
        itemCode: String(item.xeroItemCode || item.itemCode || ""),
        description: String(item.name || item.description || item.itemName || "Stock item"),
        quantity: orderQty,
        unitAmount: typeof item.costPrice === "number" ? item.costPrice : (typeof item.unitCost === "number" ? item.unitCost : 0),
        currentStock: currentQty,
        reorderThreshold: typeof item.reorderThreshold === "number" ? item.reorderThreshold : 0,
      };
    });
    poPlans.push({ supplier, lineItems });
  }

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      itemsChecked: stockSnap.size,
      reorderNeeded: belowThreshold.length,
      supplierCount: poPlans.length,
      purchaseOrders: poPlans.map((po) => ({
        supplier: po.supplier,
        lineItems: po.lineItems,
        estimatedTotal: po.lineItems.reduce((sum, li) => sum + li.quantity * li.unitAmount, 0),
      })),
    };
  }

  // 4. Create draft POs in Xero
  const createdPOs: Array<{ supplier: string; purchaseOrderId: string; purchaseOrderNumber: string; lineItemCount: number; total: number }> = [];
  const poErrors: Array<{ supplier: string; error: string }> = [];

  for (const po of poPlans) {
    try {
      const result = await xeroCreatePurchaseOrder({
        contactName: po.supplier,
        reference: `AUTO-REORDER-${new Date().toISOString().split("T")[0]}`,
        deliveryDate,
        lineItems: po.lineItems.map((li) => ({
          itemCode: li.itemCode || undefined,
          description: li.description,
          quantity: li.quantity,
          unitAmount: li.unitAmount,
          accountCode: "300",
        })),
      });
      createdPOs.push({
        supplier: po.supplier,
        purchaseOrderId: result.purchaseOrderId,
        purchaseOrderNumber: result.purchaseOrderNumber,
        lineItemCount: po.lineItems.length,
        total: po.lineItems.reduce((sum, li) => sum + li.quantity * li.unitAmount, 0),
      });
    } catch (err) {
      poErrors.push({ supplier: po.supplier, error: err instanceof Error ? err.message : "PO creation failed" });
    }
  }

  // 5. Send email notification if POs were created
  if (createdPOs.length > 0) {
    const poSummary = createdPOs
      .map((po) => `  • ${po.purchaseOrderNumber} — ${po.supplier} (${po.lineItemCount} items, $${po.total.toFixed(2)} ex-GST)`)
      .join("\n");
    const errorNote = poErrors.length > 0
      ? `\n\nErrors (${poErrors.length}):\n` + poErrors.map((e) => `  • ${e.supplier}: ${e.error}`).join("\n")
      : "";

    // DISABLED: External email notifications disabled — all notifications stay in-app only
    console.log(`[EMAIL DISABLED] Would have sent MCP reorder notification for ${createdPOs.length} PO(s)`);
  }

  return {
    ok: true,
    itemsChecked: stockSnap.size,
    reorderNeeded: belowThreshold.length,
    purchaseOrdersCreated: createdPOs.length,
    purchaseOrders: createdPOs,
    errors: poErrors.length > 0 ? poErrors : undefined,
    note: "All POs created as DRAFT. Review in Xero and call xero_send_purchase_order to approve and send.",
    emailSent: createdPOs.length > 0,
  };
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

  // 4. Resolve invoice recipients: job contact + org accounts email (if exists)
  //    For multi-contact clients (e.g. Melbourne's Cheapest Cars), we ensure
  //    the invoice goes ONLY to the contact for this specific job, plus
  //    the organisation's accounts department email if one is set.
  const invoiceRecipients: string[] = [clientEmail];
  let accountsEmail: string | undefined;

  if (job.organizationId) {
    const orgSnap = await db.collection(COLLECTIONS.CONTACT_ORGANIZATIONS).doc(job.organizationId).get();
    if (orgSnap.exists) {
      const org = orgSnap.data()!;
      // Check for dedicated accounts department email on the org
      if (org.accountsEmail && String(org.accountsEmail) !== clientEmail) {
        accountsEmail = String(org.accountsEmail);
        invoiceRecipients.push(accountsEmail);
      }
      // Fallback: check for a billing-role contact in the org
      if (!accountsEmail) {
        const billingSnap = await db
          .collection(COLLECTIONS.ORGANIZATION_CONTACTS)
          .where("organizationId", "==", job.organizationId)
          .where("role", "==", "billing")
          .where("status", "==", "active")
          .limit(1)
          .get();
        if (!billingSnap.empty) {
          const billingContact = billingSnap.docs[0].data();
          if (billingContact.email && String(billingContact.email) !== clientEmail) {
            accountsEmail = String(billingContact.email);
            invoiceRecipients.push(accountsEmail);
          }
        }
      }
    }
  }

  // 4b. Create invoice in Xero
  const invoice = await xeroCreateInvoice({
    contactName: clientName,
    contactEmail: clientEmail,
    reference: jobNumber,
    dueDate,
    lineItems,
    poNumber: poNumber || undefined,
  });

  // 5. Set invoice recipients on the Xero contact, then send
  //    This ensures Xero emails the job contact (primary) + accounts dept (CC via IncludeInEmails)
  if (!skipSend) {
    await xeroSetInvoiceRecipients(
      invoice.contactId,
      clientEmail,
      accountsEmail ? [accountsEmail] : []
    );
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
    accountsEmail: accountsEmail || null,
    invoiceRecipients,
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
    // Xero Purchase Orders & Items
    case "xero_create_purchase_order": return handleXeroCreatePO(args);
    case "xero_send_purchase_order":   return handleXeroSendPO(args);
    case "xero_get_purchase_order":    return handleXeroGetPO(args);
    case "xero_list_items":            return handleXeroListItems(args);
    case "xero_get_item":              return handleXeroGetItem(args);
    case "xero_create_bill":           return handleXeroCreateBill(args);
    // Portal Stock & Procurement
    case "get_stock_items":            return handleGetStockItems(args);
    case "update_stock_item":          return handleUpdateStockItem(args);
    case "create_stock_item":          return handleCreateStockItem(args);
    case "bulk_create_stock_items":    return handleBulkCreateStockItems(args);
    case "create_goods_received":      return handleCreateGoodsReceived(args);
    case "get_goods_received":         return handleGetGoodsReceived(args);
    case "check_and_draft_reorders": return handleCheckAndDraftReorders(args);
    // Executive / Chief of Staff
    case "get_company_overview": return handleGetCompanyOverview(args);
    case "push_department_report": return handlePushDepartmentReport(args);
    case "get_department_reports": return handleGetDepartmentReports(args);
    case "push_executive_report": return handlePushExecutiveReport(args);
    case "get_executive_reports": return handleGetExecutiveReports(args);
    // ─── Meetings ───────────────────────────────────────────────────────────
    case "get_meetings": {
      const fdb = admin.firestore();
      let q: admin.firestore.Query = fdb.collection(COLLECTIONS.MEETINGS).orderBy("scheduledDate", "desc");
      if (args.status) q = q.where("status", "==", args.status);
      if (args.meetingType) q = q.where("meetingType", "==", args.meetingType);
      q = q.limit(Number(args.limit) || 20);
      const snap = await q.get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    case "get_meeting": {
      const fdb = admin.firestore();
      const d = await fdb.collection(COLLECTIONS.MEETINGS).doc(String(args.meetingId)).get();
      if (!d.exists) return { error: "Meeting not found" };
      return { id: d.id, ...d.data() };
    }

    case "create_meeting": {
      const fdb = admin.firestore();
      // Generate meeting number
      const existing = await fdb.collection(COLLECTIONS.MEETINGS).orderBy("meetingNumber", "desc").limit(1).get();
      let seq = 1;
      if (!existing.empty) {
        const last = existing.docs[0].data().meetingNumber as string;
        const m = last.match(/MTG-\d{4}-(\d{3})/);
        if (m) seq = parseInt(m[1], 10) + 1;
      }
      const year = new Date().getFullYear();
      const meetingNumber = `MTG-${year}-${String(seq).padStart(3, "0")}`;
      const now = admin.firestore.Timestamp.now();
      const data = {
        meetingNumber,
        title: String(args.title),
        meetingType: String(args.meetingType),
        status: "scheduled",
        scheduledDate: admin.firestore.Timestamp.fromDate(new Date(String(args.scheduledDate))),
        scheduledDuration: Number(args.scheduledDuration) || 60,
        location: args.location ? String(args.location) : "",
        chair: { id: "mcp", name: String(args.chairName || "MCP Agent"), email: String(args.chairEmail || "") },
        attendees: [],
        agendaItems: [],
        agentReports: [],
        decisions: [],
        summary: "",
        createdAt: now,
        createdBy: "mcp",
        createdByName: String(args.chairName || "MCP Agent"),
        updatedAt: now,
      };
      const ref = await fdb.collection(COLLECTIONS.MEETINGS).add(data);
      return { id: ref.id, ...data };
    }

    case "update_meeting": {
      const fdb = admin.firestore();
      const updates: Record<string, unknown> = { updatedAt: admin.firestore.Timestamp.now() };
      if (args.status) updates.status = String(args.status);
      if (args.summary) updates.summary = String(args.summary);
      if (args.location) updates.location = String(args.location);
      if (args.status === "completed") updates.completedAt = admin.firestore.Timestamp.now();
      if (args.attachments && Array.isArray(args.attachments)) updates.attachments = args.attachments;
      await fdb.collection(COLLECTIONS.MEETINGS).doc(String(args.meetingId)).update(updates);
      return { success: true, meetingId: args.meetingId };
    }

    case "get_meeting_actions": {
      const fdb = admin.firestore();
      let q: admin.firestore.Query = fdb.collection(COLLECTIONS.MEETING_ACTIONS).orderBy("dueDate", "asc");
      if (args.status) q = q.where("status", "==", args.status);
      if (args.meetingId) q = q.where("meetingId", "==", args.meetingId);
      q = q.limit(Number(args.limit) || 50);
      const snap = await q.get();
      let results = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (args.overdueOnly) {
        const now = admin.firestore.Timestamp.now();
        results = results.filter((r: any) => r.dueDate && r.dueDate.toMillis() < now.toMillis() && r.status !== "completed" && r.status !== "cancelled");
      }
      return results;
    }

    case "create_meeting_action": {
      const fdb = admin.firestore();
      const now = admin.firestore.Timestamp.now();
      const data = {
        meetingId: String(args.meetingId),
        meetingNumber: String(args.meetingNumber),
        title: String(args.title),
        description: args.description ? String(args.description) : "",
        assignedTo: { id: "mcp", name: String(args.assigneeName), email: args.assigneeEmail ? String(args.assigneeEmail) : "" },
        dueDate: admin.firestore.Timestamp.fromDate(new Date(String(args.dueDate))),
        status: "open",
        priority: String(args.priority || "medium"),
        createdAt: now,
        updatedAt: now,
      };
      const ref = await fdb.collection(COLLECTIONS.MEETING_ACTIONS).add(data);
      return { id: ref.id, ...data };
    }

    case "update_meeting_action": {
      const fdb = admin.firestore();
      const updates: Record<string, unknown> = { updatedAt: admin.firestore.Timestamp.now() };
      if (args.status) updates.status = String(args.status);
      if (args.closureNotes) updates.closureNotes = String(args.closureNotes);
      if (args.status === "completed") { updates.completedAt = admin.firestore.Timestamp.now(); }
      await fdb.collection(COLLECTIONS.MEETING_ACTIONS).doc(String(args.actionId)).update(updates);
      return { success: true, actionId: args.actionId };
    }

    case "attach_agent_report": {
      const fdb = admin.firestore();
      const ref = fdb.collection(COLLECTIONS.MEETINGS).doc(String(args.meetingId));
      const snap = await ref.get();
      if (!snap.exists) return { error: "Meeting not found" };
      const existing = (snap.data()?.agentReports || []) as any[];
      existing.push({
        department: String(args.department),
        reportId: String(args.reportId),
        reportType: String(args.reportType),
        summary: args.summary ? String(args.summary) : "",
        attachedAt: admin.firestore.Timestamp.now(),
      });
      await ref.update({ agentReports: existing, updatedAt: admin.firestore.Timestamp.now() });
      return { success: true, meetingId: args.meetingId };
    }

    // ─── Film Management ──────────────────────────────────────────────────────
    case "create_film_installation":       return handleCreateFilmInstallation(args);
    case "get_film_installation":          return handleGetFilmInstallation(args);
    case "get_film_installations":         return handleGetFilmInstallations(args);
    case "update_film_installation":       return handleUpdateFilmInstallation(args);
    case "get_film_installation_timeline": return handleGetFilmInstallationTimeline(args);
    case "get_films_dashboard_metrics":    return handleGetFilmsDashboardMetrics();
    case "create_film_warranty_inspection":  return handleCreateFilmWarrantyInspection(args);
    case "get_film_warranty_inspection":     return handleGetFilmWarrantyInspection(args);
    case "get_film_warranty_inspections":    return handleGetFilmWarrantyInspections(args);
    case "update_film_warranty_inspection":  return handleUpdateFilmWarrantyInspection(args);
    case "complete_film_warranty_inspection": return handleCompleteFilmWarrantyInspection(args);
    // Film Warranty Registration & Claims (Phase 3)
    case "register_film_warranty":          return handleRegisterFilmWarranty(args);
    case "confirm_warranty_registration":   return handleConfirmWarrantyRegistration(args);
    case "get_warranty_register":           return handleGetWarrantyRegister(args);
    case "get_overdue_registrations":       return handleGetOverdueRegistrations();
    case "create_warranty_claim":           return handleCreateWarrantyClaim(args);
    case "get_warranty_claims":             return handleGetWarrantyClaims(args);
    case "update_warranty_claim":           return handleUpdateWarrantyClaim(args);
    case "submit_warranty_claim_to_apeax":  return handleSubmitWarrantyClaimToApeax(args);
    // Film Scheduling, Alerts & Integrations (Phase 4)
    case "get_films_service_schedule":     return handleGetFilmsServiceSchedule(args);
    case "get_films_expiring_soon":        return handleGetFilmsExpiringSoon(args);
    case "get_client_service_batch":       return handleGetClientServiceBatch(args);
    case "get_films_alerts":               return handleGetFilmsAlerts();
    case "get_films_procurement_forecast": return handleGetFilmsProcurementForecast(args);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── Film Management handlers ────────────────────────────────────────────────

function addDays(isoDate: string, days: number) {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function addYears(isoDate: string, years: number) {
  const d = new Date(isoDate);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().split("T")[0];
}

async function generateInstallationNumber(db: admin.firestore.Firestore, clientName: string) {
  const code = clientName
    .replace(/[^a-zA-Z]/g, "")
    .slice(0, 3)
    .toUpperCase() || "ASI";
  const yy = String(new Date().getFullYear()).slice(-2);
  const prefix = `FI-${code}-${yy}-`;

  const snap = await db.collection(COLLECTIONS.FILM_INSTALLATIONS)
    .where("installationNumber", ">=", prefix)
    .where("installationNumber", "<=", prefix + "\uf8ff")
    .orderBy("installationNumber", "desc")
    .limit(1)
    .get();

  let seq = 1;
  if (!snap.empty) {
    const last = String(snap.docs[0].data().installationNumber || "");
    const match = last.match(/-(\d{4})$/);
    if (match) seq = parseInt(match[1], 10) + 1;
  }
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

async function handleCreateFilmInstallation(args: Record<string, unknown>) {
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();

  const filmType = String(args.filmType || "");
  const clientId = String(args.clientId || "");
  const clientName = String(args.clientName || "");
  const assetIdentifier = String(args.assetIdentifier || "");
  const assetType = String(args.assetType || "");
  const installedDate = String(args.installedDate || "");
  const installedBy = String(args.installedBy || "");

  if (!filmType || !clientId || !clientName || !assetIdentifier || !assetType || !installedDate || !installedBy) {
    throw new Error("Missing required fields: filmType, clientId, clientName, assetIdentifier, assetType, installedDate, installedBy.");
  }

  const installationNumber = await generateInstallationNumber(db, clientName);
  const warrantyStartDate = installedDate;
  const warrantyEndDate = addYears(installedDate, 3);
  const expectedReplacementDate = warrantyEndDate;
  const registrationDeadline = addDays(installedDate, 30);

  const year1Due = addYears(installedDate, 1);
  const year2Due = addYears(installedDate, 2);
  const year3Due = addYears(installedDate, 3);
  const replacementDue = addYears(installedDate, 4);

  const installationPayload: Record<string, unknown> = {
    installationNumber,
    filmType,
    filmProduct: typeof args.filmProduct === "string" ? args.filmProduct : (filmType === "optishield" ? "APEAX Xtreme OptiShield" : filmType),
    clientId,
    clientName,
    assetIdentifier,
    assetType,
    installedDate,
    installedBy,
    warrantyStartDate,
    warrantyEndDate,
    expectedReplacementDate,
    lifecycleStatus: "installed",
    warrantyRegistration: {
      status: "pending",
      registrationDeadline,
    },
    warrantyClaims: [],
    serviceHistory: [],
    status: "active",
    createdAt: now,
    updatedAt: now,
    createdBy: installedBy,
  };

  // Optional fields
  if (typeof args.filmGrade === "string") installationPayload.filmGrade = args.filmGrade;
  if (typeof args.batchNumber === "string") installationPayload.batchNumber = args.batchNumber;
  if (typeof args.rollNumber === "string") installationPayload.rollNumber = args.rollNumber;
  if (typeof args.assetId === "string") installationPayload.assetId = args.assetId;
  if (typeof args.assetDescription === "string") installationPayload.assetDescription = args.assetDescription;
  if (typeof args.vehicleMake === "string") installationPayload.vehicleMake = args.vehicleMake;
  if (typeof args.vehicleModel === "string") installationPayload.vehicleModel = args.vehicleModel;
  if (typeof args.vehicleYear === "number") installationPayload.vehicleYear = args.vehicleYear;
  if (typeof args.installedByTechId === "string") installationPayload.installedByTechId = args.installedByTechId;
  if (typeof args.installationJobId === "string") installationPayload.installationJobId = args.installationJobId;
  if (typeof args.installationJobNumber === "string") installationPayload.installationJobNumber = args.installationJobNumber;
  if (args.siteLocation && typeof args.siteLocation === "object") installationPayload.siteLocation = args.siteLocation;
  if (typeof args.notes === "string") installationPayload.notes = args.notes;

  const installRef = await db.collection(COLLECTIONS.FILM_INSTALLATIONS).add(installationPayload);

  // Auto-create warranty register entry
  const registerPayload: Record<string, unknown> = {
    filmInstallationId: installRef.id,
    installationNumber,
    clientId,
    clientName,
    assetIdentifier,
    filmType,
    installedDate,
    warrantyStartDate,
    warrantyEndDate,
    registrationStatus: "pending",
    registrationDeadline,
    year1ServiceDue: year1Due,
    year1ServiceCompleted: false,
    year2ServiceDue: year2Due,
    year2ServiceCompleted: false,
    year3ServiceDue: year3Due,
    year3ServiceCompleted: false,
    replacementDue,
    replacementCompleted: false,
    totalClaims: 0,
    openClaims: 0,
    currentHealth: "healthy",
    updatedAt: now,
  };
  await db.collection(COLLECTIONS.FILM_WARRANTY_REGISTER).add(registerPayload);

  const created = await installRef.get();
  return {
    ...serializeDoc(created.id, created.data()!),
    warrantyEndDate,
    registrationDeadline,
    year1ServiceDue: year1Due,
    year2ServiceDue: year2Due,
    year3ServiceDue: year3Due,
  };
}

async function handleGetFilmInstallation(args: Record<string, unknown>) {
  const db = admin.firestore();
  const id = String(args.installationId || "");
  if (!id) throw new Error("installationId is required.");
  const snap = await db.collection(COLLECTIONS.FILM_INSTALLATIONS).doc(id).get();
  if (!snap.exists) throw new Error("Film installation not found.");
  return serializeDoc(snap.id, snap.data()!);
}

async function handleGetFilmInstallations(args: Record<string, unknown>) {
  const db = admin.firestore();
  let q: admin.firestore.Query = db.collection(COLLECTIONS.FILM_INSTALLATIONS)
    .where("status", "==", "active")
    .orderBy("installedDate", "desc");

  if (typeof args.clientId === "string") q = q.where("clientId", "==", args.clientId);
  if (typeof args.filmType === "string") q = q.where("filmType", "==", args.filmType);
  if (typeof args.lifecycleStatus === "string") q = q.where("lifecycleStatus", "==", args.lifecycleStatus);

  const limit = typeof args.limit === "number" ? Math.min(Math.max(1, args.limit), 200) : 50;
  q = q.limit(limit);

  const snap = await q.get();
  let results = snap.docs.map(d => serializeDoc(d.id, d.data()));

  // Client-side filters for fields that can't be combined with orderBy in Firestore
  if (typeof args.warrantyStatus === "string") {
    results = results.filter((r: any) => r.warrantyRegistration?.status === args.warrantyStatus);
  }
  if (typeof args.healthStatus === "string") {
    // Health is on the warranty register, but we can derive it
    const healthMap: Record<string, string[]> = {
      healthy: ["installed", "year_1_serviced", "year_2_serviced", "year_3_serviced"],
      monitor: ["year_1_serviced_monitor", "year_2_serviced_monitor", "year_3_serviced_monitor"],
      at_risk: ["warranty_claim_pending", "warranty_claim_submitted"],
      failed: ["claim_approved", "removed_early"],
      expired: ["replacement_due", "replaced"],
    };
    const statuses = healthMap[String(args.healthStatus)] || [];
    if (statuses.length > 0) results = results.filter((r: any) => statuses.includes(r.lifecycleStatus));
  }
  if (typeof args.serviceDueBefore === "string") {
    const cutoff = args.serviceDueBefore;
    results = results.filter((r: any) => {
      const status = String(r.lifecycleStatus || "");
      if (status.includes("service_due")) return true;
      // Check upcoming service dates against cutoff
      const nextService = r.serviceHistory?.length === 0 ? r.warrantyStartDate : null;
      return nextService && nextService <= cutoff;
    });
  }

  return results;
}

async function handleUpdateFilmInstallation(args: Record<string, unknown>) {
  const db = admin.firestore();
  const id = String(args.installationId || "");
  if (!id) throw new Error("installationId is required.");

  const ref = db.collection(COLLECTIONS.FILM_INSTALLATIONS).doc(id);
  const existing = await ref.get();
  if (!existing.exists) throw new Error("Film installation not found.");

  const updates: Record<string, unknown> = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };

  const allowed = [
    "filmProduct", "filmGrade", "batchNumber", "rollNumber",
    "assetDescription", "vehicleMake", "vehicleModel", "notes", "status",
  ];
  for (const key of allowed) {
    if (typeof args[key] === "string") updates[key] = args[key];
  }
  if (typeof args.vehicleYear === "number") updates.vehicleYear = args.vehicleYear;
  if (typeof args.lifecycleStatus === "string") updates.lifecycleStatus = args.lifecycleStatus;

  await ref.update(updates);

  // Sync lifecycle status to warranty register
  if (typeof args.lifecycleStatus === "string") {
    const regSnap = await db.collection(COLLECTIONS.FILM_WARRANTY_REGISTER)
      .where("filmInstallationId", "==", id).limit(1).get();
    if (!regSnap.empty) {
      const healthMap: Record<string, string> = {
        installed: "healthy", year_1_serviced: "healthy", year_2_serviced: "healthy", year_3_serviced: "healthy",
        year_1_serviced_monitor: "monitor", year_2_serviced_monitor: "monitor", year_3_serviced_monitor: "monitor",
        warranty_claim_pending: "at_risk", warranty_claim_submitted: "at_risk",
        claim_approved: "failed", removed_early: "failed",
        replacement_due: "expired", replaced: "expired",
      };
      const health = healthMap[String(args.lifecycleStatus)] || "healthy";
      await regSnap.docs[0].ref.update({
        currentHealth: health,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }

  const updated = await ref.get();
  return serializeDoc(updated.id, updated.data()!);
}

async function handleGetFilmInstallationTimeline(args: Record<string, unknown>) {
  const db = admin.firestore();
  const id = String(args.installationId || "");
  if (!id) throw new Error("installationId is required.");

  const installSnap = await db.collection(COLLECTIONS.FILM_INSTALLATIONS).doc(id).get();
  if (!installSnap.exists) throw new Error("Film installation not found.");
  const installation = serializeDoc(installSnap.id, installSnap.data()!);

  // Get all inspections for this installation
  const inspSnap = await db.collection(COLLECTIONS.FILM_WARRANTY_INSPECTIONS)
    .where("filmInstallationId", "==", id)
    .orderBy("inspectionDate", "asc")
    .get();
  const inspections = inspSnap.docs.map(d => serializeDoc(d.id, d.data()));

  // Get warranty register
  const regSnap = await db.collection(COLLECTIONS.FILM_WARRANTY_REGISTER)
    .where("filmInstallationId", "==", id).limit(1).get();
  const warrantyRegister = regSnap.empty ? null : serializeDoc(regSnap.docs[0].id, regSnap.docs[0].data());

  // Build timeline events
  const events: { date: string; type: string; description: string; status?: string }[] = [];

  const inst = installation as any;
  events.push({
    date: inst.installedDate,
    type: "installation",
    description: `Film installed by ${inst.installedBy}`,
    status: "completed",
  });

  if (inst.warrantyRegistration?.registeredDate) {
    events.push({
      date: inst.warrantyRegistration.registeredDate,
      type: "warranty_registration",
      description: `Warranty registered with APEAX${inst.warrantyRegistration.apeaxRegistrationRef ? ` (ref: ${inst.warrantyRegistration.apeaxRegistrationRef})` : ""}`,
      status: inst.warrantyRegistration.status,
    });
  } else {
    events.push({
      date: inst.warrantyRegistration?.registrationDeadline || inst.installedDate,
      type: "warranty_registration",
      description: `Warranty registration ${inst.warrantyRegistration?.status || "pending"}`,
      status: inst.warrantyRegistration?.status || "pending",
    });
  }

  // Service milestones
  const reg = warrantyRegister as any;
  if (reg) {
    events.push({
      date: reg.year1ServiceDue,
      type: "year_1_service",
      description: reg.year1ServiceCompleted ? `Year 1 service completed${reg.year1ServiceResult ? ` — ${reg.year1ServiceResult}` : ""}` : "Year 1 service due",
      status: reg.year1ServiceCompleted ? "completed" : (new Date(reg.year1ServiceDue) < new Date() ? "overdue" : "upcoming"),
    });
    events.push({
      date: reg.year2ServiceDue,
      type: "year_2_service",
      description: reg.year2ServiceCompleted ? `Year 2 service completed${reg.year2ServiceResult ? ` — ${reg.year2ServiceResult}` : ""}` : "Year 2 service due",
      status: reg.year2ServiceCompleted ? "completed" : (new Date(reg.year2ServiceDue) < new Date() ? "overdue" : "upcoming"),
    });
    events.push({
      date: reg.year3ServiceDue,
      type: "year_3_service",
      description: reg.year3ServiceCompleted ? `Year 3 service completed${reg.year3ServiceResult ? ` — ${reg.year3ServiceResult}` : ""}` : "Year 3 service due",
      status: reg.year3ServiceCompleted ? "completed" : (new Date(reg.year3ServiceDue) < new Date() ? "overdue" : "upcoming"),
    });
    events.push({
      date: reg.replacementDue,
      type: "replacement",
      description: reg.replacementCompleted ? "Film replaced" : "Replacement due",
      status: reg.replacementCompleted ? "completed" : (new Date(reg.replacementDue) < new Date() ? "overdue" : "upcoming"),
    });
  }

  // Claims
  const claims = Array.isArray(inst.warrantyClaims) ? inst.warrantyClaims : [];
  claims.forEach((claim: any) => {
    events.push({
      date: claim.claimDate,
      type: "warranty_claim",
      description: `Warranty claim ${claim.claimNumber}: ${claim.claimType} — ${claim.claimStatus}`,
      status: claim.claimStatus,
    });
  });

  events.sort((a, b) => a.date.localeCompare(b.date));

  return { installation, inspections, warrantyRegister, timeline: events };
}

async function handleGetFilmsDashboardMetrics() {
  const db = admin.firestore();

  const installSnap = await db.collection(COLLECTIONS.FILM_INSTALLATIONS)
    .where("status", "==", "active").get();
  const installations = installSnap.docs.map(d => d.data());

  const regSnap = await db.collection(COLLECTIONS.FILM_WARRANTY_REGISTER).get();
  const registers = regSnap.docs.map(d => d.data());

  const totalInstallations = installations.length;
  const byFilmType: Record<string, number> = {};
  const byLifecycleStatus: Record<string, number> = {};
  const warrantyRegistration = { pending: 0, overdue: 0, submitted: 0, confirmed: 0 };
  const healthSummary = { healthy: 0, monitor: 0, atRisk: 0, failed: 0 };
  const claimsSummary = { totalClaims: 0, openClaims: 0, approvedClaims: 0, rejectedClaims: 0 };

  installations.forEach((inst: any) => {
    byFilmType[inst.filmType] = (byFilmType[inst.filmType] || 0) + 1;
    byLifecycleStatus[inst.lifecycleStatus] = (byLifecycleStatus[inst.lifecycleStatus] || 0) + 1;

    const regStatus = inst.warrantyRegistration?.status;
    if (regStatus === "pending") warrantyRegistration.pending++;
    else if (regStatus === "overdue") warrantyRegistration.overdue++;
    else if (regStatus === "submitted") warrantyRegistration.submitted++;
    else if (regStatus === "confirmed") warrantyRegistration.confirmed++;

    const claims = Array.isArray(inst.warrantyClaims) ? inst.warrantyClaims : [];
    claimsSummary.totalClaims += claims.length;
    claims.forEach((c: any) => {
      if (["draft", "submitted_to_apeax", "under_review"].includes(c.claimStatus)) claimsSummary.openClaims++;
      if (c.claimStatus === "approved") claimsSummary.approvedClaims++;
      if (c.claimStatus === "rejected") claimsSummary.rejectedClaims++;
    });
  });

  registers.forEach((reg: any) => {
    const h = String(reg.currentHealth || "healthy");
    if (h === "healthy") healthSummary.healthy++;
    else if (h === "monitor") healthSummary.monitor++;
    else if (h === "at_risk") healthSummary.atRisk++;
    else if (h === "failed") healthSummary.failed++;
  });

  const today = new Date().toISOString().split("T")[0];
  const d7 = addDays(today, 7);
  const d30 = addDays(today, 30);
  const d90 = addDays(today, 90);
  const d180 = addDays(today, 180);

  const upcomingServices = { next7Days: 0, next30Days: 0, next90Days: 0, overdue: 0 };
  const replacementsDue = { next30Days: 0, next90Days: 0, next180Days: 0 };

  registers.forEach((reg: any) => {
    // Check service due dates
    const serviceDates = [
      { due: reg.year1ServiceDue, completed: reg.year1ServiceCompleted },
      { due: reg.year2ServiceDue, completed: reg.year2ServiceCompleted },
      { due: reg.year3ServiceDue, completed: reg.year3ServiceCompleted },
    ];
    serviceDates.forEach(({ due, completed }) => {
      if (completed || !due) return;
      if (due < today) upcomingServices.overdue++;
      else if (due <= d7) upcomingServices.next7Days++;
      else if (due <= d30) upcomingServices.next30Days++;
      else if (due <= d90) upcomingServices.next90Days++;
    });

    if (!reg.replacementCompleted && reg.replacementDue) {
      if (reg.replacementDue <= d30) replacementsDue.next30Days++;
      else if (reg.replacementDue <= d90) replacementsDue.next90Days++;
      else if (reg.replacementDue <= d180) replacementsDue.next180Days++;
    }
  });

  return {
    totalInstallations,
    activeInstallations: totalInstallations,
    byFilmType,
    byLifecycleStatus,
    warrantyRegistration,
    healthSummary,
    claimsSummary,
    upcomingServices,
    replacementsDue,
  };
}

// ─── Film Warranty Inspection handlers ────────────────────────────────────────

async function generateInspectionNumber(db: admin.firestore.Firestore, clientName: string) {
  const code = clientName.replace(/[^a-zA-Z]/g, "").slice(0, 3).toUpperCase() || "ASI";
  const yy = String(new Date().getFullYear()).slice(-2);
  const prefix = `FWI-${code}-${yy}-`;

  const snap = await db.collection(COLLECTIONS.FILM_WARRANTY_INSPECTIONS)
    .where("inspectionNumber", ">=", prefix)
    .where("inspectionNumber", "<=", prefix + "\uf8ff")
    .orderBy("inspectionNumber", "desc")
    .limit(1)
    .get();

  let seq = 1;
  if (!snap.empty) {
    const last = String(snap.docs[0].data().inspectionNumber || "");
    const match = last.match(/-(\d{4})$/);
    if (match) seq = parseInt(match[1], 10) + 1;
  }
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

async function handleCreateFilmWarrantyInspection(args: Record<string, unknown>) {
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();

  const filmInstallationId = String(args.filmInstallationId || "");
  const inspectionType = String(args.inspectionType || "");
  const inspectionDate = String(args.inspectionDate || "");
  const inspectedBy = String(args.inspectedBy || "");

  if (!filmInstallationId || !inspectionType || !inspectionDate || !inspectedBy) {
    throw new Error("Missing required fields: filmInstallationId, inspectionType, inspectionDate, inspectedBy.");
  }

  // Fetch the installation to denormalise fields
  const installSnap = await db.collection(COLLECTIONS.FILM_INSTALLATIONS).doc(filmInstallationId).get();
  if (!installSnap.exists) throw new Error("Film installation not found.");
  const install = installSnap.data()!;

  const clientName = String(install.clientName || "");
  const inspectionNumber = await generateInspectionNumber(db, clientName);

  // Calculate film age in months
  const installedDate = new Date(String(install.installedDate || inspectionDate));
  const inspDate = new Date(inspectionDate);
  const filmAgeMonths = Math.round((inspDate.getTime() - installedDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44));

  // Determine year of warranty
  const yearMap: Record<string, number> = {
    year_1_inspection: 1, year_2_inspection: 2, year_3_inspection: 3,
    ad_hoc_inspection: Math.min(3, Math.max(1, Math.ceil(filmAgeMonths / 12))),
    pre_replacement: 3,
  };

  const payload: Record<string, unknown> = {
    inspectionNumber,
    filmInstallationId,
    installationNumber: String(install.installationNumber || ""),
    clientId: String(install.clientId || ""),
    clientName,
    assetIdentifier: String(install.assetIdentifier || ""),
    assetType: String(install.assetType || ""),
    inspectionType,
    inspectionDate,
    inspectedBy,
    yearOfWarranty: yearMap[inspectionType] || 1,
    filmAgeMonths,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    createdBy: inspectedBy,
  };

  if (typeof args.inspectedByTechId === "string") payload.inspectedByTechId = args.inspectedByTechId;
  if (typeof args.jobId === "string") payload.jobId = args.jobId;
  if (typeof args.jobNumber === "string") payload.jobNumber = args.jobNumber;
  if (args.siteLocation && typeof args.siteLocation === "object") payload.siteLocation = args.siteLocation;

  const ref = await db.collection(COLLECTIONS.FILM_WARRANTY_INSPECTIONS).add(payload);
  const created = await ref.get();
  return serializeDoc(created.id, created.data()!);
}

async function handleGetFilmWarrantyInspection(args: Record<string, unknown>) {
  const db = admin.firestore();
  const id = String(args.inspectionId || "");
  if (!id) throw new Error("inspectionId is required.");
  const snap = await db.collection(COLLECTIONS.FILM_WARRANTY_INSPECTIONS).doc(id).get();
  if (!snap.exists) throw new Error("Film warranty inspection not found.");
  return serializeDoc(snap.id, snap.data()!);
}

async function handleGetFilmWarrantyInspections(args: Record<string, unknown>) {
  const db = admin.firestore();
  let q: admin.firestore.Query = db.collection(COLLECTIONS.FILM_WARRANTY_INSPECTIONS)
    .orderBy("inspectionDate", "desc");

  if (typeof args.filmInstallationId === "string") q = q.where("filmInstallationId", "==", args.filmInstallationId);
  if (typeof args.clientId === "string") q = q.where("clientId", "==", args.clientId);
  if (typeof args.inspectionType === "string") q = q.where("inspectionType", "==", args.inspectionType);
  if (typeof args.status === "string") q = q.where("status", "==", args.status);

  const limit = typeof args.limit === "number" ? Math.min(Math.max(1, args.limit), 200) : 50;
  q = q.limit(limit);

  const snap = await q.get();
  return snap.docs.map(d => serializeDoc(d.id, d.data()));
}

async function handleUpdateFilmWarrantyInspection(args: Record<string, unknown>) {
  const db = admin.firestore();
  const id = String(args.inspectionId || "");
  if (!id) throw new Error("inspectionId is required.");

  const ref = db.collection(COLLECTIONS.FILM_WARRANTY_INSPECTIONS).doc(id);
  const existing = await ref.get();
  if (!existing.exists) throw new Error("Film warranty inspection not found.");

  const updates: Record<string, unknown> = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };

  // Direct string fields
  const stringFields = ["overallCondition", "overallResult", "failureAction", "status", "notes"];
  for (const key of stringFields) {
    if (typeof args[key] === "string") updates[key] = args[key];
  }

  // Complex object fields
  if (args.visualInspection && typeof args.visualInspection === "object") updates.visualInspection = args.visualInspection;
  if (args.hydroguardService && typeof args.hydroguardService === "object") updates.hydroguardService = args.hydroguardService;
  if (Array.isArray(args.conditions)) updates.conditions = args.conditions;
  if (args.technicianSignOff && typeof args.technicianSignOff === "object") updates.technicianSignOff = args.technicianSignOff;
  if (args.customerSignOff && typeof args.customerSignOff === "object") updates.customerSignOff = args.customerSignOff;

  await ref.update(updates);
  const updated = await ref.get();
  return serializeDoc(updated.id, updated.data()!);
}

async function handleCompleteFilmWarrantyInspection(args: Record<string, unknown>) {
  const db = admin.firestore();
  const id = String(args.inspectionId || "");
  if (!id) throw new Error("inspectionId is required.");

  const inspRef = db.collection(COLLECTIONS.FILM_WARRANTY_INSPECTIONS).doc(id);
  const inspSnap = await inspRef.get();
  if (!inspSnap.exists) throw new Error("Film warranty inspection not found.");
  const insp = inspSnap.data()!;

  if (insp.status === "completed") throw new Error("Inspection is already completed.");

  const overallResult = String(insp.overallResult || "pass");
  const inspectionType = String(insp.inspectionType || "");
  const filmInstallationId = String(insp.filmInstallationId || "");
  const inspectionDate = String(insp.inspectionDate || new Date().toISOString().split("T")[0]);
  const inspectedBy = String(insp.inspectedBy || "");
  const hydroguardApplied = Boolean(insp.hydroguardService?.applied);
  const inspectionNumber = String(insp.inspectionNumber || "");

  // Calculate next service
  let nextServiceDue: string | null = null;
  let nextServiceType: string | null = null;
  if (inspectionType === "year_1_inspection") {
    nextServiceDue = addYears(inspectionDate, 1);
    nextServiceType = "year_2_inspection";
  } else if (inspectionType === "year_2_inspection") {
    nextServiceDue = addYears(inspectionDate, 1);
    nextServiceType = "year_3_inspection";
  } else if (inspectionType === "year_3_inspection") {
    nextServiceDue = addYears(inspectionDate, 1);
    nextServiceType = "replacement";
  }

  // 1. Mark inspection as completed
  const inspUpdates: Record<string, unknown> = {
    status: "completed",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (nextServiceDue) inspUpdates.nextServiceDue = nextServiceDue;
  if (nextServiceType) inspUpdates.nextServiceType = nextServiceType;
  await inspRef.update(inspUpdates);

  // 2. Update the filmInstallation — push to serviceHistory
  const installRef = db.collection(COLLECTIONS.FILM_INSTALLATIONS).doc(filmInstallationId);
  const installSnap = await installRef.get();
  if (installSnap.exists) {
    const installData = installSnap.data()!;
    const serviceHistory = Array.isArray(installData.serviceHistory) ? [...installData.serviceHistory] : [];
    serviceHistory.push({
      serviceId: id,
      serviceType: inspectionType,
      serviceDate: inspectionDate,
      performedBy: inspectedBy,
      result: overallResult,
      hydroguardApplied,
      notes: insp.notes || "",
    });

    // Determine new lifecycle status
    let newLifecycleStatus = String(installData.lifecycleStatus || "installed");
    if (overallResult === "pass") {
      const statusMap: Record<string, string> = {
        year_1_inspection: "year_1_serviced",
        year_2_inspection: "year_2_serviced",
        year_3_inspection: "year_3_serviced",
      };
      newLifecycleStatus = statusMap[inspectionType] || newLifecycleStatus;
    } else if (overallResult === "conditional_pass") {
      const statusMap: Record<string, string> = {
        year_1_inspection: "year_1_serviced_monitor",
        year_2_inspection: "year_2_serviced_monitor",
        year_3_inspection: "year_3_serviced_monitor",
      };
      newLifecycleStatus = statusMap[inspectionType] || newLifecycleStatus;
    } else if (overallResult === "fail") {
      newLifecycleStatus = "warranty_claim_pending";
    }

    await installRef.update({
      serviceHistory,
      lifecycleStatus: newLifecycleStatus,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 4. If fail — auto-create a draft warranty claim
    if (overallResult === "fail") {
      const warrantyClaims = Array.isArray(installData.warrantyClaims) ? [...installData.warrantyClaims] : [];
      const claimSeq = warrantyClaims.length + 1;
      const claimNumber = `WC-${installData.installationNumber || "FI"}-${String(claimSeq).padStart(2, "0")}`;

      // Determine claim type from failed criteria
      let claimType = "other";
      const vi = insp.visualInspection;
      if (vi) {
        if (vi.delamination?.result === "fail") claimType = "delamination";
        else if (vi.discolouration?.result === "fail") claimType = "discolouration";
        else if (vi.filmAdhesion?.result === "fail") claimType = "adhesive_failure";
        else if (vi.opticalClarity?.result === "fail") claimType = "optical_distortion";
        else claimType = "defect";
      }

      warrantyClaims.push({
        claimId: `claim-${Date.now()}`,
        claimNumber,
        claimDate: inspectionDate,
        claimType,
        description: `Auto-generated from failed inspection ${inspectionNumber}. ${insp.failureAction ? `Action: ${insp.failureAction}` : ""}`.trim(),
        severity: "major",
        claimStatus: "draft",
        notes: `Linked to inspection ${inspectionNumber}`,
      });

      await installRef.update({
        warrantyClaims,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }

  // 3. Update the filmWarrantyRegister
  const regSnap = await db.collection(COLLECTIONS.FILM_WARRANTY_REGISTER)
    .where("filmInstallationId", "==", filmInstallationId).limit(1).get();

  if (!regSnap.empty) {
    const regRef = regSnap.docs[0].ref;
    const regUpdates: Record<string, unknown> = {
      lastInspectionDate: inspectionDate,
      lastInspectionResult: overallResult,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Mark the correct year service as completed
    if (inspectionType === "year_1_inspection") {
      regUpdates.year1ServiceCompleted = true;
      regUpdates.year1ServiceDate = inspectionDate;
      regUpdates.year1ServiceResult = overallResult;
    } else if (inspectionType === "year_2_inspection") {
      regUpdates.year2ServiceCompleted = true;
      regUpdates.year2ServiceDate = inspectionDate;
      regUpdates.year2ServiceResult = overallResult;
    } else if (inspectionType === "year_3_inspection") {
      regUpdates.year3ServiceCompleted = true;
      regUpdates.year3ServiceDate = inspectionDate;
      regUpdates.year3ServiceResult = overallResult;
    }

    // Update health
    if (overallResult === "pass") regUpdates.currentHealth = "healthy";
    else if (overallResult === "conditional_pass") regUpdates.currentHealth = "monitor";
    else if (overallResult === "fail") regUpdates.currentHealth = "at_risk";

    // Update claims count if fail
    if (overallResult === "fail") {
      const regData = regSnap.docs[0].data();
      regUpdates.totalClaims = (regData.totalClaims || 0) + 1;
      regUpdates.openClaims = (regData.openClaims || 0) + 1;
    }

    await regRef.update(regUpdates);
  }

  const completed = await inspRef.get();
  return {
    ...serializeDoc(completed.id, completed.data()!),
    downstream: {
      serviceHistoryUpdated: true,
      warrantyRegisterUpdated: !regSnap.empty,
      nextServiceDue,
      nextServiceType,
      warrantyClaimCreated: overallResult === "fail",
    },
  };
}

// ─── Warranty Registration & Claims handlers (Phase 3) ──────────────────────

async function handleRegisterFilmWarranty(args: Record<string, unknown>) {
  const db = admin.firestore();
  const id = String(args.filmInstallationId || "");
  if (!id) throw new Error("filmInstallationId is required.");

  const ref = db.collection(COLLECTIONS.FILM_INSTALLATIONS).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Film installation not found.");
  const inst = snap.data()!;

  const installationNumber = String(inst.installationNumber || "");
  const filmProduct = String(inst.filmProduct || inst.filmType || "APEAX Xtreme OptiShield");
  const installedDate = String(inst.installedDate || "");
  const clientName = String(inst.clientName || "");
  const assetIdentifier = String(inst.assetIdentifier || "");
  const assetType = String(inst.assetType || "windscreen").replace(/_/g, " ");
  const vehicleInfo = [inst.vehicleMake, inst.vehicleModel, inst.vehicleYear ? `(${inst.vehicleYear})` : ""].filter(Boolean).join(" ");
  const batchNumber = String(inst.batchNumber || "Not recorded");
  const rollNumber = String(inst.rollNumber || "Not recorded");
  const siteAddress = inst.siteLocation ? `${inst.siteLocation.name || ""} ${inst.siteLocation.address || ""}`.trim() : "Not recorded";
  const installedBy = String(inst.installedBy || "");

  const subject = `Warranty Registration — APEAX Xtreme OptiShield — ${installationNumber}`;
  const emailBody = `Dear APEAX Warranty Team,

Please register the following OptiShield installation under the
APEAX 3-Year Manufacturer's Warranty:

INSTALLER DETAILS
  Company: ASI Australia (Advanced Surface Innovations Pty Ltd)
  ABN: 30 691 799 970
  Contact: Josh Hyde
  Email: joshua@asi-australia.com.au
  Phone: 0437 087 042

INSTALLATION DETAILS
  Installation Reference: ${installationNumber}
  Film Product: ${filmProduct}
  Installation Date: ${installedDate}
  Batch Number: ${batchNumber}
  Roll Number: ${rollNumber}

ASSET DETAILS
  Client: ${clientName}
  Asset ID: ${assetIdentifier}
  Vehicle: ${vehicleInfo || "N/A"}
  Application: ${assetType}
  Location: ${siteAddress}

INSTALLED BY
  Technician: ${installedBy}

Please confirm registration and provide the warranty reference number.

Regards,
Josh Hyde
Director — ASI Australia`;

  // Update the installation registration status
  await ref.update({
    "warrantyRegistration.status": "submitted",
    "warrantyRegistration.registeredDate": new Date().toISOString().split("T")[0],
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Also update the warranty register
  const regSnap = await db.collection(COLLECTIONS.FILM_WARRANTY_REGISTER)
    .where("filmInstallationId", "==", id).limit(1).get();
  if (!regSnap.empty) {
    await regSnap.docs[0].ref.update({
      registrationStatus: "submitted",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  // If apeaxEmail provided, try to create Gmail draft
  let draftId: string | undefined;
  const apeaxEmail = typeof args.apeaxEmail === "string" ? args.apeaxEmail : "";

  return {
    registrationStatus: "submitted",
    installationNumber,
    emailSubject: subject,
    emailBody,
    emailTo: apeaxEmail || "(APEAX warranty email — provide to send)",
    draftId,
    instructions: "Review the email content above. If correct, send it to APEAX via Gmail. Once they confirm, use confirm_warranty_registration to record their reference number.",
  };
}

async function handleConfirmWarrantyRegistration(args: Record<string, unknown>) {
  const db = admin.firestore();
  const id = String(args.filmInstallationId || "");
  const apeaxRef = String(args.apeaxRegistrationRef || "");
  if (!id) throw new Error("filmInstallationId is required.");
  if (!apeaxRef) throw new Error("apeaxRegistrationRef is required.");

  const ref = db.collection(COLLECTIONS.FILM_INSTALLATIONS).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Film installation not found.");

  await ref.update({
    "warrantyRegistration.status": "confirmed",
    "warrantyRegistration.apeaxRegistrationRef": apeaxRef,
    "warrantyRegistration.registeredDate": new Date().toISOString().split("T")[0],
    ...(typeof args.notes === "string" ? { "warrantyRegistration.notes": args.notes } : {}),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Update warranty register
  const regSnap = await db.collection(COLLECTIONS.FILM_WARRANTY_REGISTER)
    .where("filmInstallationId", "==", id).limit(1).get();
  if (!regSnap.empty) {
    await regSnap.docs[0].ref.update({
      registrationStatus: "confirmed",
      apeaxRegistrationRef: apeaxRef,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  return { success: true, filmInstallationId: id, registrationStatus: "confirmed", apeaxRegistrationRef: apeaxRef };
}

async function handleGetWarrantyRegister(args: Record<string, unknown>) {
  const db = admin.firestore();
  let q: admin.firestore.Query = db.collection(COLLECTIONS.FILM_WARRANTY_REGISTER);

  if (typeof args.registrationStatus === "string") q = q.where("registrationStatus", "==", args.registrationStatus);
  if (typeof args.clientId === "string") q = q.where("clientId", "==", args.clientId);
  if (typeof args.healthStatus === "string") q = q.where("currentHealth", "==", args.healthStatus);

  const limit = typeof args.limit === "number" ? Math.min(Math.max(1, args.limit), 200) : 100;
  q = q.limit(limit);

  const snap = await q.get();
  return snap.docs.map(d => serializeDoc(d.id, d.data()));
}

async function handleGetOverdueRegistrations() {
  const db = admin.firestore();
  const today = new Date().toISOString().split("T")[0];

  // Get all installations where registration is still pending and deadline has passed
  const snap = await db.collection(COLLECTIONS.FILM_INSTALLATIONS)
    .where("status", "==", "active")
    .where("warrantyRegistration.status", "==", "pending")
    .get();

  const overdue = snap.docs
    .filter(d => {
      const deadline = String(d.data().warrantyRegistration?.registrationDeadline || "");
      return deadline && deadline < today;
    })
    .map(d => serializeDoc(d.id, d.data()));

  // Also mark them as overdue if not already
  for (const d of snap.docs) {
    const deadline = String(d.data().warrantyRegistration?.registrationDeadline || "");
    if (deadline && deadline < today) {
      await d.ref.update({
        "warrantyRegistration.status": "overdue",
        lifecycleStatus: "warranty_registration_overdue",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      // Update register too
      const regSnap = await db.collection(COLLECTIONS.FILM_WARRANTY_REGISTER)
        .where("filmInstallationId", "==", d.id).limit(1).get();
      if (!regSnap.empty) {
        await regSnap.docs[0].ref.update({
          registrationStatus: "overdue",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }
  }

  return { count: overdue.length, overdue };
}

async function handleCreateWarrantyClaim(args: Record<string, unknown>) {
  const db = admin.firestore();
  const id = String(args.filmInstallationId || "");
  const claimType = String(args.claimType || "");
  const description = String(args.description || "");
  const severity = String(args.severity || "");

  if (!id || !claimType || !description || !severity) {
    throw new Error("Missing required fields: filmInstallationId, claimType, description, severity.");
  }

  const ref = db.collection(COLLECTIONS.FILM_INSTALLATIONS).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Film installation not found.");
  const inst = snap.data()!;

  const warrantyClaims = Array.isArray(inst.warrantyClaims) ? [...inst.warrantyClaims] : [];
  const claimSeq = warrantyClaims.length + 1;
  const installationNumber = String(inst.installationNumber || "FI");
  const claimNumber = `WC-${installationNumber}-${String(claimSeq).padStart(2, "0")}`;
  const claimDate = new Date().toISOString().split("T")[0];

  const claim: Record<string, unknown> = {
    claimId: `claim-${Date.now()}`,
    claimNumber,
    claimDate,
    claimType,
    description,
    severity,
    claimStatus: "draft",
  };

  if (Array.isArray(args.evidencePhotos)) claim.evidencePhotos = args.evidencePhotos;
  if (typeof args.inspectionId === "string") claim.inspectionId = args.inspectionId;

  warrantyClaims.push(claim);

  await ref.update({
    warrantyClaims,
    lifecycleStatus: "warranty_claim_pending",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Update warranty register claims count
  const regSnap = await db.collection(COLLECTIONS.FILM_WARRANTY_REGISTER)
    .where("filmInstallationId", "==", id).limit(1).get();
  if (!regSnap.empty) {
    const regData = regSnap.docs[0].data();
    await regSnap.docs[0].ref.update({
      totalClaims: (regData.totalClaims || 0) + 1,
      openClaims: (regData.openClaims || 0) + 1,
      currentHealth: "at_risk",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  return { ...claim, filmInstallationId: id, installationNumber };
}

async function handleGetWarrantyClaims(args: Record<string, unknown>) {
  const db = admin.firestore();
  let q: admin.firestore.Query = db.collection(COLLECTIONS.FILM_INSTALLATIONS)
    .where("status", "==", "active");

  if (typeof args.clientId === "string") q = q.where("clientId", "==", args.clientId);
  if (typeof args.filmType === "string") q = q.where("filmType", "==", args.filmType);

  const snap = await q.get();
  const allClaims: Record<string, unknown>[] = [];

  snap.docs.forEach(d => {
    const data = d.data();
    const claims = Array.isArray(data.warrantyClaims) ? data.warrantyClaims : [];
    claims.forEach((c: any) => {
      // Apply filters
      if (typeof args.claimStatus === "string" && c.claimStatus !== args.claimStatus) return;
      if (typeof args.severity === "string" && c.severity !== args.severity) return;

      allClaims.push({
        ...c,
        filmInstallationId: d.id,
        installationNumber: data.installationNumber,
        clientId: data.clientId,
        clientName: data.clientName,
        assetIdentifier: data.assetIdentifier,
        filmType: data.filmType,
      });
    });
  });

  const limit = typeof args.limit === "number" ? Math.min(Math.max(1, args.limit), 200) : 50;
  return allClaims.slice(0, limit);
}

async function handleUpdateWarrantyClaim(args: Record<string, unknown>) {
  const db = admin.firestore();
  const installId = String(args.filmInstallationId || "");
  const claimId = String(args.claimId || "");
  if (!installId || !claimId) throw new Error("filmInstallationId and claimId are required.");

  const ref = db.collection(COLLECTIONS.FILM_INSTALLATIONS).doc(installId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Film installation not found.");
  const inst = snap.data()!;

  const warrantyClaims = Array.isArray(inst.warrantyClaims) ? [...inst.warrantyClaims] : [];
  const claimIndex = warrantyClaims.findIndex((c: any) => c.claimId === claimId);
  if (claimIndex === -1) throw new Error(`Claim '${claimId}' not found on installation.`);

  const claim = { ...warrantyClaims[claimIndex] } as Record<string, unknown>;
  const oldStatus = String(claim.claimStatus || "");

  // Apply updates
  const claimFields = ["claimStatus", "apeaxClaimRef", "apeaxResponseDate", "resolution", "resolutionDate", "notes", "replacementInstallationId"];
  for (const key of claimFields) {
    if (typeof args[key] === "string") claim[key] = args[key];
  }
  if (typeof args.creditAmount === "number") claim.creditAmount = args.creditAmount;

  warrantyClaims[claimIndex] = claim;

  const installUpdates: Record<string, unknown> = {
    warrantyClaims,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  // If claim resolved/approved/rejected, potentially update lifecycle status
  const newStatus = String(claim.claimStatus || "");
  if (newStatus === "approved") {
    installUpdates.lifecycleStatus = "claim_approved";
  } else if (newStatus === "rejected") {
    installUpdates.lifecycleStatus = "claim_rejected";
  } else if (newStatus === "resolved") {
    // Revert to most recent serviced status based on service history
    const history = Array.isArray(inst.serviceHistory) ? inst.serviceHistory : [];
    if (history.length > 0) {
      const lastService = history[history.length - 1];
      const typeMap: Record<string, string> = {
        year_1_inspection: "year_1_serviced",
        year_2_inspection: "year_2_serviced",
        year_3_inspection: "year_3_serviced",
      };
      installUpdates.lifecycleStatus = typeMap[lastService.serviceType] || inst.lifecycleStatus;
    }
  }

  await ref.update(installUpdates);

  // Update warranty register open claims count
  const regSnap = await db.collection(COLLECTIONS.FILM_WARRANTY_REGISTER)
    .where("filmInstallationId", "==", installId).limit(1).get();
  if (!regSnap.empty) {
    const wasOpen = ["draft", "submitted_to_apeax", "under_review"].includes(oldStatus);
    const isOpen = ["draft", "submitted_to_apeax", "under_review"].includes(newStatus);
    if (wasOpen && !isOpen) {
      const regData = regSnap.docs[0].data();
      const regUpdates: Record<string, unknown> = {
        openClaims: Math.max(0, (regData.openClaims || 0) - 1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (newStatus === "approved" || newStatus === "rejected" || newStatus === "resolved") {
        // Re-evaluate health based on latest inspection result
        regUpdates.currentHealth = newStatus === "approved" ? "failed" : (regData.lastInspectionResult === "pass" ? "healthy" : "monitor");
      }
      await regSnap.docs[0].ref.update(regUpdates);
    }
  }

  return claim;
}

async function handleSubmitWarrantyClaimToApeax(args: Record<string, unknown>) {
  const db = admin.firestore();
  const installId = String(args.filmInstallationId || "");
  const claimId = String(args.claimId || "");
  if (!installId || !claimId) throw new Error("filmInstallationId and claimId are required.");

  const ref = db.collection(COLLECTIONS.FILM_INSTALLATIONS).doc(installId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Film installation not found.");
  const inst = snap.data()!;

  const warrantyClaims = Array.isArray(inst.warrantyClaims) ? [...inst.warrantyClaims] : [];
  const claimIndex = warrantyClaims.findIndex((c: any) => c.claimId === claimId);
  if (claimIndex === -1) throw new Error(`Claim '${claimId}' not found on installation.`);

  const claim = warrantyClaims[claimIndex] as Record<string, unknown>;
  const installationNumber = String(inst.installationNumber || "");
  const claimNumber = String(claim.claimNumber || "");
  const regRef = String(inst.warrantyRegistration?.apeaxRegistrationRef || "Not yet confirmed");

  const subject = `Warranty Claim — ${claimNumber} — ${installationNumber}`;
  const emailBody = `Dear APEAX Warranty Team,

We are submitting a warranty claim for the following OptiShield installation:

CLAIM DETAILS
  Claim Reference: ${claimNumber}
  Claim Date: ${claim.claimDate || new Date().toISOString().split("T")[0]}
  Defect Type: ${String(claim.claimType || "").replace(/_/g, " ")}
  Severity: ${claim.severity || "major"}
  Description: ${claim.description || ""}

INSTALLATION DETAILS
  Installation Reference: ${installationNumber}
  APEAX Registration Ref: ${regRef}
  Film Product: ${inst.filmProduct || inst.filmType || "APEAX Xtreme OptiShield"}
  Installation Date: ${inst.installedDate || ""}
  Batch Number: ${inst.batchNumber || "Not recorded"}
  Roll Number: ${inst.rollNumber || "Not recorded"}

ASSET DETAILS
  Client: ${inst.clientName || ""}
  Asset ID: ${inst.assetIdentifier || ""}
  Vehicle: ${[inst.vehicleMake, inst.vehicleModel, inst.vehicleYear].filter(Boolean).join(" ") || "N/A"}

${Array.isArray(claim.evidencePhotos) && (claim.evidencePhotos as any[]).length > 0
    ? `EVIDENCE\n  ${(claim.evidencePhotos as any[]).length} photo(s) attached — see links below:\n${(claim.evidencePhotos as any[]).map((p: any, i: number) => `  ${i + 1}. ${p.caption || "Photo"}: ${p.url}`).join("\n")}\n`
    : ""}
REQUESTED RESOLUTION
  Replacement film or credit to installer account.

INSTALLER
  ASI Australia (Advanced Surface Innovations Pty Ltd)
  ABN: 30 691 799 970
  Contact: Josh Hyde
  Email: joshua@asi-australia.com.au
  Phone: 0437 087 042

Regards,
Josh Hyde
Director — ASI Australia`;

  // Update claim status
  const updatedClaim = { ...claim, claimStatus: "submitted_to_apeax", submittedToApeaxDate: new Date().toISOString().split("T")[0] };
  warrantyClaims[claimIndex] = updatedClaim;
  await ref.update({
    warrantyClaims,
    lifecycleStatus: "warranty_claim_submitted",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    claimNumber,
    claimStatus: "submitted_to_apeax",
    emailSubject: subject,
    emailBody,
    emailTo: typeof args.apeaxEmail === "string" ? args.apeaxEmail : "(APEAX claims email — provide to send)",
    instructions: "Review the claim email above. Send via Gmail to APEAX. When they respond, use update_warranty_claim to record their decision.",
  };
}

// ─── Scheduling, Alerts & Integrations handlers (Phase 4) ───────────────────

interface ServiceScheduleItem {
  filmInstallationId: string;
  installationNumber: string;
  clientId: string;
  clientName: string;
  assetIdentifier: string;
  filmType: string;
  serviceType: string;
  dueDate: string;
  overdue: boolean;
  daysUntilDue: number;
  materialsNeeded: string[];
  estimatedDuration: string;
  siteLocation: string;
}

function buildServiceItems(
  registers: admin.firestore.DocumentData[],
  installations: Map<string, admin.firestore.DocumentData>,
  clientFilter?: string,
): ServiceScheduleItem[] {
  const today = new Date().toISOString().split("T")[0];
  const items: ServiceScheduleItem[] = [];

  registers.forEach((reg) => {
    const inst = installations.get(String(reg.filmInstallationId));
    if (!inst || inst.status !== "active") return;
    if (clientFilter && String(inst.clientId) !== clientFilter) return;

    const base = {
      filmInstallationId: String(reg.filmInstallationId),
      installationNumber: String(reg.installationNumber || inst.installationNumber || ""),
      clientId: String(inst.clientId || ""),
      clientName: String(inst.clientName || ""),
      assetIdentifier: String(inst.assetIdentifier || ""),
      filmType: String(inst.filmType || ""),
      siteLocation: inst.siteLocation ? `${inst.siteLocation.name || ""} ${inst.siteLocation.address || ""}`.trim() : "",
    };

    const checks = [
      { type: "year_1_inspection", due: String(reg.year1ServiceDue || ""), done: reg.year1ServiceCompleted, materials: ["HydroGuard Nano-Ceramic Coating"], duration: "45 minutes" },
      { type: "year_2_inspection", due: String(reg.year2ServiceDue || ""), done: reg.year2ServiceCompleted, materials: ["HydroGuard Nano-Ceramic Coating"], duration: "45 minutes" },
      { type: "year_3_inspection", due: String(reg.year3ServiceDue || ""), done: reg.year3ServiceCompleted, materials: ["HydroGuard Nano-Ceramic Coating"], duration: "45 minutes" },
      { type: "replacement", due: String(reg.replacementDue || ""), done: reg.replacementCompleted, materials: ["APEAX Xtreme OptiShield (windscreen size)", "HydroGuard Nano-Ceramic Coating"], duration: "15 minutes + removal" },
    ];

    checks.forEach(({ type, due, done, materials, duration }) => {
      if (done || !due) return;
      const daysUntilDue = Math.ceil((new Date(due).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      items.push({
        ...base,
        serviceType: type,
        dueDate: due,
        overdue: due < today,
        daysUntilDue,
        materialsNeeded: materials,
        estimatedDuration: duration,
      });
    });
  });

  items.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return items;
}

async function loadRegistersAndInstallations(db: admin.firestore.Firestore) {
  const [regSnap, instSnap] = await Promise.all([
    db.collection(COLLECTIONS.FILM_WARRANTY_REGISTER).get(),
    db.collection(COLLECTIONS.FILM_INSTALLATIONS).where("status", "==", "active").get(),
  ]);
  const installations = new Map<string, admin.firestore.DocumentData>();
  instSnap.docs.forEach(d => installations.set(d.id, d.data()));
  return { registers: regSnap.docs.map(d => d.data()), installations };
}

async function handleGetFilmsServiceSchedule(args: Record<string, unknown>) {
  const db = admin.firestore();
  const clientId = typeof args.clientId === "string" ? args.clientId : undefined;
  const daysAhead = typeof args.daysAhead === "number" ? Math.min(Math.max(1, args.daysAhead), 365) : 90;

  const { registers, installations } = await loadRegistersAndInstallations(db);
  const allItems = buildServiceItems(registers, installations, clientId);

  const today = new Date().toISOString().split("T")[0];
  const d30 = addDays(today, 30);
  const d90 = addDays(today, daysAhead);

  const overdue = allItems.filter(i => i.overdue);
  const next30Days = allItems.filter(i => !i.overdue && i.dueDate <= d30);
  const next90Days = allItems.filter(i => !i.overdue && i.dueDate > d30 && i.dueDate <= d90);
  const replacementsDue = allItems.filter(i => i.serviceType === "replacement" && i.dueDate <= d90);

  // Materials forecast
  const materialsNeeded: Record<string, number> = {};
  [...overdue, ...next30Days, ...next90Days].forEach(item => {
    item.materialsNeeded.forEach(m => {
      materialsNeeded[m] = (materialsNeeded[m] || 0) + 1;
    });
  });

  return {
    overdue,
    next30Days,
    next90Days,
    replacementsDue,
    totalUpcoming: overdue.length + next30Days.length + next90Days.length,
    materialsForecas: materialsNeeded,
  };
}

async function handleGetFilmsExpiringSoon(args: Record<string, unknown>) {
  const db = admin.firestore();
  const clientId = typeof args.clientId === "string" ? args.clientId : undefined;

  const instSnap = await db.collection(COLLECTIONS.FILM_INSTALLATIONS).where("status", "==", "active").get();
  const today = new Date().toISOString().split("T")[0];
  const d30 = addDays(today, 30);
  const d90 = addDays(today, 90);
  const d180 = addDays(today, 180);

  const next30: any[] = [];
  const next90: any[] = [];
  const next180: any[] = [];

  instSnap.docs.forEach(d => {
    const data = d.data();
    if (clientId && data.clientId !== clientId) return;
    const warrantyEnd = String(data.warrantyEndDate || "");
    if (!warrantyEnd || warrantyEnd < today) return;

    const item = {
      id: d.id,
      installationNumber: data.installationNumber,
      clientName: data.clientName,
      assetIdentifier: data.assetIdentifier,
      filmType: data.filmType,
      warrantyEndDate: warrantyEnd,
      daysRemaining: Math.ceil((new Date(warrantyEnd).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
      lifecycleStatus: data.lifecycleStatus,
    };

    if (warrantyEnd <= d30) next30.push(item);
    else if (warrantyEnd <= d90) next90.push(item);
    else if (warrantyEnd <= d180) next180.push(item);
  });

  return { next30Days: next30, next90Days: next90, next180Days: next180, total: next30.length + next90.length + next180.length };
}

async function handleGetClientServiceBatch(args: Record<string, unknown>) {
  const db = admin.firestore();
  const clientId = String(args.clientId || "");
  if (!clientId) throw new Error("clientId is required.");

  const fromDate = typeof args.fromDate === "string" ? args.fromDate : new Date().toISOString().split("T")[0];
  const toDate = typeof args.toDate === "string" ? args.toDate : addDays(fromDate, 90);

  const { registers, installations } = await loadRegistersAndInstallations(db);
  const allItems = buildServiceItems(registers, installations, clientId);

  const batchItems = allItems.filter(i => (i.overdue || (i.dueDate >= fromDate && i.dueDate <= toDate)));

  // Group by site
  const bySite: Record<string, ServiceScheduleItem[]> = {};
  batchItems.forEach(item => {
    const site = item.siteLocation || "No site specified";
    if (!bySite[site]) bySite[site] = [];
    bySite[site].push(item);
  });

  // Calculate total materials and estimated time
  const totalMaterials: Record<string, number> = {};
  let totalMinutes = 0;
  batchItems.forEach(item => {
    item.materialsNeeded.forEach(m => { totalMaterials[m] = (totalMaterials[m] || 0) + 1; });
    totalMinutes += item.serviceType === "replacement" ? 30 : 45;
  });

  const clientName = batchItems.length > 0 ? batchItems[0].clientName : "";

  return {
    clientId,
    clientName,
    dateRange: { from: fromDate, to: toDate },
    totalServices: batchItems.length,
    overdueServices: batchItems.filter(i => i.overdue).length,
    estimatedTotalTime: `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`,
    totalMaterials,
    bySite,
    services: batchItems,
    batchSchedulingNote: batchItems.length > 1
      ? `${batchItems.length} services for ${clientName} can be batched into a single depot visit.`
      : undefined,
  };
}

async function handleGetFilmsAlerts() {
  const db = admin.firestore();
  const today = new Date().toISOString().split("T")[0];
  const d7 = addDays(today, 7);
  const d14 = addDays(today, 14);
  const d30 = addDays(today, 30);
  const d60 = addDays(today, 60);
  const d90 = addDays(today, 90);

  const { registers, installations } = await loadRegistersAndInstallations(db);

  type Alert = { type: string; severity: "info" | "amber" | "red"; message: string; installationNumber: string; clientName: string; dueDate?: string; daysRemaining?: number };
  const alerts: Alert[] = [];

  // Check each installation for alerts
  const instSnap = await db.collection(COLLECTIONS.FILM_INSTALLATIONS).where("status", "==", "active").get();
  instSnap.docs.forEach(d => {
    const data = d.data();
    const regStatus = data.warrantyRegistration?.status;
    const regDeadline = String(data.warrantyRegistration?.registrationDeadline || "");
    const base = { installationNumber: String(data.installationNumber || ""), clientName: String(data.clientName || "") };

    // Warranty registration alerts
    if (regStatus === "pending" && regDeadline) {
      const daysLeft = Math.ceil((new Date(regDeadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      if (regDeadline < today) {
        alerts.push({ ...base, type: "warranty_registration_overdue", severity: "red", message: `Warranty registration overdue (deadline was ${regDeadline})`, dueDate: regDeadline, daysRemaining: daysLeft });
      } else if (regDeadline <= d7) {
        alerts.push({ ...base, type: "warranty_registration_deadline", severity: "amber", message: `Warranty registration deadline in ${daysLeft} days`, dueDate: regDeadline, daysRemaining: daysLeft });
      }
    }

    // Warranty claim pending response (14+ days since submission)
    const claims = Array.isArray(data.warrantyClaims) ? data.warrantyClaims : [];
    claims.forEach((c: any) => {
      if (c.claimStatus === "submitted_to_apeax" && c.submittedToApeaxDate) {
        const daysSince = Math.ceil((Date.now() - new Date(c.submittedToApeaxDate).getTime()) / (1000 * 60 * 60 * 24));
        if (daysSince >= 14) {
          alerts.push({ ...base, type: "claim_pending_response", severity: "amber", message: `Warranty claim ${c.claimNumber} pending APEAX response for ${daysSince} days`, daysRemaining: -daysSince });
        }
      }
    });
  });

  // Service alerts from warranty register
  registers.forEach(reg => {
    const inst = installations.get(String(reg.filmInstallationId));
    if (!inst) return;
    const base = { installationNumber: String(reg.installationNumber || ""), clientName: String(inst.clientName || "") };

    const checks = [
      { type: "annual_service", due: String(reg.year1ServiceDue || ""), done: reg.year1ServiceCompleted, label: "Year 1" },
      { type: "annual_service", due: String(reg.year2ServiceDue || ""), done: reg.year2ServiceCompleted, label: "Year 2" },
      { type: "annual_service", due: String(reg.year3ServiceDue || ""), done: reg.year3ServiceCompleted, label: "Year 3" },
    ];

    checks.forEach(({ type, due, done, label }) => {
      if (done || !due) return;
      const daysLeft = Math.ceil((new Date(due).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      if (due < today) {
        alerts.push({ ...base, type: "service_overdue", severity: "red", message: `${label} service overdue`, dueDate: due, daysRemaining: daysLeft });
      } else if (due <= d30) {
        alerts.push({ ...base, type: "service_soon", severity: "amber", message: `${label} service due in ${daysLeft} days`, dueDate: due, daysRemaining: daysLeft });
      } else if (due <= d60) {
        alerts.push({ ...base, type: "service_upcoming", severity: "info", message: `${label} service upcoming in ${daysLeft} days`, dueDate: due, daysRemaining: daysLeft });
      }
    });

    // Replacement alerts
    if (!reg.replacementCompleted && reg.replacementDue) {
      const repDue = String(reg.replacementDue);
      const daysLeft = Math.ceil((new Date(repDue).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      if (repDue <= d30) {
        alerts.push({ ...base, type: "replacement_due", severity: "amber", message: `Film replacement due in ${daysLeft} days`, dueDate: repDue, daysRemaining: daysLeft });
      } else if (repDue <= d90) {
        alerts.push({ ...base, type: "replacement_approaching", severity: "info", message: `Film replacement approaching in ${daysLeft} days`, dueDate: repDue, daysRemaining: daysLeft });
      }
    }
  });

  // Sort by severity (red first) then by days remaining
  const severityOrder: Record<string, number> = { red: 0, amber: 1, info: 2 };
  alerts.sort((a, b) => (severityOrder[a.severity] ?? 2) - (severityOrder[b.severity] ?? 2) || (a.daysRemaining ?? 0) - (b.daysRemaining ?? 0));

  return {
    totalAlerts: alerts.length,
    red: alerts.filter(a => a.severity === "red").length,
    amber: alerts.filter(a => a.severity === "amber").length,
    info: alerts.filter(a => a.severity === "info").length,
    alerts,
  };
}

async function handleGetFilmsProcurementForecast(args: Record<string, unknown>) {
  const db = admin.firestore();
  const daysAhead = typeof args.daysAhead === "number" ? Math.min(Math.max(1, args.daysAhead), 365) : 90;

  const { registers, installations } = await loadRegistersAndInstallations(db);
  const allItems = buildServiceItems(registers, installations);
  const cutoff = addDays(new Date().toISOString().split("T")[0], daysAhead);
  const upcoming = allItems.filter(i => i.overdue || i.dueDate <= cutoff);

  // Count materials needed
  const forecast: Record<string, { needed: number; perUnit: string; services: string[] }> = {};
  upcoming.forEach(item => {
    item.materialsNeeded.forEach(material => {
      if (!forecast[material]) forecast[material] = { needed: 0, perUnit: "unit", services: [] };
      forecast[material].needed++;
      forecast[material].services.push(`${item.installationNumber} (${item.serviceType.replace(/_/g, " ")})`);
    });
  });

  // Check current stock levels for HydroGuard and OptiShield
  const stockSnap = await db.collection(COLLECTIONS.STOCK_ITEMS).where("status", "==", "active").get();
  const stockLevels: Record<string, { description: string; quantityOnHand: number; reorderThreshold: number }> = {};
  stockSnap.docs.forEach(d => {
    const data = d.data();
    const desc = String(data.description || "").toLowerCase();
    if (desc.includes("hydroguard") || desc.includes("optishield") || desc.includes("opti shield") || desc.includes("nano-ceramic") || desc.includes("film")) {
      stockLevels[String(data.description)] = {
        description: String(data.description),
        quantityOnHand: Number(data.quantityOnHand) || 0,
        reorderThreshold: Number(data.reorderThreshold) || 0,
      };
    }
  });

  return {
    forecastWindow: `${daysAhead} days`,
    totalServicesInWindow: upcoming.length,
    inspections: upcoming.filter(i => i.serviceType !== "replacement").length,
    replacements: upcoming.filter(i => i.serviceType === "replacement").length,
    materialsForecast: forecast,
    currentStockLevels: stockLevels,
    recommendations: Object.entries(forecast).map(([material, data]) => {
      const matchingStock = Object.values(stockLevels).find(s => s.description.toLowerCase().includes(material.toLowerCase().split(" ")[0]));
      if (matchingStock && matchingStock.quantityOnHand < data.needed) {
        return `⚠️ ${material}: ${data.needed} needed, only ${matchingStock.quantityOnHand} in stock — reorder recommended`;
      }
      if (matchingStock) {
        return `✅ ${material}: ${data.needed} needed, ${matchingStock.quantityOnHand} in stock — sufficient`;
      }
      return `ℹ️ ${material}: ${data.needed} needed — no matching stock item found in inventory`;
    }),
  };
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
