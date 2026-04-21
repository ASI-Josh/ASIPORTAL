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
// Only the Xero helpers still used by non-Xero main-MCP tools.
// The full Xero tool surface now lives in src/lib/server/xero-mcp-tools.ts
// and is exposed via /api/xero-mcp as a separate MCP connector.
//   - xeroCreate/Send/Attach/SetRecipients: used by close_out_job
//   - xeroGetConnectionStatus: used by xero_status
//   - xeroListContacts: used by contact_lookup enrichment
//   - xeroGetItem: used by create_stock_item validation
//   - xeroCreatePurchaseOrder: used by check_and_draft_reorders
import {
  xeroCreateInvoice,
  xeroSendInvoice,
  xeroSetInvoiceRecipients,
  xeroAttachFileToInvoice,
  xeroGetConnectionStatus,
  xeroListContacts,
  xeroGetItem,
  xeroCreatePurchaseOrder,
} from "@/lib/xero";
import {
  buildGmailAuthUrl,
  gmailGetProfileForAccount,
  gmailListMessagesForAccount,
  gmailGetMessageForAccount,
  gmailGetThreadForAccount,
  gmailSendMessageForAccount,
  gmailCreateDraftForAccount,
  gmailListDraftsForAccount,
  gmailSendDraftForAccount,
  gmailListLabelsForAccount,
  gmailModifyLabelsForAccount,
  gmailTrashMessageForAccount,
} from "@/lib/server/gmail";

// ─── Runtime configuration ────────────────────────────────────────────────────
// CRITICAL:
//   - "nodejs" is required because firebase-admin does not run on Edge.
//     Without this, a cold invoke on Edge returns 500 immediately.
//   - force-dynamic stops Next from trying to cache or prerender POST
//     responses, which was surfacing as intermittent stale JSON-RPC
//     bodies and 500s after deploys.
//   - maxDuration bumps Netlify's function timeout. Several tool
//     handlers (full-tenant Xero listings, OSINT ingest, grants
//     dashboard, executive reports) regularly run past the 10s
//     default and were being killed mid-flight — that was LEDGER's
//     "intermittent timeout on status/balance calls" signature.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
    name: "schedule_ims_audit",
    description: "Schedule a future IMS internal audit (ISO 9001/14001/45001). Creates a skeleton audit record with status 'scheduled'. Use for the annual audit schedule — GUARDIAN or the Director books audits in advance, then the audit pack (plan, checklist, findings) is generated closer to the date via create_ims_audit or update_ims_audit. Optionally integrates with Google Calendar.",
    inputSchema: {
      type: "object",
      properties: {
        auditId: { type: "string", description: "Human-readable audit reference (e.g. 'AUD-2026-Q2-DOCCONTROL'). Generated if omitted." },
        standard: {
          type: "string",
          enum: ["ISO9001:2015", "ISO14001:2015", "ISO45001:2018", "Integrated"],
          description: "Which standard(s) the audit covers. 'Integrated' = all three.",
        },
        auditType: {
          type: "string",
          enum: ["internal", "external", "supplier", "management_review"],
          description: "Audit classification. Defaults to 'internal'.",
        },
        scope: { type: "string", description: "Audit scope — what will be audited (processes, clauses, sites)." },
        period: { type: "string", description: "Reporting period (e.g. 'Q2 2026', '2026 annual')." },
        plannedDate: { type: "string", description: "Scheduled date (YYYY-MM-DD)." },
        sites: { type: "array", items: { type: "string" }, description: "Sites in scope." },
        processes: { type: "array", items: { type: "string" }, description: "Processes in scope." },
        leadAuditor: { type: "string", description: "Lead auditor name (e.g. 'GUARDIAN', 'Joshua Hyde', or external auditor)." },
        scheduledBy: { type: "string", description: "Who scheduled the audit (e.g. 'Director', 'GUARDIAN')." },
        createCalendarEvent: { type: "boolean", description: "If true, attempt to create a Google Calendar event for this audit (requires calendar OAuth)." },
      },
      required: ["standard", "scope", "plannedDate", "leadAuditor"],
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
      "Create a new IMS document draft in Firestore. Returns the new document ID. Draft starts at revision 1 with approvalStatus 'draft'. For management_review type, pass meetingId and managementReview inputs/outputs.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Document title." },
        docId: { type: "string", description: "Document reference code (e.g. IMS-PROC-042)." },
        type: {
          type: "string",
          description: "Document type: procedure, policy, register, form, work_instruction, management_review, etc.",
        },
        content: { type: "string", description: "Full document content (markdown or plain text)." },
        processOwner: { type: "string", description: "Name or role of the process owner." },
        isoClauses: {
          type: "array",
          items: { type: "string" },
          description: "ISO 9001/14001/45001 clauses this document addresses (e.g. ['4.2', '7.5']).",
        },
        meetingId: { type: "string", description: "For type='management_review': link to the meetings collection doc ID." },
        managementReview: {
          type: "object",
          description: "For type='management_review': structured inputs/outputs per ISO 9.3.2/9.3.3.",
          properties: {
            meetingDate: { type: "string" }, chair: { type: "string" }, attendees: { type: "array", items: { type: "string" } },
            inputs: {
              type: "object",
              description: "ISO 9.3.2 inputs: previousActions, contextChanges, satisfaction, processPerformance, nonconformities, auditResults, risks, opportunities, resources.",
            },
            outputs: {
              type: "object",
              description: "ISO 9.3.3 outputs: improvementOpportunities, imsChanges, resourceNeeds, decisions, actionItems (linked to CAPAs where applicable).",
            },
          },
        },
        rndProjectId: {
          type: "string",
          description: "Link this IMS document to an R&D project (Firestore rndProjects doc ID). Surfaces the doc under that project in the R&D Projects filing tree on the IMS page.",
        },
        rndNominationId: {
          type: "string",
          description: "Link this IMS document to an R&D nomination (pre-feas stage). Mutually exclusive with rndProjectId — use whichever the doc belongs to.",
        },
        rndFolder: {
          type: "string",
          enum: ["pm_planning", "engineering_design", "administration", "finance", "legal", "project_filing"],
          description: "Which of the six R&D filing folders this doc belongs to. Required when rndProjectId or rndNominationId is set. Defaults to project_filing if omitted but R&D linkage is present.",
        },
        rndFinancialYear: {
          type: "string",
          description: "Australian FY string (e.g. 'FY2025-26'). Optional — if omitted, IMS derives it from createdAt when filing.",
        },
      },
      required: ["title", "type", "content"],
    },
  },
  {
    name: "update_ims_document",
    description:
      "Update fields on an existing IMS document. Auto-increments revisionNumber and appends to revisionHistory when content or title changes. Returns the updated document. To file an existing doc into the R&D Projects tree, pass updates: { rndProjectId, rndFolder, rndFinancialYear? } (or rndNominationId for pre-feas stage docs).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The IMS document Firestore ID to update." },
        updates: {
          type: "object",
          description:
            "Key-value pairs of fields to update. Allowed fields: title, content, status, processOwner, isoClauses, type, docId, rndProjectId, rndNominationId, rndFolder (pm_planning | engineering_design | administration | finance | legal | project_filing), rndFinancialYear.",
        },
        changeNote: { type: "string", description: "Brief note describing what changed (appended to revisionHistory)." },
        updatedBy: { type: "string", description: "User or agent ID performing the update." },
      },
      required: ["id", "updates"],
    },
  },
  {
    name: "submit_ims_document_for_review",
    description: "Submit an IMS document for review (draft → under_review). Only documents in 'draft' status can be submitted.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The IMS document Firestore ID." },
        submittedBy: { type: "string", description: "User or agent ID submitting for review." },
      },
      required: ["id"],
    },
  },
  {
    name: "approve_ims_document",
    description: "Approve an IMS document (under_review → approved). DIRECTOR-ONLY. Requires approverUserId, effectiveDate, and nextReviewDate. Does not activate — call activate_ims_document separately.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The IMS document Firestore ID." },
        approverUserId: { type: "string", description: "Firebase UID of the approver (must be Director)." },
        approverEmail: { type: "string", description: "Email of the approver — validated as Director." },
        effectiveDate: { type: "string", description: "ISO date when the document becomes effective (default: today)." },
        nextReviewDate: { type: "string", description: "ISO date for the next scheduled review (required)." },
      },
      required: ["id", "approverUserId", "nextReviewDate"],
    },
  },
  {
    name: "activate_ims_document",
    description: "Activate an approved IMS document (approved → active). Auto-obsoletes any prior active version with the same docId reference code.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The IMS document Firestore ID." },
      },
      required: ["id"],
    },
  },
  {
    name: "obsolete_ims_document",
    description: "Mark an active IMS document as obsolete (active → obsolete). Preserves the document for audit trail — never deletes. Requires a reason.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The IMS document Firestore ID." },
        reason: { type: "string", description: "Reason for obsoleting (required for audit trail)." },
        obsoletedBy: { type: "string", description: "User or agent ID performing the action." },
      },
      required: ["id", "reason"],
    },
  },
  {
    name: "get_ims_health_snapshot",
    description: "Return a full IMS posture snapshot: document status counts, audit stats, CAPA stats, incidents, risks, and ISO compliance score. Used by the dashboard widget and GUARDIAN reports.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "provision_auditor_access",
    description: "Grant time-limited read-only auditor access. Creates/updates a user record with role 'auditor' and sets auditorTokenExpiresAt. Default 14 days. Director-only.",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string", description: "Auditor email address." },
        name: { type: "string", description: "Auditor full name." },
        firm: { type: "string", description: "Audit firm name (for audit trail)." },
        days: { type: "number", description: "Access duration in days (default 14)." },
      },
      required: ["email", "name"],
    },
  },
  {
    name: "revoke_auditor_access",
    description: "Revoke auditor access immediately by expiring the token. Director-only.",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string", description: "Auditor email address." },
      },
      required: ["email"],
    },
  },
  {
    name: "export_ims_document_pdf",
    description: "Generate printable HTML for an IMS document in a specified format. Returns HTML ready for headless rendering to PDF. Formats: 'a3_framed' (workshop display), 'a5_laminated' (vehicle cab), 'standard' (A4).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The IMS document Firestore ID." },
        format: { type: "string", enum: ["a3_framed", "a5_laminated", "standard"], description: "Export format." },
      },
      required: ["id", "format"],
    },
  },

  // ─── Sales pipeline tools ─────────────────────────────────────────────────
  {
    name: "get_leads",
    description: "List CRM leads from the pipeline. Filter by stream (sales/supply_chain/trade_distribution), stage, grade, or sector.",
    inputSchema: {
      type: "object",
      properties: {
        streamType: {
          type: "string",
          enum: ["sales", "supply_chain", "trade_distribution"],
          description: "Filter by stream type: 'sales' (SENTINEL customers), 'supply_chain' (VANGUARD suppliers/partners), or 'trade_distribution' (SHIELD trade installer clients for APEAX films). Omit for all.",
        },
        stage: {
          type: "string",
          description: "Filter by pipeline stage. Sales: identified, researched, qualified, outreach, engaged, discovery, proposal, negotiation, won, lost, nurture. Supply chain: identified, researched, qualified, outreach, engaged, evaluation, negotiation, agreement, onboarded, inactive, watchlist. Trade distribution: identified, researched, qualified, application_review, vetting, agreement_sent, agreement_signed, onboarded, first_order, active, paused, terminated.",
        },
        grade: { type: "string", enum: ["A","B","C","D","E"], description: "Filter by lead grade." },
        sector: { type: "string", description: "Filter by sector (e.g. mass-transit, manufacturing)." },
        marketSegment: { type: "string", enum: ["heavy_vehicle", "light_vehicle", "trade"], description: "Sales stream sub-segment owner: 'heavy_vehicle' (SENTINEL), 'light_vehicle' or 'trade' (MERCER). Only meaningful when streamType=sales." },
        supplierType: { type: "string", enum: ["tier_1", "tier_2", "strategic_partner", "research_partner", "distributor", "vendor"], description: "Supply chain classification. Only meaningful when streamType=supply_chain." },
        tradePipelineGroup: { type: "string", enum: ["prospects", "in_application", "active_installers", "inactive"], description: "Trade distribution high-level group filter. Maps to pipeline stages: 'prospects' (identified/researched/qualified), 'in_application' (application_review/vetting/agreement_sent/agreement_signed), 'active_installers' (onboarded/first_order/active), 'inactive' (paused/terminated). Only meaningful when streamType=trade_distribution." },
        limit: { type: "number", description: "Max leads to return (default 50, max 200)." },
      },
    },
  },
  {
    name: "get_pipeline_stats",
    description: "Get pipeline summary with per-stream breakdowns: total leads, hot leads count, overdue follow-ups, estimated pipeline value, breakdown by stage and grade. Accepts optional streamType filter across sales, supply_chain, and trade_distribution.",
    inputSchema: {
      type: "object",
      properties: {
        streamType: {
          type: "string",
          enum: ["sales", "supply_chain", "trade_distribution"],
          description: "Filter stats to a specific stream. Omit for combined stats across all three streams.",
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
        streamType: { type: "string", enum: ["sales", "supply_chain", "trade_distribution"], description: "Stream type: 'sales' (SENTINEL/MERCER customer), 'supply_chain' (VANGUARD supplier/partner), or 'trade_distribution' (SHIELD trade installer for APEAX films). Default: sales." },
        marketSegment: { type: "string", enum: ["heavy_vehicle", "light_vehicle", "trade"], description: "Sales-stream sub-segment owner: 'heavy_vehicle' → SENTINEL (HV/Bus/Coach/Fleet), 'light_vehicle' or 'trade' → MERCER (Passenger/Trade). Only used when streamType=sales. Defaults to 'heavy_vehicle' if omitted on a sales lead." },
        supplierType: { type: "string", enum: ["tier_1", "tier_2", "strategic_partner", "research_partner", "distributor", "vendor"], description: "Supplier classification for VANGUARD's supply chain stream. Only used when streamType=supply_chain. Defaults to 'vendor' if omitted." },
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
        osintHook: { type: "string", description: "Full-sentence specific outreach hook. SENTINEL/MERCER/SHIELD daily outreach gates on this field." },
        osintHookShort: { type: "string", description: "Short version for Touch 1 subject-line / opener (max 160 chars)." },
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
  // ─── Leads Register tools ───────────────────────────────────────────────────
  {
    name: "create_leads_register_entry",
    description: "Create a new Leads Register entry. This is the pre-pipeline qualification layer — entries must be assessed and promoted before becoming CRM leads.",
    inputSchema: {
      type: "object",
      properties: {
        streamType: { type: "string", enum: ["sales", "supply_chain", "trade_distribution"], description: "Stream: 'sales' (SENTINEL), 'supply_chain' (VANGUARD), or 'trade_distribution' (SHIELD)." },
        source: {
          type: "object", description: "How this entry was sourced.",
          properties: {
            type: { type: "string", enum: ["osint", "inbound", "manual", "referral"] },
            scanDate: { type: "string", description: "ISO date of OSINT scan if applicable." },
            scanId: { type: "string" }, findingId: { type: "string" }, notes: { type: "string" },
          },
        },
        company: {
          type: "object", description: "Company details.",
          properties: {
            name: { type: "string" }, website: { type: "string" },
            sector: { type: "string", enum: ["mass-transit", "manufacturing", "wholesale-trade", "structural", "marine", "technology", "other"] },
            description: { type: "string" }, location: { type: "string" }, size: { type: "string" },
          }, required: ["name"],
        },
        contact: {
          type: "object", description: "Primary contact.",
          properties: {
            name: { type: "string" }, role: { type: "string" }, email: { type: "string" },
            phone: { type: "string" }, linkedin: { type: "string" },
          },
        },
        opportunity: {
          type: "object", description: "Opportunity details.",
          properties: {
            description: { type: "string" },
            category: { type: "string", enum: ["technology", "supplier", "partner", "distributor", "customer", "innovation", "grant", "other"] },
            potentialValue: { type: "number", description: "Estimated AUD annual value." },
            potentialValueNotes: { type: "string" },
            urgencyFlag: { type: "boolean" }, urgencyReason: { type: "string" },
          },
        },
        notes: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        status: { type: "string", enum: ["identified", "assessed", "shortlisted"], description: "Initial status (default: identified)." },
        osintHook: { type: "string", description: "Full-sentence specific outreach hook (optional at create; ATHENA typically backfills)." },
        osintHookShort: { type: "string", description: "Short outreach hook for subject-lines (max 160 chars)." },
      },
      required: ["streamType", "company"],
    },
  },
  {
    name: "get_leads_register",
    description: "List/filter Leads Register entries. Always filter by streamType — never show mixed streams.",
    inputSchema: {
      type: "object",
      properties: {
        streamType: { type: "string", enum: ["sales", "supply_chain", "trade_distribution"], description: "Required — filter by stream." },
        status: { type: "string", enum: ["identified", "assessed", "shortlisted", "promoted", "parked", "rejected"] },
        roeGrade: { type: "string", enum: ["A", "B", "C", "D", "E"] },
        urgencyFlag: { type: "boolean" },
        createdAfter: { type: "string", description: "ISO date — only entries created after this date." },
        limit: { type: "number", description: "Max entries (default 50, max 200)." },
        offset: { type: "number", description: "Pagination offset." },
      },
    },
  },
  {
    name: "get_leads_register_entry",
    description: "Get a single Leads Register entry by ID.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Register entry document ID." } },
      required: ["id"],
    },
  },
  {
    name: "update_leads_register_entry",
    description: "Update a Leads Register entry — ROE score, Stockdale assessment, status, weekly decision, notes, tags, contact, opportunity, osintHook, etc. Pass the entry's doc ID as either `id` or `entryId` (both accepted).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Register entry document ID." },
        entryId: { type: "string", description: "Alias for `id` — both are accepted." },
        status: { type: "string", enum: ["identified", "assessed", "shortlisted", "promoted", "parked", "rejected"] },
        osintHook: {
          type: "string",
          description: "Full-sentence specific hook from VANGUARD scan or supplier intel. SENTINEL/MERCER/SHIELD daily outreach hard-gates on this field — if null, the lead is skipped. No length cap.",
        },
        osintHookShort: {
          type: "string",
          description: "Short version of osintHook for Touch 1 subject-line / opener. Max 160 characters. SENTINEL/MERCER/SHIELD outreach uses this in email subjects.",
        },
        roeScore: {
          type: "object", description: "ROE score breakdown (0-100 total).",
          properties: {
            strategicFit: { type: "number" }, effortEstimate: { type: "number" },
            revenueImpact: { type: "number" }, conversionProbability: { type: "number" },
            resourceRisk: { type: "number" }, assessedBy: { type: "string" },
          },
        },
        stockdaleAssessment: {
          type: "object", description: "Stockdale brutal-facts assessment.",
          properties: {
            resourceAvailability: { type: "string", enum: ["available", "stretched", "committed"] },
            gunpowderCheck: { type: "string" }, growthRisk: { type: "string" },
            flywheelImpact: { type: "string" },
            verdict: { type: "string", enum: ["pursue", "park", "watch", "reject"] },
          },
        },
        weeklyDecision: {
          type: "object", description: "Weekly decision gate result.",
          properties: {
            weekEnding: { type: "string" },
            decision: { type: "string", enum: ["promote", "park", "reject", "defer"] },
            reasoning: { type: "string" },
            decidedBy: { type: "string" },
          },
        },
        contact: { type: "object", properties: { name: { type: "string" }, role: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, linkedin: { type: "string" } } },
        opportunity: { type: "object", properties: { description: { type: "string" }, category: { type: "string" }, potentialValue: { type: "number" }, potentialValueNotes: { type: "string" }, urgencyFlag: { type: "boolean" }, urgencyReason: { type: "string" } } },
        company: { type: "object", properties: { name: { type: "string" }, website: { type: "string" }, sector: { type: "string" }, description: { type: "string" }, location: { type: "string" }, size: { type: "string" } } },
        notes: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["id"],
    },
  },
  {
    name: "promote_leads_register_entry",
    description: "Promote a Leads Register entry to the CRM pipeline. Creates a CRM lead from register data. Entry must be 'assessed' or 'shortlisted' with a complete ROE score.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Register entry document ID." } },
      required: ["id"],
    },
  },
  {
    name: "get_leads_register_weekly_shortlist",
    description: "Get top entries by ROE score for weekly review — the decision gate shortlist.",
    inputSchema: {
      type: "object",
      properties: {
        streamType: { type: "string", enum: ["sales", "supply_chain", "trade_distribution"], description: "Filter by stream." },
        weekEnding: { type: "string", description: "ISO date for week ending (default: this week's Sunday)." },
        limit: { type: "number", description: "Max entries (default 5)." },
      },
    },
  },
  {
    name: "get_leads_register_active_pursuits",
    description: "Get register entries that have been promoted but not yet closed in CRM — active pursuits in progress.",
    inputSchema: {
      type: "object",
      properties: {
        streamType: { type: "string", enum: ["sales", "supply_chain", "trade_distribution"], description: "Filter by stream." },
      },
    },
  },
  {
    name: "get_leads_register_stats",
    description: "Summary counts by stream, status, grade. Active pursuit count. Conversion rate (promoted → won).",
    inputSchema: {
      type: "object",
      properties: {
        streamType: { type: "string", enum: ["sales", "supply_chain", "trade_distribution"], description: "Filter by stream. Omit for all three." },
      },
    },
  },
  // ─── Contact Lookup ────────────────────────────────────────────────────────
  {
    name: "contact_lookup",
    description: "Check if an email/name exists in Xero contacts, Portal organisations, or Portal leads. Used by ATHENA for email escalation — if found, escalate to Tier 3.",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string", description: "Email address to search." },
        name: { type: "string", description: "Contact name to search (fuzzy match)." },
      },
    },
  },
  // ─── Email Template tools ─────────────────────────────────────────────────
  {
    name: "create_email_template",
    description: "Create a new email template for agent automation. Templates support {{variable}} placeholders.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string", enum: ["athena", "vanguard", "sentinel"], description: "Which agent uses this template." },
        category: { type: "string", enum: ["outreach", "follow-up", "response", "scheduling", "acknowledgement", "info-request"] },
        name: { type: "string", description: "Template name." },
        description: { type: "string", description: "When to use this template." },
        subject: { type: "string", description: "Email subject (supports {{variable}} placeholders)." },
        bodyHtml: { type: "string", description: "HTML body (supports {{variable}} placeholders)." },
        variables: { type: "array", items: { type: "string" }, description: "Placeholder variable names used." },
        sequence: {
          type: "object", description: "If part of a multi-touch sequence.",
          properties: {
            sequenceId: { type: "string" }, touchNumber: { type: "number" }, dayOffset: { type: "number" },
          },
        },
        authLevel: { type: "string", enum: ["auto-send", "draft-for-review"], description: "Whether this can be auto-sent or needs review." },
        status: { type: "string", enum: ["active", "draft"], description: "Default: draft." },
      },
      required: ["agent", "category", "name", "subject", "bodyHtml"],
    },
  },
  {
    name: "get_email_templates",
    description: "List/filter email templates by agent, category, auth level, status, or sequence.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string", enum: ["athena", "vanguard", "sentinel"] },
        category: { type: "string", enum: ["outreach", "follow-up", "response", "scheduling", "acknowledgement", "info-request"] },
        authLevel: { type: "string", enum: ["auto-send", "draft-for-review"] },
        status: { type: "string", enum: ["active", "draft", "archived"] },
        sequenceId: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "get_email_template",
    description: "Get a single email template by ID.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "update_email_template",
    description: "Update an email template. Auto-increments version number.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" }, description: { type: "string" },
        subject: { type: "string" }, bodyHtml: { type: "string" },
        variables: { type: "array", items: { type: "string" } },
        sequence: { type: "object", properties: { sequenceId: { type: "string" }, touchNumber: { type: "number" }, dayOffset: { type: "number" } } },
        authLevel: { type: "string", enum: ["auto-send", "draft-for-review"] },
        status: { type: "string", enum: ["active", "draft", "archived"] },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_email_template",
    description: "Soft-delete an email template (sets status to 'archived').",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "approve_email_template",
    description: "Mark an email template as approved by the Director. Only approved templates with authLevel 'auto-send' can be sent automatically.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
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
  // ─── CRM Organisation tools ─────────────────────────────────────────────────
  {
    name: "update_organization",
    description:
      "Update fields on a CRM organisation (contactOrganizations collection). Use to set accountsEmail, ABN, phone, email, status, marketStream, or other org-level fields.",
    inputSchema: {
      type: "object",
      properties: {
        organizationId: { type: "string", description: "Firestore document ID of the organisation." },
        updates: {
          type: "object",
          description: "Fields to update. Supported: name, email, accountsEmail, phone, abn, status, marketStream, jobCode, industry, website.",
        },
      },
      required: ["organizationId", "updates"],
    },
  },
  // ─── Xero accounting tools are served by a separate MCP endpoint at
  //     /api/xero-mcp. LEDGER + Athena register that as a second
  //     connector. The one cross-concern tool — close_out_job — stays
  //     here because it touches Firestore job status AND Xero.
  //     See src/lib/server/xero-mcp-tools.ts for the Xero tool surface.
  //
  //     xero_status placeholder kept below so the main MCP can still
  //     report whether Xero is configured, without full tool access.
  {
    name: "xero_status",
    description: "Quick check: is Xero connected and authorised? For full Xero tooling (invoices, payments, reconciliation, reports), register the dedicated Xero MCP at /api/xero-mcp as a separate Claude connector.",
    inputSchema: { type: "object", properties: {} },
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
      "Submit a weekly department report. Each agent team (LEDGER, SENTINEL, VANGUARD, OSINT, GUARDIAN, CIPHER, SHIELD) pushes their report here. ATHENA reads them all to compile the company report.",
    inputSchema: {
      type: "object",
      properties: {
        department: {
          type: "string",
          enum: ["ledger", "sentinel", "vanguard", "osint", "operations", "chief_of_staff", "cipher", "guardian", "shield"],
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
    name: "mark_warranty_not_applicable",
    description:
      "Mark one or more film installations as not requiring APEAX warranty registration. Use for non-warranty-tracked products like GrafShield and RadShield/tint. Clears them from the pending registration queue.",
    inputSchema: {
      type: "object",
      properties: {
        installationIds: {
          type: "array",
          items: { type: "string" },
          description: "Array of film installation Firestore IDs to mark as warranty N/A.",
        },
        reason: { type: "string", description: "Reason warranty is not applicable (e.g. 'GrafShield — no APEAX warranty registration required')." },
      },
      required: ["installationIds"],
    },
  },
  {
    name: "get_warranty_register",
    description: "Get the full APEAX warranty register with optional filters.",
    inputSchema: {
      type: "object",
      properties: {
        clientId: { type: "string", description: "Filter by client." },
        registrationStatus: { type: "string", enum: ["pending", "overdue", "submitted", "confirmed", "rejected", "expired", "not_applicable"] },
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

  // ─── Gmail tools (multi-account) ───────────────────────────────────────────
  //
  // All Gmail tools accept an optional `from_account` parameter that
  // selects the mailbox the operation runs against:
  //   - "default" (or omit): Joshua's personal mailbox via OAuth
  //   - "accountmanager": LEDGER mailbox (accountmanager@asi-australia.com.au,
  //      human name "James Ledger") — service account delegation
  //   - "development": Sales/pipeline/R&D mailbox
  //      (development@asi-australia.com.au) — service account delegation
  //
  // All send/draft/modify/trash actions are logged to the agentEmailAudit
  // Firestore collection for full traceability. Pass agent_identity
  // (e.g. "LEDGER", "SENTINEL") so the audit log captures which agent
  // initiated the action.
  {
    name: "gmail_connect",
    description: "Get the Gmail OAuth authorization URL for the DEFAULT (Joshua's personal) account only. Agent mailboxes use service account delegation and do NOT need OAuth — no gmail_connect call needed for them.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "gmail_status",
    description: "Check Gmail connection status for a specific mailbox. Defaults to Joshua's account if from_account is omitted.",
    inputSchema: {
      type: "object",
      properties: {
        from_account: { type: "string", description: "Mailbox key: 'default' (Joshua), 'accountmanager' (LEDGER), 'development' (Sales/R&D). Defaults to 'default'." },
      },
    },
  },
  {
    name: "gmail_get_profile",
    description: "Get the profile (email address, total messages, threads) for a specific Gmail mailbox.",
    inputSchema: {
      type: "object",
      properties: {
        from_account: { type: "string", description: "Mailbox key: 'default', 'accountmanager', 'development'. Defaults to 'default'." },
      },
    },
  },
  {
    name: "gmail_search",
    description: "Search a Gmail mailbox using Gmail search syntax. Returns message IDs and snippets. Examples: 'is:unread', 'from:josh', 'subject:invoice after:2026/04/01', 'has:attachment'.",
    inputSchema: {
      type: "object",
      properties: {
        from_account: { type: "string", description: "Mailbox to search: 'default', 'accountmanager', 'development'. Defaults to 'default'." },
        query: { type: "string", description: "Gmail search query (same syntax as Gmail search bar)" },
        max_results: { type: "number", description: "Max messages to return (default 20, max 100)" },
        page_token: { type: "string", description: "Pagination token from previous search" },
      },
      required: ["query"],
    },
  },
  {
    name: "gmail_read_message",
    description: "Read a specific email message by ID from a mailbox. Returns full headers, body text, and metadata.",
    inputSchema: {
      type: "object",
      properties: {
        from_account: { type: "string", description: "Mailbox the message lives in. Defaults to 'default'." },
        message_id: { type: "string", description: "Gmail message ID (from gmail_search results)" },
      },
      required: ["message_id"],
    },
  },
  {
    name: "gmail_read_thread",
    description: "Read an email thread/conversation by thread ID. Returns all messages in the thread.",
    inputSchema: {
      type: "object",
      properties: {
        from_account: { type: "string", description: "Mailbox the thread lives in. Defaults to 'default'." },
        thread_id: { type: "string", description: "Gmail thread ID" },
      },
      required: ["thread_id"],
    },
  },
  {
    name: "gmail_send",
    description: "Send an email from a specific mailbox. Use 'accountmanager' for LEDGER (signs as 'James Ledger'), 'development' for sales/R&D correspondence, or omit from_account for Joshua's personal account. All sends are audit-logged to agentEmailAudit with the agent_identity (pass your agent name e.g. 'LEDGER').",
    inputSchema: {
      type: "object",
      properties: {
        from_account: { type: "string", description: "Sending mailbox: 'default', 'accountmanager' (LEDGER/James Ledger), 'development' (Sales/R&D)." },
        agent_identity: { type: "string", description: "Name of the agent sending (e.g. 'LEDGER', 'SENTINEL', 'VANGUARD'). Recorded in the audit log." },
        to: { type: "string", description: "Recipient email address(es), comma-separated for multiple" },
        subject: { type: "string", description: "Email subject line" },
        body: { type: "string", description: "Plain text email body" },
        cc: { type: "string", description: "CC recipients (comma-separated)" },
        bcc: { type: "string", description: "BCC recipients (comma-separated)" },
        reply_to: { type: "string", description: "Reply-to address if different from sender" },
        in_reply_to: { type: "string", description: "Message-ID to reply to (for threading)" },
        thread_id: { type: "string", description: "Thread ID to add this message to (for replies)" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "gmail_create_draft",
    description: "Create an email draft in a specific mailbox for review before sending. Logged to the audit trail.",
    inputSchema: {
      type: "object",
      properties: {
        from_account: { type: "string", description: "Mailbox to draft from: 'default', 'accountmanager', 'development'." },
        agent_identity: { type: "string", description: "Name of the agent drafting (audit log)." },
        to: { type: "string", description: "Recipient email address(es)" },
        subject: { type: "string", description: "Email subject line" },
        body: { type: "string", description: "Plain text email body" },
        cc: { type: "string", description: "CC recipients" },
        bcc: { type: "string", description: "BCC recipients" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "gmail_list_drafts",
    description: "List email drafts in a specific mailbox.",
    inputSchema: {
      type: "object",
      properties: {
        from_account: { type: "string", description: "Mailbox to list drafts for." },
        max_results: { type: "number", description: "Max drafts to return (default 10)" },
      },
    },
  },
  {
    name: "gmail_send_draft",
    description: "Send a previously created draft from a specific mailbox.",
    inputSchema: {
      type: "object",
      properties: {
        from_account: { type: "string", description: "Mailbox the draft lives in." },
        agent_identity: { type: "string", description: "Name of the agent sending (audit log)." },
        draft_id: { type: "string", description: "Draft ID to send" },
      },
      required: ["draft_id"],
    },
  },
  {
    name: "gmail_list_labels",
    description: "List all Gmail labels (folders) in a specific mailbox.",
    inputSchema: {
      type: "object",
      properties: {
        from_account: { type: "string", description: "Mailbox to list labels for." },
      },
    },
  },
  {
    name: "gmail_modify_labels",
    description: "Add or remove labels from a message (move to folder, mark read/unread, star, archive). Audit-logged.",
    inputSchema: {
      type: "object",
      properties: {
        from_account: { type: "string", description: "Mailbox the message lives in." },
        agent_identity: { type: "string", description: "Name of the agent performing the action (audit log)." },
        message_id: { type: "string", description: "Message ID to modify" },
        add_labels: { type: "array", items: { type: "string" }, description: "Label IDs to add (e.g. 'STARRED', 'IMPORTANT', 'UNREAD')" },
        remove_labels: { type: "array", items: { type: "string" }, description: "Label IDs to remove (e.g. 'UNREAD' to mark as read, 'INBOX' to archive)" },
      },
      required: ["message_id"],
    },
  },
  {
    name: "gmail_trash",
    description: "Move an email to trash. Audit-logged.",
    inputSchema: {
      type: "object",
      properties: {
        from_account: { type: "string", description: "Mailbox the message lives in." },
        agent_identity: { type: "string", description: "Name of the agent performing the action (audit log)." },
        message_id: { type: "string", description: "Message ID to trash" },
      },
      required: ["message_id"],
    },
  },
  {
    name: "agent_email_audit",
    description:
      "Query the agent email audit trail. Returns a chronological list of every email action (send, draft, send_draft, modify_labels, trash) taken by any agent mailbox, with full metadata including recipient, subject, body preview, agent identity, and success/error status. Use for compliance, traceability, or debugging agent email behaviour. Filter by accountKey, agentIdentity, action, or success status.",
    inputSchema: {
      type: "object",
      properties: {
        accountKey: { type: "string", description: "Filter by mailbox key: 'default', 'accountmanager', 'development'." },
        agentIdentity: { type: "string", description: "Filter by agent name (e.g. 'LEDGER')." },
        action: { type: "string", enum: ["send", "draft", "send_draft", "modify_labels", "trash"], description: "Filter by action type." },
        success: { type: "boolean", description: "Filter by success (true) or failures only (false)." },
        limit: { type: "number", description: "Max entries (default 50, max 500)." },
      },
    },
  },
  // ─── R&D & Grants Management (ARCHER / Sophie Archer) ──────────────────────
  //
  // Three linked collections power Sophie's domain: rndProjects,
  // grantApplications, rndOpportunityLog. Approval chain for projects and
  // grants is Archer → ATHENA → Director.
  {
    name: "create_rnd_project",
    description:
      "Create a new R&D project in Sophie Archer's programme register. Auto-generates a project number (RND-YYYY-NNNN). Default leadAgent is ARCHER. Project starts in 'scoping' phase with 'active' status. ATHENA and Director approvals are created as 'pending' on the project and must be approved separately before moving past scoping for projects with estimatedBudget > $50k.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        shortDescription: { type: "string", description: "1-liner for list views." },
        domain: { type: "string", enum: ["product", "process", "platform", "capability", "research"] },
        phase: { type: "string", enum: ["scoping", "feasibility", "design", "prototype", "pilot", "validation", "production", "on_hold", "archived"], description: "Default: scoping." },
        priority: { type: "string", enum: ["low", "medium", "high", "critical"], description: "Default: medium." },
        leadAgent: { type: "string", description: "Default: ARCHER." },
        sponsorAgent: { type: "string" },
        stakeholders: { type: "array", items: { type: "string" }, description: "Other agent codenames involved." },
        relatedProducts: { type: "array", items: { type: "string" }, description: "APEAX product IDs e.g. ['grafshield']." },
        modernisationPath: { type: "string", description: "Free text: which strategic pathway this supports." },
        estimatedBudget: { type: "number" },
        targetCompletionDate: { type: "string", description: "ISO date." },
        deliverables: { type: "array", items: { type: "string" } },
        sourcedFrom: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["opportunity_log", "grant_opportunity", "director_mandate", "management_meeting", "reactive", "gap_analysis"] },
            reference: { type: "string", description: "Opportunity ID or meeting reference." },
            note: { type: "string" },
          },
        },
        notes: { type: "string" },
      },
      required: ["title", "shortDescription", "domain"],
    },
  },
  {
    name: "get_rnd_project",
    description: "Get a single R&D project by ID.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
    },
  },
  {
    name: "get_rnd_projects",
    description: "List R&D projects from Sophie's register. Filter by phase, status, domain, or leadAgent.",
    inputSchema: {
      type: "object",
      properties: {
        phase: { type: "string", enum: ["scoping", "feasibility", "design", "prototype", "pilot", "validation", "production", "on_hold", "archived"] },
        status: { type: "string", enum: ["active", "on_hold", "completed", "cancelled"] },
        domain: { type: "string", enum: ["product", "process", "platform", "capability", "research"] },
        leadAgent: { type: "string" },
        limit: { type: "number", description: "Default 50, max 200." },
      },
    },
  },
  {
    name: "update_rnd_project",
    description:
      "Update an existing R&D project. Supports phase transitions, status changes, adding/replacing risks and KPIs, linking IMS document IDs, recording approvals, and updating budget. Phase/status changes append a statusLog entry automatically.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        phase: { type: "string", enum: ["scoping", "feasibility", "design", "prototype", "pilot", "validation", "production", "on_hold", "archived"] },
        status: { type: "string", enum: ["active", "on_hold", "completed", "cancelled"] },
        priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
        title: { type: "string" },
        shortDescription: { type: "string" },
        modernisationPath: { type: "string" },
        estimatedBudget: { type: "number" },
        targetCompletionDate: { type: "string" },
        deliverables: { type: "array", items: { type: "string" } },
        stakeholders: { type: "array", items: { type: "string" } },
        relatedProducts: { type: "array", items: { type: "string" } },
        kpis: {
          type: "array",
          description: "Full KPI list — replaces existing.",
          items: { type: "object", properties: {
            name: { type: "string" }, target: { type: "string" }, currentValue: { type: "string" }, unit: { type: "string" },
          }, required: ["name", "target"] },
        },
        risks: {
          type: "array",
          description: "Full risk list — replaces existing.",
          items: { type: "object", properties: {
            risk: { type: "string" }, severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
            mitigation: { type: "string" }, owner: { type: "string" },
          }, required: ["risk", "severity", "mitigation"] },
        },
        imsDocumentIds: { type: "array", items: { type: "string" }, description: "Manual links to existing IMS documents." },
        imsComplianceStatus: { type: "string", enum: ["compliant", "non_conformance", "pending_audit"] },
        changeNote: { type: "string", description: "Optional note for the statusLog entry." },
        changedBy: { type: "string", description: "Agent name recording the change. Default: system." },
      },
      required: ["projectId"],
    },
  },
  {
    name: "record_rnd_project_approval",
    description:
      "Record an approval decision on an R&D project. Archer designs the proposal, then ATHENA reviews, then Director gives final go/no-go. Use approver='ATHENA' for ATHENA's review, approver='DIRECTOR' for the Director's final decision.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        approver: { type: "string", enum: ["ATHENA", "DIRECTOR"] },
        decision: { type: "string", enum: ["approved", "rejected"] },
        note: { type: "string" },
        decidedBy: { type: "string", description: "Agent name / user making the decision." },
      },
      required: ["projectId", "approver", "decision"],
    },
  },
  {
    name: "log_rnd_project_spend",
    description:
      "Record actual spend against an R&D project budget. Adds to actualSpendToDate. Use for tracking run-rate against estimatedBudget.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        amount: { type: "number", description: "Incremental spend to add (AUD)." },
        note: { type: "string" },
      },
      required: ["projectId", "amount"],
    },
  },
  // ─── Grants Pipeline ───────────────────────────────────────────────────────
  {
    name: "create_grant_application",
    description:
      "Create a new grant application in Sophie's grants pipeline. Auto-generates a grant number (GRT-YYYY-NNNN). Default stage is 'monitoring' unless otherwise specified. Approval chain is Archer → ATHENA → Director.",
    inputSchema: {
      type: "object",
      properties: {
        programmeName: { type: "string", description: "e.g. 'R&D Tax Incentive (RDTI)'." },
        programmeBody: { type: "string", description: "e.g. 'AusIndustry', 'Victorian Gov'." },
        programmeUrl: { type: "string" },
        roundName: { type: "string" },
        stage: { type: "string", enum: ["monitoring", "scoping", "drafting", "internal_review", "submitted", "under_review", "interview_stage", "approved", "rejected", "withdrawn", "acquitted"], description: "Default: monitoring." },
        fundingType: { type: "string", enum: ["grant", "tax_offset", "rebate", "loan", "equity_match"] },
        awardValue: { type: "number", description: "Potential / estimated award value." },
        linkedRndProjectIds: { type: "array", items: { type: "string" }, description: "R&D project IDs this grant would fund." },
        roundOpensAt: { type: "string", description: "ISO date — when applications open." },
        submissionDeadline: { type: "string", description: "ISO date — hard deadline." },
        expectedDecisionDate: { type: "string" },
        acquittalDueDate: { type: "string" },
        notes: { type: "string" },
      },
      required: ["programmeName", "programmeBody", "fundingType"],
    },
  },
  {
    name: "get_grant_application",
    description: "Get a single grant application by ID.",
    inputSchema: {
      type: "object",
      properties: { grantId: { type: "string" } },
      required: ["grantId"],
    },
  },
  {
    name: "get_grant_applications",
    description: "List grant applications. Filter by stage, programmeBody, fundingType, or awarded status.",
    inputSchema: {
      type: "object",
      properties: {
        stage: { type: "string", enum: ["monitoring", "scoping", "drafting", "internal_review", "submitted", "under_review", "interview_stage", "approved", "rejected", "withdrawn", "acquitted"] },
        programmeBody: { type: "string" },
        fundingType: { type: "string", enum: ["grant", "tax_offset", "rebate", "loan", "equity_match"] },
        awardedOnly: { type: "boolean", description: "If true, only return grants in approved or acquitted stage." },
        limit: { type: "number", description: "Default 50, max 200." },
      },
    },
  },
  {
    name: "update_grant_application",
    description:
      "Update a grant application — move through stages, update requirements, link projects, update dates. Stage changes append to statusLog.",
    inputSchema: {
      type: "object",
      properties: {
        grantId: { type: "string" },
        stage: { type: "string", enum: ["monitoring", "scoping", "drafting", "internal_review", "submitted", "under_review", "interview_stage", "approved", "rejected", "withdrawn", "acquitted"] },
        awardValue: { type: "number" },
        awardedAmount: { type: "number", description: "Set when stage moves to approved." },
        requirements: {
          type: "array",
          description: "Full requirements list — replaces existing.",
          items: {
            type: "object",
            properties: {
              requirement: { type: "string" },
              status: { type: "string", enum: ["pending", "in_progress", "complete", "blocked"] },
              dueDate: { type: "string" },
              notes: { type: "string" },
            },
            required: ["requirement", "status"],
          },
        },
        linkedRndProjectIds: { type: "array", items: { type: "string" } },
        submissionDeadline: { type: "string" },
        expectedDecisionDate: { type: "string" },
        acquittalDueDate: { type: "string" },
        draftDocumentIds: { type: "array", items: { type: "string" } },
        submittedDocumentIds: { type: "array", items: { type: "string" } },
        changeNote: { type: "string" },
        changedBy: { type: "string" },
      },
      required: ["grantId"],
    },
  },
  {
    name: "record_grant_internal_approval",
    description:
      "Record an approval decision on a grant application. Archer proposes, ATHENA reviews, Director decides. Use approver='ATHENA' or approver='DIRECTOR'.",
    inputSchema: {
      type: "object",
      properties: {
        grantId: { type: "string" },
        approver: { type: "string", enum: ["ATHENA", "DIRECTOR"] },
        decision: { type: "string", enum: ["approved", "rejected"] },
        note: { type: "string" },
        decidedBy: { type: "string" },
      },
      required: ["grantId", "approver", "decision"],
    },
  },
  {
    name: "log_grant_compliance_event",
    description:
      "Track post-award compliance events for an awarded grant: submit a required report, mark a milestone achieved, or flag overdue. Use for acquittal tracking on approved grants.",
    inputSchema: {
      type: "object",
      properties: {
        grantId: { type: "string" },
        eventType: { type: "string", enum: ["report_submitted", "milestone_achieved", "milestone_missed", "report_accepted", "compliance_flag"] },
        referenceName: { type: "string", description: "Name of the report or milestone being updated." },
        note: { type: "string" },
      },
      required: ["grantId", "eventType", "referenceName"],
    },
  },
  {
    name: "get_grants_dashboard",
    description:
      "Summary dashboard for the grants pipeline: total awarded YTD, applications in flight (by stage), upcoming submission deadlines (next 30 days), overdue compliance events, recent grant activity. Single-call overview for Sophie's weekly briefing.",
    inputSchema: { type: "object", properties: {} },
  },
  // ─── R&D Opportunity Log ───────────────────────────────────────────────────
  {
    name: "log_rnd_opportunity",
    description:
      "Drop a signal into Sophie's R&D opportunity log. Any agent can log an opportunity (SENTINEL from client patterns, VANGUARD from supplier innovations, GUARDIAN from audit findings, etc.). Auto-generates an opportunity number (OPP-YYYY-NNNN). Starts in 'new' status, awaiting Archer's review.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string", description: "Full context on what was observed." },
        type: { type: "string", enum: ["client_pattern", "supplier_innovation", "market_gap", "technology_signal", "regulatory_change", "internal_gap"] },
        sourcedBy: { type: "string", description: "Agent codename logging the signal: SENTINEL, VANGUARD, GUARDIAN, ATHENA, etc." },
        sourceContext: { type: "string", description: "e.g. 'Weekly management meeting 2026-04-16'." },
        sourceReferences: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["lead", "osint_scan", "meeting", "audit_finding", "external_report", "other"] },
              id: { type: "string" },
              note: { type: "string" },
            },
            required: ["type"],
          },
        },
        notes: { type: "string" },
      },
      required: ["title", "description", "type", "sourcedBy"],
    },
  },
  {
    name: "get_rnd_opportunities",
    description: "List R&D opportunities from Sophie's log. Filter by status, type, or source agent.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["new", "under_review", "accepted", "parked", "rejected", "converted"] },
        type: { type: "string", enum: ["client_pattern", "supplier_innovation", "market_gap", "technology_signal", "regulatory_change", "internal_gap"] },
        sourcedBy: { type: "string", description: "Filter by the agent that logged the opportunity." },
        limit: { type: "number", description: "Default 50, max 200." },
      },
    },
  },
  {
    name: "get_opportunities_awaiting_review",
    description:
      "Sophie's inbox — opportunities in 'new' or 'under_review' status, sorted newest first. Plus parked items whose parkedUntil date is today or earlier (ready for revisit). Use for Sophie's weekly triage workflow.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Default 50." },
      },
    },
  },
  {
    name: "review_rnd_opportunity",
    description:
      "Sophie's review action on an opportunity. Scores it across 4 dimensions (strategic fit, technical feasibility, funding potential, impact size — 0-10 each) and sets the decision: accept, park (with parkedUntil date), or reject.",
    inputSchema: {
      type: "object",
      properties: {
        opportunityId: { type: "string" },
        decision: { type: "string", enum: ["accept", "park", "reject"] },
        strategicFit: { type: "number", description: "0-10." },
        technicalFeasibility: { type: "number" },
        fundingPotential: { type: "number" },
        impactSize: { type: "number" },
        reviewNotes: { type: "string" },
        parkedUntil: { type: "string", description: "ISO date if decision=park." },
        rejectionReason: { type: "string", description: "If decision=reject." },
        reviewedBy: { type: "string", description: "Default: ARCHER." },
      },
      required: ["opportunityId", "decision"],
    },
  },
  {
    name: "convert_opportunity_to_project",
    description:
      "Graduate an accepted opportunity into a new R&D project. Creates the project record (pre-populated from the opportunity), updates the opportunity status to 'converted' and sets its convertedToProjectId. The resulting project starts in scoping phase awaiting approval.",
    inputSchema: {
      type: "object",
      properties: {
        opportunityId: { type: "string" },
        title: { type: "string", description: "Project title. Defaults to opportunity title." },
        shortDescription: { type: "string", description: "Defaults to opportunity description." },
        domain: { type: "string", enum: ["product", "process", "platform", "capability", "research"] },
        priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
        estimatedBudget: { type: "number" },
        targetCompletionDate: { type: "string" },
        leadAgent: { type: "string", description: "Default: ARCHER." },
      },
      required: ["opportunityId", "domain"],
    },
  },
  // ─── R&D Project Nominations ──────────────────────────────────────────────
  {
    name: "get_rnd_nominations",
    description:
      "List R&D project nominations. A nomination is a pre-project intake — Director nominates, Sophie Archer pre-feases it, Director approves which auto-creates the RndProject. Filter by status to find the ones waiting for Archer (submitted / in_prefeas) or for Director approval (prefeas_complete).",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["submitted", "in_prefeas", "prefeas_complete", "approved", "rejected", "withdrawn"],
          description: "Optional filter. Omit for all.",
        },
        limit: { type: "number", description: "Max results (default 50, max 200)." },
      },
    },
  },
  {
    name: "get_rnd_nomination",
    description: "Get a single R&D nomination by Firestore ID. Returns the full record including pre-feas brief if written.",
    inputSchema: {
      type: "object",
      properties: {
        nominationId: { type: "string" },
      },
      required: ["nominationId"],
    },
  },
  {
    name: "update_rnd_nomination_prefeas",
    description:
      "Sophie Archer writes the pre-feasibility brief on a nomination and flips its status to prefeas_complete (which puts it on the Director's approval queue). Required fields: marketRegulatoryContext, grantMatch, verdict. Scores clamp to 1-5. Use the live watchlist in the prompt to pick the grantMatch programme name(s).",
    inputSchema: {
      type: "object",
      properties: {
        nominationId: { type: "string" },
        strategicFitScore: { type: "number", description: "1-5 (clamped)." },
        technicalFeasibilityScore: { type: "number", description: "1-5 (clamped)." },
        marketRegulatoryContext: { type: "string" },
        grantMatch: { type: "string", description: "Prose summary of best-fit programme(s) from the watchlist." },
        costEnvelopeMin: { type: "number" },
        costEnvelopeMax: { type: "number" },
        flagsAndRisks: { type: "array", items: { type: "string" } },
        verdict: { type: "string", enum: ["pursue", "park", "reject"] },
      },
      required: ["nominationId", "marketRegulatoryContext", "grantMatch", "verdict"],
    },
  },
  {
    name: "approve_rnd_nomination",
    description:
      "Director approves a nomination with a prefeas_complete status. This creates a full RndProject (inherits priority/domain/target date and pre-feas cost envelope) AND drafts a GrantApplication against each selected programme, linked to the new project. Returns the new projectId + any created grant IDs.",
    inputSchema: {
      type: "object",
      properties: {
        nominationId: { type: "string" },
        note: { type: "string", description: "Optional decision note." },
        createGrantDraftsFor: {
          type: "array",
          items: { type: "string" },
          description: "Optional explicit list of programme IDs to draft grants against. Defaults to the nomination's selectedProgrammeIds.",
        },
      },
      required: ["nominationId"],
    },
  },
  {
    name: "reject_rnd_nomination",
    description: "Director rejects a nomination. Logs the decision + note; nomination stays in the register for audit.",
    inputSchema: {
      type: "object",
      properties: {
        nominationId: { type: "string" },
        note: { type: "string" },
      },
      required: ["nominationId"],
    },
  },
  // ─── Grant Programme Watchlist ────────────────────────────────────────────
  {
    name: "create_grant_programme",
    description:
      "Register a grant programme in Sophie's watchlist (separate from actual grant applications). Use for tracking programmes Sophie should monitor (e.g. RDTI, EMDG, state innovation grants) so she knows when rounds open.",
    inputSchema: {
      type: "object",
      properties: {
        programmeName: { type: "string" },
        programmeBody: { type: "string" },
        level: { type: "string", enum: ["federal", "state", "local", "industry", "private"] },
        jurisdiction: { type: "string", description: "e.g. 'Australia', 'Victoria'." },
        description: { type: "string" },
        programmeUrl: { type: "string" },
        fundingType: { type: "string", enum: ["grant", "tax_offset", "rebate", "loan", "equity_match"] },
        typicalValueMin: { type: "number" },
        typicalValueMax: { type: "number" },
        frequency: { type: "string", enum: ["continuous", "annual", "biannual", "quarterly", "irregular", "one_off"] },
        nextRoundOpensAt: { type: "string", description: "ISO date." },
        typicalDeadlineLead: { type: "string" },
        fitScore: { type: "number", description: "1-5 — how well this fits ASI's R&D profile." },
        eligibilityNotes: { type: "string" },
        applicabilityNotes: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        notes: { type: "string" },
      },
      required: ["programmeName", "programmeBody", "level", "description", "fundingType", "frequency"],
    },
  },
  {
    name: "get_grant_programmes",
    description:
      "List grant programmes from Sophie's watchlist. Filter by level, active status, or return only programmes with upcoming rounds in the next N days.",
    inputSchema: {
      type: "object",
      properties: {
        level: { type: "string", enum: ["federal", "state", "local", "industry", "private"] },
        isActive: { type: "boolean", description: "Default true — only active programmes." },
        upcomingWithinDays: { type: "number", description: "If set, filter to programmes with nextRoundOpensAt within N days." },
        limit: { type: "number", description: "Default 100." },
      },
    },
  },
  {
    name: "update_grant_programme",
    description: "Update a grant programme in the watchlist. Typically used when Sophie confirms the next round date or marks a programme inactive.",
    inputSchema: {
      type: "object",
      properties: {
        programmeId: { type: "string" },
        isActive: { type: "boolean" },
        nextRoundOpensAt: { type: "string" },
        fitScore: { type: "number" },
        eligibilityNotes: { type: "string" },
        applicabilityNotes: { type: "string" },
        notes: { type: "string" },
        markAsChecked: { type: "boolean", description: "If true, set lastCheckedAt to now." },
      },
      required: ["programmeId"],
    },
  },
  {
    name: "delete_grant_programme",
    description: "Remove a grant programme from the watchlist (admin operation).",
    inputSchema: {
      type: "object",
      properties: { programmeId: { type: "string" } },
      required: ["programmeId"],
    },
  },
  {
    name: "push_archer_weekly_report",
    description:
      "Submit Sophie Archer's weekly R&D & Grants report for ATHENA compilation. Matches LEDGER's weekly CFO report pattern — pushed every Friday. ATHENA reads via get_department_reports for the company weekly.",
    inputSchema: {
      type: "object",
      properties: {
        weekEnding: { type: "string", description: "ISO date of the Friday this report covers." },
        summary: { type: "string", description: "1-2 paragraph overview of the R&D / Grants week." },
        rndMetrics: {
          type: "object",
          description: "Metrics snapshot: activeProjects, projectsByPhase, totalSpendToDate, pendingApprovals, etc.",
        },
        grantMetrics: {
          type: "object",
          description: "Metrics snapshot: applicationsInFlight, awardedYtd, potentialInFlight, upcomingDeadlines, overdueCompliance.",
        },
        highlights: { type: "array", items: { type: "string" }, description: "Notable wins or progress." },
        risks: { type: "array", items: { type: "string" }, description: "Issues flagged this week." },
        recommendations: { type: "array", items: { type: "string" }, description: "What Sophie recommends to ATHENA/Director." },
        newOpportunitiesLogged: { type: "number", description: "Count of new opportunities in the log this week." },
        opportunitiesConverted: { type: "number", description: "Count of opportunities graduated to projects this week." },
        rawData: { type: "object", description: "Optional supporting data for the report." },
      },
      required: ["weekEnding", "summary"],
    },
  },
  // ─── Agent heartbeat (live status tracking) ─────────────────────────────────
  {
    name: "agent_heartbeat",
    description: "Report an agent as alive and active. Call this at the start and end of each agent run (or periodically for long-running agents). Powers the live/last-active status display on the company structure dashboard.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", enum: ["athena", "vanguard", "sentinel", "mercer", "archer", "ledger", "guardian", "blackstone", "cipher", "meridian", "shield", "vesta"], description: "Canonical agent identifier." },
        status: { type: "string", enum: ["online", "busy", "idle", "error"], description: "Current operational status. 'busy' = actively running a workflow, 'idle' = reachable but not running anything, 'error' = last run failed." },
        activity: { type: "string", description: "Optional human-readable description of current activity (e.g. 'Running weekly OSINT scan')." },
        metadata: { type: "object", description: "Optional metadata (task count, queue depth, etc)." },
      },
      required: ["agentId", "status"],
    },
  },
  {
    name: "get_agent_heartbeats",
    description: "Get live/last-active status for all registered agents. Used by the dashboard company structure widget.",
    inputSchema: { type: "object", properties: {} },
  },
  // ─── SHIELD APEAX Distribution tools ───────────────────────────────────────
  {
    name: "get_shield_queue",
    description: "SHIELD operational queue — all items awaiting SHIELD action: pending quote requests, trade applications awaiting vetting, and orders awaiting SHIELD validation. Reads from leadsRegister (apeax_portal_* sources) and apeaxOrders.",
    inputSchema: {
      type: "object",
      properties: {
        queueType: { type: "string", enum: ["quotes", "applications", "orders", "all"], description: "Filter queue type (default: all)." },
      },
    },
  },
  {
    name: "approve_trade_application",
    description: "SHIELD approves an APEAX trade installer application. Promotes the leads register entry to a ContactOrganization with is_apeax_trade_installer=true, sets trade_discount_band, and issues installer login credentials.",
    inputSchema: {
      type: "object",
      properties: {
        registerEntryId: { type: "string", description: "Leads register entry ID to approve." },
        tradeDiscountBand: { type: "string", enum: ["A", "B", "C"], description: "Trade discount band tier." },
        approvedBy: { type: "string", description: "SHIELD user ID or 'shield-agent'." },
        notes: { type: "string", description: "Optional approval notes." },
      },
      required: ["registerEntryId", "tradeDiscountBand"],
    },
  },
  {
    name: "reject_trade_application",
    description: "SHIELD rejects an APEAX trade installer application. Logs rejection reason and sets vetting_lockout_until to NOW+12 months.",
    inputSchema: {
      type: "object",
      properties: {
        registerEntryId: { type: "string", description: "Leads register entry ID to reject." },
        reason: { type: "string", description: "Rejection reason (for audit trail)." },
        rejectedBy: { type: "string", description: "SHIELD user ID or 'shield-agent'." },
      },
      required: ["registerEntryId", "reason"],
    },
  },
  {
    name: "validate_apeax_order",
    description: "SHIELD validates a pending APEAX distribution order. Marks order as SHIELD-validated, checks stock sufficiency, and triggers a Xero PO to APEAX USA if stock is insufficient.",
    inputSchema: {
      type: "object",
      properties: {
        orderId: { type: "string", description: "APEAX order document ID." },
        validatedBy: { type: "string", description: "SHIELD user ID or 'shield-agent'." },
        notes: { type: "string" },
      },
      required: ["orderId"],
    },
  },
  {
    name: "get_apeax_stock",
    description: "Get current APEAX stock levels by SKU. Reads from the stockItems collection filtered to APEAX product lines.",
    inputSchema: {
      type: "object",
      properties: {
        sku: { type: "string", description: "Optional specific SKU to query." },
      },
    },
  },
  // ─── Jobs — lean summary ────────────────────────────────────────────────────
  {
    name: "list_jobs_summary",
    description: "LEAN jobs list for Xero / LEDGER workflows. Returns only billing-relevant fields (id, jobNumber, clientName, organizationId, status, totals, invoice refs, dates). Use this instead of get_jobs when pulling ≥50 rows to avoid token-limit failures.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["pending", "scheduled", "in_progress", "completed", "closed", "cancelled"],
          description: "Filter by job status.",
        },
        limit: { type: "number", description: "Max rows (default 50, max 500)." },
        clientId: { type: "string", description: "Filter by clientId (organization)." },
        unbilled: { type: "boolean", description: "If true, return only jobs missing an invoiceNumber." },
        fromDate: { type: "string", description: "ISO date — only jobs with createdAt on/after this." },
      },
    },
  },
  // ─── KPI Traceability capture ────────────────────────────────────────────────
  {
    name: "create_fuel_record",
    description: "Capture a fuel baseline / post-install record against a client organisation. Used by VANGUARD, Athena, and field agents to feed the KPI Traceability module.",
    inputSchema: {
      type: "object",
      properties: {
        organizationId: { type: "string", description: "Firestore contactOrganizations doc id." },
        vehicleRegistration: { type: "string", description: "Vehicle rego (will be upper-cased)." },
        vehicleDescription: { type: "string" },
        fuelType: { type: "string", enum: ["diesel", "petrol", "lpg", "cng", "electric"] },
        baselineConsumptionLPer100km: { type: "number" },
        baselinePeriodStart: { type: "string", description: "ISO date." },
        baselinePeriodEnd: { type: "string", description: "ISO date." },
        baselineSource: { type: "string", enum: ["manual", "telematics", "fleet_report"] },
        postInstallConsumptionLPer100km: { type: "number" },
        postInstallPeriodStart: { type: "string" },
        postInstallPeriodEnd: { type: "string" },
        postInstallSource: { type: "string", enum: ["manual", "telematics", "fleet_report"] },
        annualDistanceKm: { type: "number" },
        fuelCostPerLitre: { type: "number", description: "AUD per litre (default 1.80)." },
        hvacLoadReductionKw: { type: "number" },
        radshieldInstalled: { type: "boolean" },
        installDate: { type: "string" },
        filmInstallationId: { type: "string", description: "Link back to film installation if applicable." },
        notes: { type: "string" },
      },
      required: ["organizationId", "vehicleRegistration", "baselineConsumptionLPer100km"],
    },
  },
  {
    name: "create_emissions_report",
    description: "File a period emissions report (Scope 1 + waste) for ASRS compliance. Auto-calculates CO2 avoided from diesel saved using the Australian NGA factor (2.68 kg/L).",
    inputSchema: {
      type: "object",
      properties: {
        organizationId: { type: "string" },
        reportingPeriod: { type: "string", enum: ["monthly", "quarterly", "annual"] },
        periodStart: { type: "string", description: "ISO date." },
        periodEnd: { type: "string", description: "ISO date." },
        dieselSavedLitres: { type: "number" },
        glassAvoidedKg: { type: "number" },
        filmDisposalsAvoidedKg: { type: "number" },
        status: { type: "string", enum: ["draft", "reviewed", "submitted"], description: "Default draft." },
        notes: { type: "string" },
      },
      required: ["organizationId", "periodStart", "periodEnd"],
    },
  },
  {
    name: "create_telemetry_reading",
    description: "Log a telemetry / HVAC reading for a vehicle. Used for compressor duty cycle, cabin temp delta, and component lifecycle tracking.",
    inputSchema: {
      type: "object",
      properties: {
        organizationId: { type: "string" },
        vehicleRegistration: { type: "string" },
        readingDate: { type: "string", description: "ISO date." },
        readingSource: { type: "string", enum: ["manual", "telematics", "obd2", "canbus"] },
        dutyCyclePercent: { type: "number" },
        runHoursTotal: { type: "number" },
        tempDeltaCabin: { type: "number" },
        totalSystemLoadKw: { type: "number" },
        alternatorReductionKw: { type: "number" },
        ambientTempC: { type: "number" },
        cabinTempPreC: { type: "number" },
        cabinTempPostC: { type: "number" },
        compressorHoursTotal: { type: "number" },
        estimatedLifeHours: { type: "number", description: "Default 12000." },
        notes: { type: "string" },
      },
      required: ["organizationId", "vehicleRegistration"],
    },
  },
  {
    name: "create_maintenance_event",
    description: "Log a maintenance / repair event against a client's vehicle. Captures actualCost vs replacementCostAvoided for asset-protection KPI rollups.",
    inputSchema: {
      type: "object",
      properties: {
        organizationId: { type: "string" },
        vehicleRegistration: { type: "string" },
        eventDate: { type: "string", description: "ISO date." },
        eventType: { type: "string", enum: ["respray", "major_repair", "panel_replacement", "film_replacement", "glass_replacement", "other"] },
        description: { type: "string" },
        actualCost: { type: "number" },
        replacementCostAvoided: { type: "number", description: "Estimated cost of full replacement — drives the savings calc." },
        jobId: { type: "string" },
        jobNumber: { type: "string" },
        filmInstallationId: { type: "string" },
        performedBy: { type: "string" },
        notes: { type: "string" },
      },
      required: ["organizationId", "vehicleRegistration", "eventDate", "eventType", "description", "actualCost"],
    },
  },
  {
    name: "submit_satisfaction_survey",
    description: "Record a client satisfaction survey against a client organisation. Feeds the ISO 9001 satisfaction KPI. Use this for staff-logged or post-job ratings; Athena has its own one-tap flow.",
    inputSchema: {
      type: "object",
      properties: {
        organizationId: { type: "string" },
        submittedByName: { type: "string" },
        jobId: { type: "string" },
        jobNumber: { type: "string" },
        overallSatisfaction: { type: "number", description: "1–5." },
        serviceQuality: { type: "number", description: "1–5." },
        communication: { type: "number", description: "1–5." },
        timeliness: { type: "number", description: "1–5." },
        valueForMoney: { type: "number", description: "1–5." },
        wouldRecommend: { type: "boolean" },
        comments: { type: "string" },
        risks: { type: "array", items: { type: "string" }, description: "Client-raised concerns." },
        opportunities: { type: "array", items: { type: "string" }, description: "Improvement / expansion ideas." },
      },
      required: ["organizationId", "submittedByName", "overallSatisfaction"],
    },
  },
  {
    name: "get_kpi_summary",
    description: "Return ASI-wide or per-org KPI rollup: total fuel saved, CO2 avoided, cost savings, maintenance cost avoided, satisfaction score. Lightweight aggregate (no raw records).",
    inputSchema: {
      type: "object",
      properties: {
        organizationId: { type: "string", description: "If omitted, returns ASI-total across all clients." },
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
  const type = String(args.type || "procedure");

  // Management Review records (ISO 9.3) — structured inputs/outputs + meeting link
  const isManagementReview = type === "management_review";
  const managementReviewData = isManagementReview ? (args.managementReview || {}) : null;
  const meetingId = typeof args.meetingId === "string" ? args.meetingId : null;

  // R&D filing tags — let Sophie (or any agent) file a new doc directly
  // into a project's folder on the IMS R&D tree. If an R&D link is set
  // without an explicit folder, default to project_filing (the general
  // bucket). If FY is missing, derive from "now".
  const validFolders = new Set([
    "pm_planning", "engineering_design", "administration", "finance", "legal", "project_filing",
  ]);
  const rndProjectId = typeof args.rndProjectId === "string" && args.rndProjectId.trim() ? args.rndProjectId.trim() : null;
  const rndNominationId = typeof args.rndNominationId === "string" && args.rndNominationId.trim() ? args.rndNominationId.trim() : null;
  let rndFolder: string | null = null;
  if (typeof args.rndFolder === "string" && validFolders.has(args.rndFolder)) {
    rndFolder = args.rndFolder;
  } else if (rndProjectId || rndNominationId) {
    rndFolder = "project_filing";
  }
  const rndFinancialYear =
    typeof args.rndFinancialYear === "string" && /^FY\d{4}-\d{2}$/.test(args.rndFinancialYear)
      ? args.rndFinancialYear
      : (rndProjectId || rndNominationId)
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

/**
 * Compute the Australian financial year for a date (1 Jul – 30 Jun).
 * Kept inline here so the MCP route stays self-contained — mirrors
 * src/lib/rnd/filing.ts getAustralianFinancialYear().
 */
function deriveAustralianFinancialYear(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth();
  const startYear = m >= 6 ? y : y - 1;
  const endShort = String((startYear + 1) % 100).padStart(2, "0");
  return `FY${startYear}-${endShort}`;
}

const ALLOWED_UPDATE_FIELDS = new Set([
  "title", "content", "status", "processOwner", "isoClauses", "type", "docId",
  "rndProjectId", "rndNominationId", "rndFolder", "rndFinancialYear",
]);

const DIRECTOR_EMAIL = "joshua@asi-australia.com.au";

async function handleUpdateImsDocument(args: Record<string, unknown>) {
  const id = String(args.id);
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

  const now = admin.firestore.FieldValue.serverTimestamp();
  filtered.updatedAt = now;

  // Auto-increment revision number on content changes
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
  return serializeDoc(updated.id, updated.data()!);
}

// ─── IMS Document Approval Workflow ─────────────────────────────────────────

async function handleSubmitImsDocumentForReview(args: Record<string, unknown>) {
  const id = String(args.id);
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
  await docRef.set({
    approvalStatus: "under_review",
    status: "under_review",
    submittedForReviewAt: new Date().toISOString(),
    submittedForReviewBy: submittedBy,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { id, approvalStatus: "under_review", submittedBy, submittedAt: new Date().toISOString() };
}

async function handleApproveImsDocument(args: Record<string, unknown>) {
  const id = String(args.id);
  if (!id) throw new Error("id is required.");
  const approverUserId = String(args.approverUserId || "");
  const approverEmail = typeof args.approverEmail === "string" ? args.approverEmail.toLowerCase() : "";
  if (!approverUserId) throw new Error("approverUserId is required.");
  // Director-only guard
  if (approverEmail && approverEmail !== DIRECTOR_EMAIL) {
    throw new Error(`Only the Director (${DIRECTOR_EMAIL}) can approve IMS documents.`);
  }
  const effectiveDate = String(args.effectiveDate || new Date().toISOString().split("T")[0]);
  // reviewDueDate = when the current revision's review is due (drives reminder emails)
  // nextReviewDate = same value at approval time (updated after each review cycle)
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
  await docRef.set({
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
  }, { merge: true });

  return { id, approvalStatus: "approved", approvedBy: approverUserId, approvedAt: now, effectiveDate, reviewDueDate, nextReviewDate };
}

async function handleActivateImsDocument(args: Record<string, unknown>) {
  const id = String(args.id);
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

  // Auto-obsolete prior active version with same docId
  const docIdRef = current.docId ? String(current.docId) : null;
  const obsoletedIds: string[] = [];
  let supersedesId: string | null = null;
  if (docIdRef) {
    const priorSnap = await db.collection(COLLECTIONS.IMS_DOCUMENTS)
      .where("docId", "==", docIdRef)
      .where("approvalStatus", "==", "active")
      .get();
    const batch = db.batch();
    priorSnap.docs.forEach((d) => {
      if (d.id !== id) {
        batch.set(d.ref, {
          approvalStatus: "obsolete",
          status: "obsolete",
          obsoletedAt: new Date().toISOString(),
          obsoletedReason: `Superseded by revision ${current.revisionNumber || 1}`,
          supersededBy: id,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        obsoletedIds.push(d.id);
        supersedesId = d.id;
      }
    });
    await batch.commit();
  }

  await docRef.set({
    approvalStatus: "active",
    status: "active",
    activatedAt: new Date().toISOString(),
    supersedes: supersedesId,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { id, approvalStatus: "active", obsoletedPriorVersions: obsoletedIds };
}

async function handleObsoleteImsDocument(args: Record<string, unknown>) {
  const id = String(args.id);
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

  await docRef.set({
    approvalStatus: "obsolete",
    status: "obsolete",
    obsoletedAt: new Date().toISOString(),
    obsoletedReason: reason,
    obsoletedBy: typeof args.obsoletedBy === "string" ? args.obsoletedBy : "mcp-agent",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { id, approvalStatus: "obsolete", reason };
}

// ─── IMS Health Snapshot ────────────────────────────────────────────────────

async function handleGetImsHealthSnapshot() {
  const db = admin.firestore();
  const [docsSnap, auditsSnap, capasSnap, incidentsSnap, risksSnap] = await Promise.all([
    db.collection(COLLECTIONS.IMS_DOCUMENTS).limit(500).get(),
    db.collection(COLLECTIONS.IMS_AUDITS).limit(200).get(),
    db.collection(COLLECTIONS.IMS_CORRECTIVE_ACTIONS).limit(300).get(),
    db.collection(COLLECTIONS.IMS_INCIDENTS).limit(300).get(),
    db.collection(COLLECTIONS.IMS_RISK_REGISTER).limit(300).get(),
  ]);

  const today = new Date().toISOString().split("T")[0];
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const monthStart = new Date().toISOString().slice(0, 7) + "-01";

  // Documents
  const docs = docsSnap.docs.map((d) => d.data());
  const documents = {
    active: docs.filter((d) => (d.approvalStatus || d.status) === "active").length,
    draft: docs.filter((d) => (d.approvalStatus || d.status) === "draft").length,
    underReview: docs.filter((d) => (d.approvalStatus || d.status) === "under_review").length,
    approved: docs.filter((d) => (d.approvalStatus || d.status) === "approved").length,
    obsolete: docs.filter((d) => (d.approvalStatus || d.status) === "obsolete").length,
    overdueReview: docs.filter((d) =>
      (d.approvalStatus || d.status) === "active" &&
      typeof d.nextReviewDate === "string" &&
      d.nextReviewDate < today
    ).length,
    total: docs.length,
  };

  // Audits
  const audits = auditsSnap.docs.map((d) => d.data());
  const auditStats = {
    planned: audits.filter((a) => a.status === "planned").length,
    inProgress: audits.filter((a) => a.status === "in_progress").length,
    completedYTD: audits.filter((a) => a.status === "completed" && typeof a.completedAt === "string" && a.completedAt >= yearStart).length,
    total: audits.length,
  };

  // CAPAs
  const capas = capasSnap.docs.map((d) => d.data());
  const capaStats = {
    open: capas.filter((c) => c.status === "open" || c.status === "in_progress").length,
    overdue: capas.filter((c) =>
      (c.status === "open" || c.status === "in_progress") &&
      typeof c.dueDate === "string" && c.dueDate < today
    ).length,
    closedYTD: capas.filter((c) => c.status === "closed" && typeof c.closedAt === "string" && c.closedAt >= yearStart).length,
    effectivenessPending: capas.filter((c) => c.status === "closed" && !c.effectivenessVerified).length,
    total: capas.length,
  };

  // Incidents
  const incidents = incidentsSnap.docs.map((d) => d.data());
  const incidentStats = {
    openThisMonth: incidents.filter((i) =>
      i.status === "open" && typeof i.createdAt === "string" && i.createdAt >= monthStart
    ).length,
    closedThisMonth: incidents.filter((i) =>
      i.status === "closed" && typeof i.closedAt === "string" && i.closedAt >= monthStart
    ).length,
    openCritical: incidents.filter((i) => i.status === "open" && i.severity === "critical").length,
    total: incidents.length,
  };

  // Risks
  const risks = risksSnap.docs.map((d) => d.data());
  const riskStats = {
    open: risks.filter((r) => r.status === "open" || r.status === "monitoring").length,
    high: risks.filter((r) => r.riskLevel === "high").length,
    critical: risks.filter((r) => r.riskLevel === "critical").length,
    total: risks.length,
  };

  // Compliance score — simple heuristic: % of ISO clauses covered by at least one active doc
  // ISO 9001 has ~40 auditable clauses across sections 4-10
  const TOTAL_ISO_CLAUSES = 40;
  const coveredClauses = new Set<string>();
  docs.forEach((d) => {
    if ((d.approvalStatus || d.status) === "active" && Array.isArray(d.isoClauses)) {
      d.isoClauses.forEach((c: string) => coveredClauses.add(c));
    }
  });
  const complianceScore = Math.round((coveredClauses.size / TOTAL_ISO_CLAUSES) * 100);

  return {
    generatedAt: new Date().toISOString(),
    documents,
    audits: auditStats,
    capas: capaStats,
    incidents: incidentStats,
    risks: riskStats,
    complianceScore: Math.min(100, complianceScore),
    isoClausesCovered: coveredClauses.size,
    isoClausesTotal: TOTAL_ISO_CLAUSES,
  };
}

// ─── Auditor Access Provisioning ────────────────────────────────────────────

async function handleProvisionAuditorAccess(args: Record<string, unknown>) {
  const email = String(args.email || "").toLowerCase().trim();
  const name = String(args.name || "");
  const firm = typeof args.firm === "string" ? args.firm : "";
  const days = typeof args.days === "number" ? args.days : 14;
  if (!email) throw new Error("email is required.");
  if (!name) throw new Error("name is required.");

  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const expiresAt = new Date(Date.now() + days * 86400000).toISOString();

  // Find existing user by email
  const existingSnap = await db.collection(COLLECTIONS.USERS).where("email", "==", email).limit(1).get();
  let uid: string;

  if (existingSnap.empty) {
    // Create invite — user self-provisions via Firebase Auth sign-in, then accept-invite
    // creates the user doc. For auditor provisioning, seed a pending invite.
    const inviteRef = await db.collection(COLLECTIONS.USER_INVITES).add({
      email, name, role: "auditor", firm,
      auditorTokenExpiresAt: expiresAt,
      invitedAt: now, status: "pending",
    });
    uid = `invite:${inviteRef.id}`;
  } else {
    const existing = existingSnap.docs[0];
    uid = existing.id;
    await existing.ref.set({
      role: "auditor",
      auditorTokenExpiresAt: expiresAt,
      auditorFirm: firm || null,
      updatedAt: now,
    }, { merge: true });
  }

  return {
    ok: true,
    email,
    name,
    firm,
    uid,
    role: "auditor",
    expiresAt,
    days,
    loginUrl: "https://asiportal.live/login",
  };
}

async function handleRevokeAuditorAccess(args: Record<string, unknown>) {
  const email = String(args.email || "").toLowerCase().trim();
  if (!email) throw new Error("email is required.");
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();

  const snap = await db.collection(COLLECTIONS.USERS).where("email", "==", email).limit(1).get();
  if (snap.empty) return { ok: false, error: "User not found" };

  const ref = snap.docs[0].ref;
  await ref.set({
    auditorTokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
    auditorRevokedAt: now,
    updatedAt: now,
  }, { merge: true });

  return { ok: true, email, revokedAt: new Date().toISOString() };
}

// ─── IMS Document PDF Export ────────────────────────────────────────────────

async function handleExportImsDocumentPdf(args: Record<string, unknown>) {
  const id = String(args.id);
  const format = String(args.format || "standard");
  if (!id) throw new Error("id is required.");
  if (!["a3_framed", "a5_laminated", "standard"].includes(format)) {
    throw new Error("format must be 'a3_framed', 'a5_laminated', or 'standard'.");
  }

  const db = admin.firestore();
  const snap = await db.collection(COLLECTIONS.IMS_DOCUMENTS).doc(id).get();
  if (!snap.exists) throw new Error(`IMS document '${id}' not found.`);
  const doc = snap.data()!;

  // Build HTML template based on format. Caller renders HTML→PDF (Puppeteer, Playwright, or
  // browser print) since Next.js route handlers can't easily spin up headless Chrome inline.
  // Returning structured HTML + metadata allows GUARDIAN or the portal UI to finalise.
  const docId = String(doc.docId || "IMS-UNK-000");
  const revision = String(doc.revisionNumber || 1);
  const approvedDate = String(doc.approvedAt || doc.effectiveDate || "").split("T")[0] || "—";
  const title = String(doc.title || "Untitled");
  const content = String(doc.content || "");
  const portalUrl = `https://asiportal.live/dashboard/ims/documents/${id}`;

  const footer = `${docId} | Rev ${revision} | Approved ${approvedDate} | Verify master at ${portalUrl}`;

  const formatConfig: Record<string, { pageSize: string; orientation: string; fontSize: string; padding: string }> = {
    a3_framed: { pageSize: "A3", orientation: "portrait", fontSize: "14pt", padding: "40mm 30mm" },
    a5_laminated: { pageSize: "A5", orientation: "portrait", fontSize: "9pt", padding: "10mm 12mm" },
    standard: { pageSize: "A4", orientation: "portrait", fontSize: "11pt", padding: "25mm 20mm" },
  };
  const cfg = formatConfig[format];

  // Escape HTML content
  const escapeHtml = (s: string) => s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Basic markdown→HTML conversion (headings, bold, paragraphs, lists)
  const mdToHtml = (md: string) => {
    const lines = md.split("\n");
    let html = "";
    let inList = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^#{1,6}\s/.test(trimmed)) {
        if (inList) { html += "</ul>"; inList = false; }
        const level = trimmed.match(/^#+/)![0].length;
        const text = escapeHtml(trimmed.replace(/^#+\s/, ""));
        html += `<h${level}>${text}</h${level}>`;
      } else if (/^[-*]\s/.test(trimmed)) {
        if (!inList) { html += "<ul>"; inList = true; }
        html += `<li>${escapeHtml(trimmed.replace(/^[-*]\s/, ""))}</li>`;
      } else if (trimmed === "") {
        if (inList) { html += "</ul>"; inList = false; }
      } else {
        if (inList) { html += "</ul>"; inList = false; }
        let formatted = escapeHtml(trimmed);
        formatted = formatted.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
        html += `<p>${formatted}</p>`;
      }
    }
    if (inList) html += "</ul>";
    return html;
  };

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)} — ${docId}</title>
<style>
  @page { size: ${cfg.pageSize} ${cfg.orientation}; margin: 0; }
  body { font-family: "Inter", "Helvetica Neue", Arial, sans-serif; font-size: ${cfg.fontSize}; color: #1a1a1a; padding: ${cfg.padding}; margin: 0; line-height: 1.5; }
  .letterhead { border-bottom: 3px solid #8000FF; padding-bottom: 10mm; margin-bottom: 8mm; display: flex; justify-content: space-between; align-items: flex-start; }
  .brand { font-size: 1.6em; font-weight: 700; color: #8000FF; letter-spacing: -0.02em; }
  .brand-sub { font-size: 0.75em; color: #666; margin-top: 2mm; }
  .doc-meta { text-align: right; font-size: 0.8em; color: #444; }
  .doc-meta strong { color: #1a1a1a; }
  h1 { font-size: 1.8em; margin: 0 0 4mm 0; color: #1a1a1a; }
  h2 { font-size: 1.3em; margin: 6mm 0 3mm 0; color: #8000FF; border-bottom: 1px solid #ddd; padding-bottom: 1mm; }
  h3 { font-size: 1.1em; margin: 5mm 0 2mm 0; }
  p { margin: 0 0 3mm 0; }
  ul { margin: 0 0 4mm 4mm; padding: 0; }
  li { margin-bottom: 1mm; }
  .footer { position: fixed; bottom: 0; left: 0; right: 0; padding: 5mm 20mm; border-top: 1px solid #ccc; font-size: 0.65em; color: #666; text-align: center; background: #fff; }
  ${format === "a3_framed" ? ".frame-border { border: 4px solid #8000FF; padding: 10mm; border-radius: 4px; }" : ""}
  ${format === "a5_laminated" ? "body { font-size: 9pt; } h1 { font-size: 1.3em; } h2 { font-size: 1em; }" : ""}
</style>
</head>
<body>
  ${format === "a3_framed" ? '<div class="frame-border">' : ""}
  <div class="letterhead">
    <div>
      <div class="brand">ASI Australia</div>
      <div class="brand-sub">Integrated Management System</div>
    </div>
    <div class="doc-meta">
      <div><strong>${docId}</strong></div>
      <div>Revision ${revision}</div>
      <div>Approved ${approvedDate}</div>
    </div>
  </div>
  <h1>${escapeHtml(title)}</h1>
  ${mdToHtml(content)}
  ${format === "a3_framed" ? "</div>" : ""}
  <div class="footer">${escapeHtml(footer)}</div>
</body>
</html>`;

  return {
    id,
    docId,
    title,
    format,
    html,
    footer,
    metadata: {
      revision: Number(revision),
      approvedDate,
      portalUrl,
      pageSize: cfg.pageSize,
      orientation: cfg.orientation,
    },
  };
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
  if (typeof args.marketSegment === "string") {
    // Market segment filter — for sales stream only.
    // Leads without a marketSegment default to heavy_vehicle (SENTINEL).
    leads = leads.filter((l) => {
      if (String(l.streamType || "sales") !== "sales") return false;
      const seg = typeof l.marketSegment === "string" ? l.marketSegment : "heavy_vehicle";
      return seg === args.marketSegment;
    });
  }
  if (typeof args.supplierType === "string") {
    // Supplier type filter — for supply_chain stream only.
    // Leads without a supplierType default to 'vendor'.
    leads = leads.filter((l) => {
      if (String(l.streamType || "") !== "supply_chain") return false;
      const st = typeof l.supplierType === "string" ? l.supplierType : "vendor";
      return st === args.supplierType;
    });
  }
  if (typeof args.tradePipelineGroup === "string") {
    // Trade distribution high-level group filter — maps groups to stage sets.
    const groupStageMap: Record<string, string[]> = {
      prospects: ["identified", "researched", "qualified"],
      in_application: ["application_review", "vetting", "agreement_sent", "agreement_signed"],
      active_installers: ["onboarded", "first_order", "active"],
      inactive: ["paused", "terminated"],
    };
    const allowedStages = groupStageMap[String(args.tradePipelineGroup)] || [];
    leads = leads.filter((l) => {
      if (String(l.streamType || "") !== "trade_distribution") return false;
      return allowedStages.includes(String(l.stage || ""));
    });
  }
  return leads;
}

async function handleGetPipelineStats(args: Record<string, unknown>) {
  const db = admin.firestore();
  const snap = await db.collection(COLLECTIONS.LEADS).limit(500).get();
  const streamFilter = typeof args.streamType === "string" ? args.streamType : null;
  // Terminal stages across all three streams. Sales: won/lost. Supply chain: onboarded/inactive.
  // Trade distribution: terminated (paused is transitional, not terminal).
  const terminalStages = ["won", "lost", "onboarded", "inactive", "terminated"];
  const byStage: Record<string, number> = {};
  const byGrade: Record<string, number> = {};
  const byStream: Record<string, number> = { sales: 0, supply_chain: 0, trade_distribution: 0 };
  // Sub-breakdown of sales stream by market segment / owner.
  // heavy_vehicle → SENTINEL, light_vehicle + trade → MERCER.
  const salesByMarketSegment: Record<string, number> = { heavy_vehicle: 0, light_vehicle: 0, trade: 0 };
  // Sub-breakdown of supply_chain stream by supplier type (VANGUARD's classification).
  const supplyByType: Record<string, number> = {
    tier_1: 0, tier_2: 0, strategic_partner: 0, research_partner: 0, distributor: 0, vendor: 0,
  };
  // Trade distribution pipeline group breakdown (SHIELD's high-level view).
  const tradeByGroup: Record<string, number> = {
    prospects: 0, in_application: 0, active_installers: 0, inactive: 0, other: 0,
  };
  const TRADE_GROUP_STAGES: Record<string, string[]> = {
    prospects: ["identified", "researched", "qualified"],
    in_application: ["application_review", "vetting", "agreement_sent", "agreement_signed"],
    active_installers: ["onboarded", "first_order", "active"],
    inactive: ["paused", "terminated"],
  };
  let totalValue = 0;
  let overdueFollowUps = 0;
  let total = 0;
  const today = new Date().toISOString().split("T")[0];
  snap.docs.filter((d) => !d.data().isDeleted).forEach((d) => {
    const l = d.data() as Record<string, unknown>;
    const st = String(l.streamType || "sales");
    byStream[st] = (byStream[st] || 0) + 1;
    if (st === "sales") {
      const seg = typeof l.marketSegment === "string" ? l.marketSegment : "heavy_vehicle";
      salesByMarketSegment[seg] = (salesByMarketSegment[seg] || 0) + 1;
    }
    if (st === "supply_chain") {
      const sType = typeof l.supplierType === "string" ? l.supplierType : "vendor";
      supplyByType[sType] = (supplyByType[sType] || 0) + 1;
    }
    if (st === "trade_distribution") {
      const stageStr = String(l.stage || "");
      let matched = false;
      for (const [groupName, groupStages] of Object.entries(TRADE_GROUP_STAGES)) {
        if (groupStages.includes(stageStr)) {
          tradeByGroup[groupName] = (tradeByGroup[groupName] || 0) + 1;
          matched = true;
          break;
        }
      }
      if (!matched) tradeByGroup.other = (tradeByGroup.other || 0) + 1;
    }
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
  // Include Leads Register stats
  const regSnap = await db.collection(COLLECTIONS.LEADS_REGISTER).limit(500).get();
  const buildRegStats = (stream: string) => {
    const se = regSnap.docs.map((d) => d.data()).filter((e) => e.streamType === stream);
    const rs: Record<string, number> = { total: se.length, identified: 0, assessed: 0, shortlisted: 0, promoted: 0, parked: 0, rejected: 0, activePursuits: 0 };
    se.forEach((e) => {
      const s = String(e.status || "identified");
      rs[s] = (rs[s] || 0) + 1;
      if (s === "promoted" && e.promotedToPipeline) rs.activePursuits++;
    });
    return rs;
  };

  // Sales stream owner view: heavy_vehicle = SENTINEL, light_vehicle + trade = MERCER
  const salesByOwner = {
    sentinel: salesByMarketSegment.heavy_vehicle || 0,
    mercer: (salesByMarketSegment.light_vehicle || 0) + (salesByMarketSegment.trade || 0),
  };

  return {
    total,
    totalActive:
      total -
      (byStage["won"] || 0) -
      (byStage["lost"] || 0) -
      (byStage["onboarded"] || 0) -
      (byStage["inactive"] || 0) -
      (byStage["terminated"] || 0),
    hotLeads: (byGrade["A"] || 0) + (byGrade["B"] || 0),
    overdueFollowUps,
    totalEstimatedValue: totalValue,
    byStage,
    byGrade,
    byStream,
    salesByMarketSegment,
    salesByOwner,
    supplyByType,
    tradeByGroup,
    streamFilter: streamFilter || "all",
    registerStats: {
      supply_chain: buildRegStats("supply_chain"),
      sales: buildRegStats("sales"),
      trade_distribution: buildRegStats("trade_distribution"),
    },
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
  const tradeStageMap: Record<number, string> = {
    1: "identified", 2: "researched", 3: "qualified", 4: "application_review",
    5: "vetting", 6: "agreement_sent", 7: "agreement_signed", 8: "onboarded",
    9: "first_order", 10: "active", 11: "paused", 12: "terminated",
  };
  const stageMap =
    streamType === "supply_chain" ? supplyStageMap :
    streamType === "trade_distribution" ? tradeStageMap :
    salesStageMap;
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

  // Market segment: only relevant for sales stream. Default to heavy_vehicle
  // (SENTINEL) if omitted on a sales lead. Ignored for non-sales streams.
  const marketSegmentRaw = args.marketSegment as string | undefined;
  const validSegments = ["heavy_vehicle", "light_vehicle", "trade"];
  const marketSegment = streamType === "sales"
    ? (marketSegmentRaw && validSegments.includes(marketSegmentRaw) ? marketSegmentRaw : "heavy_vehicle")
    : undefined;

  // Supplier type: only relevant for supply_chain stream. Default to 'vendor'
  // (least-strategic classification) if omitted. Ignored for non-supply-chain streams.
  const supplierTypeRaw = args.supplierType as string | undefined;
  const validSupplierTypes = ["tier_1", "tier_2", "strategic_partner", "research_partner", "distributor", "vendor"];
  const supplierType = streamType === "supply_chain"
    ? (supplierTypeRaw && validSupplierTypes.includes(supplierTypeRaw) ? supplierTypeRaw : "vendor")
    : undefined;

  const payload = {
    leadNumber,
    streamType,
    ...(marketSegment ? { marketSegment } : {}),
    ...(supplierType ? { supplierType } : {}),
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
    osintHook: typeof args.osintHook === "string" ? args.osintHook : null,
    osintHookShort: typeof args.osintHookShort === "string"
      ? (args.osintHookShort.length > 160 ? args.osintHookShort.slice(0, 160) : args.osintHookShort)
      : null,
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
  const leads = (args.leads as unknown[]) || [];
  const scanDate = String(args.osintScanDate || "");
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();

  // ── NEW: Route to Leads Register when enabled ──────────────────────────
  if (LEADS_REGISTER_ENABLED) {
    let created = 0, skipped = 0;
    const results = [];
    for (const item of leads as Array<Record<string, unknown>>) {
      const company = String(item.company || "").trim();
      if (!company) { skipped++; continue; }
      // Dedup against existing register entries
      const existingReg = await db.collection(COLLECTIONS.LEADS_REGISTER)
        .where("company.name", "==", company).limit(1).get();
      if (!existingReg.empty) { skipped++; results.push({ companyName: company, action: "skipped-duplicate" }); continue; }

      const contactRaw = (item.contact || {}) as Record<string, string>;
      const sourceRaw = (item.source || {}) as Record<string, unknown>;
      const ref = await db.collection(COLLECTIONS.LEADS_REGISTER).add({
        streamType: String(item.streamType || item.stream_type || "sales"),
        status: "identified",
        source: {
          type: "osint", scanDate: sourceRaw.osint_scan_date || scanDate,
          scanId: sourceRaw.scan_id || null, findingId: sourceRaw.finding_id || null,
          notes: sourceRaw.finding || item.notes || null,
        },
        company: {
          name: company, website: item.companyWebsite || null,
          sector: String(item.sector || "other"), description: null,
          location: null, size: null,
        },
        contact: {
          name: contactRaw.name || null, role: contactRaw.title || null,
          email: contactRaw.email || null, phone: contactRaw.phone || null,
          linkedin: contactRaw.linkedin || null,
        },
        opportunity: {
          description: String(item.notes || ""), category: "other",
          potentialValue: typeof item.estimated_value === "number" ? item.estimated_value : null,
          potentialValueNotes: null, urgencyFlag: false, urgencyReason: null,
        },
        roeScore: null, stockdaleAssessment: null,
        promotedToPipeline: false, promotedDate: null, pipelineLeadId: null,
        weeklyDecision: null,
        notes: String(item.notes || ""),
        tags: ((item.tags as string[]) || []).concat(["osint", "auto-imported"]).filter((v, i, a) => a.indexOf(v) === i),
        createdAt: now, updatedAt: now, createdBy: "osint-auto",
      });
      created++;
      results.push({ id: ref.id, companyName: company, action: "created-in-register" });
    }
    return { created, updated: 0, skipped, destination: "leads_register", leads: results };
  }

  // ── LEGACY: Direct CRM import (when LEADS_REGISTER_ENABLED = false) ────
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
  return { created, updated, skipped, destination: "crm_direct", leads: results };
}

async function handleIngestOsintScan(args: Record<string, unknown>) {
  const scan = args.scan as Record<string, unknown>;
  if (!scan || !scan.date) throw new Error("Scan must include a 'date' field.");
  const db = admin.firestore();
  const date = String(scan.date);

  // Store the scan
  await db.collection(COLLECTIONS.OSINT_SCANS).doc(date).set(scan);

  // Auto-create entries from high-relevance opportunities
  const matrix = (scan.opportunityMatrix as Array<Record<string, unknown>>) || [];
  const now = admin.firestore.FieldValue.serverTimestamp();
  let leadsCreated = 0;

  for (const opp of matrix) {
    const score = typeof opp.relevanceScore === "number" ? opp.relevanceScore : 0;
    if (score < 4) continue;
    const name = String(opp.name || "");
    if (!name) continue;

    if (LEADS_REGISTER_ENABLED) {
      // Route to Leads Register
      const existingReg = await db.collection(COLLECTIONS.LEADS_REGISTER)
        .where("company.name", "==", name).limit(1).get();
      if (!existingReg.empty) continue;

      await db.collection(COLLECTIONS.LEADS_REGISTER).add({
        streamType: "sales",
        status: "identified",
        source: { type: "osint", scanDate: date, scanId: date, findingId: String(opp.rank || ""), notes: String(opp.action || "") },
        company: {
          name, website: null,
          sector: String(opp.pillar || "other").toLowerCase().replace(/\s+/g, "-"),
          description: null, location: null, size: null,
        },
        contact: { name: null, role: null, email: null, phone: null, linkedin: null },
        opportunity: {
          description: String(opp.action || ""), category: "other",
          potentialValue: null, potentialValueNotes: null,
          urgencyFlag: opp.urgency === "immediate", urgencyReason: opp.urgency === "immediate" ? "First-mover from OSINT" : null,
        },
        roeScore: null, stockdaleAssessment: null,
        promotedToPipeline: false, promotedDate: null, pipelineLeadId: null,
        weeklyDecision: null,
        notes: `[Auto-imported from OSINT ${date}] Rank #${opp.rank}. Urgency: ${opp.urgency}. ${opp.action}`,
        tags: ["osint", "auto-imported", String(opp.urgency || "")],
        createdAt: now, updatedAt: now, createdBy: "osint-auto",
      });
    } else {
      // Legacy: direct CRM import
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
    }
    leadsCreated++;
  }

  return {
    ok: true, date, destination: LEADS_REGISTER_ENABLED ? "leads_register" : "crm_direct",
    totalFindings: scan.metadata ? (scan.metadata as Record<string, unknown>).totalFindings : 0, leadsCreated,
  };
}

// ─── Leads Register handlers ─────────────────────────────────────────────────

const LEADS_REGISTER_ENABLED = true; // Toggle: true = OSINT → register, false = OSINT → CRM direct

function calcRoeGrade(total: number): string {
  if (total >= 80) return "A";
  if (total >= 60) return "B";
  if (total >= 40) return "C";
  if (total >= 20) return "D";
  return "E";
}

async function handleCreateLeadsRegisterEntry(args: Record<string, unknown>) {
  const company = args.company as Record<string, unknown> | undefined;
  if (!company?.name) throw new Error("company.name is required.");
  const streamType = String(args.streamType || "sales");
  if (streamType !== "sales" && streamType !== "supply_chain" && streamType !== "trade_distribution") {
    throw new Error("streamType must be 'sales', 'supply_chain', or 'trade_distribution'.");
  }
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const source = (args.source || { type: "manual" }) as Record<string, unknown>;
  const contact = (args.contact || {}) as Record<string, unknown>;
  const opportunity = (args.opportunity || {}) as Record<string, unknown>;

  const entry = {
    streamType,
    status: String(args.status || "identified"),
    source: {
      type: String(source.type || "manual"),
      scanDate: source.scanDate || null,
      scanId: source.scanId || null,
      findingId: source.findingId || null,
      notes: source.notes || null,
    },
    company: {
      name: String(company.name),
      website: company.website || null,
      sector: String(company.sector || "other"),
      description: company.description || null,
      location: company.location || null,
      size: company.size || null,
    },
    contact: {
      name: contact.name || null,
      role: contact.role || null,
      email: contact.email || null,
      phone: contact.phone || null,
      linkedin: contact.linkedin || null,
    },
    opportunity: {
      description: opportunity.description || null,
      category: String(opportunity.category || "other"),
      potentialValue: typeof opportunity.potentialValue === "number" ? opportunity.potentialValue : null,
      potentialValueNotes: opportunity.potentialValueNotes || null,
      urgencyFlag: Boolean(opportunity.urgencyFlag),
      urgencyReason: opportunity.urgencyReason || null,
    },
    roeScore: null,
    stockdaleAssessment: null,
    promotedToPipeline: false,
    promotedDate: null,
    pipelineLeadId: null,
    weeklyDecision: null,
    notes: String(args.notes || ""),
    tags: (args.tags as string[]) || [],
    osintHook: typeof args.osintHook === "string" ? args.osintHook : null,
    osintHookShort: typeof args.osintHookShort === "string"
      ? (args.osintHookShort.length > 160 ? args.osintHookShort.slice(0, 160) : args.osintHookShort)
      : null,
    createdAt: now,
    updatedAt: now,
    createdBy: String(args.createdBy || "mcp-agent"),
  };

  const ref = await db.collection(COLLECTIONS.LEADS_REGISTER).add(entry);
  return { id: ref.id, streamType, companyName: String(company.name), status: entry.status };
}

async function handleGetLeadsRegister(args: Record<string, unknown>) {
  const db = admin.firestore();
  const limit = safeLimit(args.limit, 50, 200);
  let q: admin.firestore.Query = db.collection(COLLECTIONS.LEADS_REGISTER).orderBy("createdAt", "desc");
  if (typeof args.streamType === "string") q = q.where("streamType", "==", args.streamType);
  if (typeof args.status === "string") q = q.where("status", "==", args.status);
  q = q.limit(limit + (typeof args.offset === "number" ? (args.offset as number) : 0));
  const snap = await q.get();
  let entries = snap.docs.map((d) => serializeDoc(d.id, d.data()));
  if (typeof args.roeGrade === "string") entries = entries.filter((e) => (e.roeScore as Record<string, unknown> | null)?.grade === args.roeGrade);
  if (args.urgencyFlag === true) entries = entries.filter((e) => (e.opportunity as Record<string, unknown> | null)?.urgencyFlag === true);
  if (typeof args.createdAfter === "string") entries = entries.filter((e) => String(e.createdAt || "") > String(args.createdAfter));
  const offset = typeof args.offset === "number" ? (args.offset as number) : 0;
  return entries.slice(offset, offset + limit);
}

async function handleGetLeadsRegisterEntry(args: Record<string, unknown>) {
  const id = String(args.id);
  const db = admin.firestore();
  const snap = await db.collection(COLLECTIONS.LEADS_REGISTER).doc(id).get();
  if (!snap.exists) return { error: "Register entry not found" };
  return serializeDoc(snap.id, snap.data()!);
}

async function handleUpdateLeadsRegisterEntry(args: Record<string, unknown>) {
  // Accept either `id` or `entryId` — ATHENA / LEDGER callers have
  // drifted on which name they use, and this is a hot path for the
  // daily outreach cycle so we take both.
  const id = String(args.id || args.entryId || "");
  if (!id) throw new Error("id (or entryId) is required.");
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();

  const updates: Record<string, unknown> = { updatedAt: now };

  if (typeof args.status === "string") updates.status = args.status;
  if (typeof args.notes === "string") updates.notes = args.notes;
  if (Array.isArray(args.tags)) updates.tags = args.tags;

  // OSINT hooks — SENTINEL/MERCER/SHIELD outreach gates on these.
  // osintHookShort is capped at 160 chars for subject-line use; anything
  // longer gets truncated rather than rejected so ATHENA's write doesn't
  // fail mid-cycle.
  if (typeof args.osintHook === "string") {
    updates.osintHook = args.osintHook;
  }
  if (typeof args.osintHookShort === "string") {
    const short = args.osintHookShort;
    updates.osintHookShort = short.length > 160 ? short.slice(0, 160) : short;
  }

  // ROE Score
  if (args.roeScore) {
    const roe = args.roeScore as Record<string, unknown>;
    const strategicFit = Number(roe.strategicFit || 0);
    const effortEstimate = Number(roe.effortEstimate || 0);
    const revenueImpact = Number(roe.revenueImpact || 0);
    const conversionProbability = Number(roe.conversionProbability || 0);
    const resourceRisk = Number(roe.resourceRisk || 0);
    const total = strategicFit + effortEstimate + revenueImpact + conversionProbability + resourceRisk;
    updates.roeScore = {
      strategicFit, effortEstimate, revenueImpact, conversionProbability, resourceRisk,
      total, grade: calcRoeGrade(total),
      assessedBy: String(roe.assessedBy || "mcp-agent"),
      assessedAt: new Date().toISOString(),
    };
  }

  // Stockdale Assessment
  if (args.stockdaleAssessment) {
    const sa = args.stockdaleAssessment as Record<string, unknown>;
    updates.stockdaleAssessment = {
      resourceAvailability: String(sa.resourceAvailability || "available"),
      gunpowderCheck: sa.gunpowderCheck || null,
      growthRisk: sa.growthRisk || null,
      flywheelImpact: sa.flywheelImpact || null,
      verdict: String(sa.verdict || "watch"),
      assessedAt: new Date().toISOString(),
    };
  }

  // Weekly Decision
  if (args.weeklyDecision) {
    const wd = args.weeklyDecision as Record<string, unknown>;
    updates.weeklyDecision = {
      weekEnding: String(wd.weekEnding || ""),
      decision: String(wd.decision || "defer"),
      reasoning: String(wd.reasoning || ""),
      decidedBy: String(wd.decidedBy || "director"),
    };
  }

  // Nested object merges
  if (args.contact) updates.contact = args.contact;
  if (args.opportunity) updates.opportunity = args.opportunity;
  if (args.company) updates.company = args.company;

  await db.collection(COLLECTIONS.LEADS_REGISTER).doc(id).set(updates, { merge: true });
  const updated = await db.collection(COLLECTIONS.LEADS_REGISTER).doc(id).get();
  return serializeDoc(updated.id, updated.data()!);
}

async function handlePromoteLeadsRegisterEntry(args: Record<string, unknown>) {
  const id = String(args.id);
  const db = admin.firestore();
  const snap = await db.collection(COLLECTIONS.LEADS_REGISTER).doc(id).get();
  if (!snap.exists) throw new Error("Register entry not found.");
  const entry = snap.data()!;

  // Validate status
  const status = String(entry.status);
  if (status !== "assessed" && status !== "shortlisted") {
    throw new Error(`Cannot promote entry with status '${status}'. Must be 'assessed' or 'shortlisted'.`);
  }

  // Validate ROE score
  if (!entry.roeScore || typeof entry.roeScore.total !== "number") {
    throw new Error("Cannot promote: ROE score is missing or incomplete.");
  }

  // Create CRM lead from register data
  const now = admin.firestore.FieldValue.serverTimestamp();
  const leadNumber = await nextMcpLeadNumber();
  const company = (entry.company || {}) as Record<string, unknown>;
  const contact = (entry.contact || {}) as Record<string, unknown>;
  const opportunity = (entry.opportunity || {}) as Record<string, unknown>;
  const roe = entry.roeScore as Record<string, unknown>;

  const contacts = contact.name ? [{
    id: crypto.randomUUID(), name: String(contact.name), title: String(contact.role || ""),
    email: String(contact.email || ""), phone: String(contact.phone || ""),
    linkedInUrl: String(contact.linkedin || ""), isPrimary: true,
  }] : [];

  const leadRef = await db.collection(COLLECTIONS.LEADS).add({
    leadNumber, companyName: String(company.name || ""),
    companyWebsite: company.website || null, sector: String(company.sector || "other"),
    isExistingClient: false, contacts,
    bantScore: Number(roe.total || 0), bantBreakdown: { budget: 10, authority: 10, need: 10, timing: 10, fit: 10 },
    leadGrade: calcLeadGrade(Number(roe.total || 0)),
    stage: "identified", stageHistory: [], stageEnteredAt: new Date().toISOString(),
    streamType: String(entry.streamType || "sales"),
    source: { type: "leads-register", registerId: id },
    estimatedValue: typeof opportunity.potentialValue === "number" ? opportunity.potentialValue : null,
    estimatedServices: [], painPoints: [], asiSolutionFit: [],
    outreachSequence: null,
    outreachStatus: { linkedInConnected: false, linkedInMessageSent: false, emailsSent: 0, responseReceived: false, meetingScheduled: false },
    outreachHistory: [], marketMode: "growth",
    nextAction: "Initial qualification and outreach planning",
    notes: `Promoted from Leads Register (${id}). ROE: ${roe.total}/100 (${roe.grade}).${opportunity.description ? " Opportunity: " + opportunity.description : ""}`,
    tags: [...(entry.tags || []), "from-register"],
    createdAt: now, updatedAt: now, createdBy: "leads-register", isDeleted: false,
  });

  // Update register entry
  await db.collection(COLLECTIONS.LEADS_REGISTER).doc(id).set({
    promotedToPipeline: true, promotedDate: new Date().toISOString(),
    pipelineLeadId: leadRef.id, status: "promoted", updatedAt: now,
  }, { merge: true });

  return { ok: true, registerId: id, leadId: leadRef.id, leadNumber, companyName: String(company.name || "") };
}

async function handleGetLeadsRegisterWeeklyShortlist(args: Record<string, unknown>) {
  const db = admin.firestore();
  const limit = Number(args.limit) || 5;
  let q: admin.firestore.Query = db.collection(COLLECTIONS.LEADS_REGISTER)
    .where("status", "in", ["assessed", "shortlisted"])
    .orderBy("createdAt", "desc")
    .limit(100);
  const snap = await q.get();
  let entries = snap.docs.map((d) => serializeDoc(d.id, d.data()));
  if (typeof args.streamType === "string") entries = entries.filter((e) => e.streamType === args.streamType);
  // Sort by ROE score descending
  entries.sort((a, b) => ((b.roeScore as Record<string, number> | null)?.total || 0) - ((a.roeScore as Record<string, number> | null)?.total || 0));
  return entries.slice(0, limit);
}

async function handleGetLeadsRegisterActivePursuits(args: Record<string, unknown>) {
  const db = admin.firestore();
  let q: admin.firestore.Query = db.collection(COLLECTIONS.LEADS_REGISTER)
    .where("status", "==", "promoted")
    .where("promotedToPipeline", "==", true);
  const snap = await q.get();
  let entries = snap.docs.map((d) => serializeDoc(d.id, d.data()));
  if (typeof args.streamType === "string") entries = entries.filter((e) => e.streamType === args.streamType);

  // Cross-reference with CRM to check if lead is still active
  const results = [];
  for (const entry of entries) {
    const leadId = entry.pipelineLeadId;
    let crmStatus: Record<string, unknown> | null = null;
    if (leadId) {
      const leadSnap = await db.collection(COLLECTIONS.LEADS).doc(String(leadId)).get();
      if (leadSnap.exists) {
        const ld = leadSnap.data()!;
        crmStatus = { stage: ld.stage, leadGrade: ld.leadGrade, nextAction: ld.nextAction, nextActionDate: ld.nextActionDate };
      }
    }
    results.push({ ...entry, crmStatus });
  }
  return results;
}

async function handleGetLeadsRegisterStats(args: Record<string, unknown>) {
  const db = admin.firestore();
  const snap = await db.collection(COLLECTIONS.LEADS_REGISTER).limit(500).get();
  const entries = snap.docs.map((d) => d.data());
  const streamFilter = typeof args.streamType === "string" ? args.streamType : null;

  const buildStreamStats = (stream: string) => {
    const se = entries.filter((e) => e.streamType === stream);
    const byStatus: Record<string, number> = {};
    const byGrade: Record<string, number> = {};
    let activePursuits = 0;
    let promoted = 0;

    se.forEach((e) => {
      const s = String(e.status || "identified");
      byStatus[s] = (byStatus[s] || 0) + 1;
      if (e.roeScore?.grade) {
        const g = String(e.roeScore.grade);
        byGrade[g] = (byGrade[g] || 0) + 1;
      }
      if (s === "promoted" && e.promotedToPipeline) activePursuits++;
      if (s === "promoted") promoted++;
    });

    return { total: se.length, byStatus, byGrade, activePursuits, promoted, ...byStatus };
  };

  if (streamFilter) {
    return { [streamFilter]: buildStreamStats(streamFilter) };
  }
  return {
    supply_chain: buildStreamStats("supply_chain"),
    sales: buildStreamStats("sales"),
    trade_distribution: buildStreamStats("trade_distribution"),
  };
}

// ─── R&D & Grants Management handlers (ARCHER / Sophie Archer) ───────────────

/**
 * Auto-number helper for R&D / Grants / Opportunity documents.
 * Uses a per-year sequence stored in rndCounters collection, matching
 * the pattern used by LD-/INC-/etc. auto-numbering elsewhere.
 */
async function nextRndNumber(prefix: "RND" | "GRT" | "OPP"): Promise<string> {
  const year = new Date().getFullYear();
  const db = admin.firestore();
  const counterRef = db.collection(COLLECTIONS.RND_COUNTERS).doc(prefix.toLowerCase());
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
  return `${prefix}-${year}-${String(num).padStart(4, "0")}`;
}

/**
 * Strip undefined values from an object before writing to Firestore.
 * Firestore rejects documents containing undefined — this mirrors the
 * pattern used in gmail audit logging.
 */
function stripUndefined<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// ─── R&D Projects ────────────────────────────────────────────────────────────

async function handleCreateRndProject(args: Record<string, unknown>) {
  if (!args.title) throw new Error("title is required.");
  if (!args.shortDescription) throw new Error("shortDescription is required.");
  if (!args.domain) throw new Error("domain is required.");

  const db = admin.firestore();
  const projectNumber = await nextRndNumber("RND");
  const now = admin.firestore.FieldValue.serverTimestamp();
  const nowIso = new Date().toISOString();

  const estimatedBudget = typeof args.estimatedBudget === "number" ? args.estimatedBudget : undefined;
  const requiresDirectorApproval = estimatedBudget !== undefined && estimatedBudget > 50000;

  const payload = stripUndefined({
    projectNumber,
    title: String(args.title),
    shortDescription: String(args.shortDescription),
    phase: typeof args.phase === "string" ? args.phase : "scoping",
    status: "active",
    priority: typeof args.priority === "string" ? args.priority : "medium",
    leadAgent: typeof args.leadAgent === "string" ? args.leadAgent : "ARCHER",
    sponsorAgent: typeof args.sponsorAgent === "string" ? args.sponsorAgent : undefined,
    stakeholders: Array.isArray(args.stakeholders) ? args.stakeholders : undefined,
    domain: String(args.domain),
    relatedProducts: Array.isArray(args.relatedProducts) ? args.relatedProducts : undefined,
    modernisationPath: typeof args.modernisationPath === "string" ? args.modernisationPath : undefined,
    estimatedBudget,
    actualSpendToDate: 0,
    fundingSources: [],
    approvals: {
      athena: { decision: "pending", approver: "ATHENA" },
      director: { decision: "pending", approver: "DIRECTOR" },
    },
    requiresDirectorApproval,
    targetCompletionDate: typeof args.targetCompletionDate === "string" ? args.targetCompletionDate : undefined,
    deliverables: Array.isArray(args.deliverables) ? args.deliverables : undefined,
    kpis: [],
    risks: [],
    imsDocumentIds: [],
    sourcedFrom: args.sourcedFrom && typeof args.sourcedFrom === "object" ? args.sourcedFrom : undefined,
    statusLog: [{
      phase: typeof args.phase === "string" ? args.phase : "scoping",
      status: "active",
      changedAt: nowIso,
      changedBy: typeof args.leadAgent === "string" ? args.leadAgent : "ARCHER",
      note: "Project created",
    }],
    notes: typeof args.notes === "string" ? args.notes : undefined,
    createdAt: now,
    createdBy: typeof args.leadAgent === "string" ? args.leadAgent : "ARCHER",
    updatedAt: now,
  });

  const ref = await db.collection(COLLECTIONS.RND_PROJECTS).add(payload);
  const doc = await ref.get();
  return serializeDoc(doc.id, doc.data()!);
}

async function handleGetRndProject(args: Record<string, unknown>) {
  const db = admin.firestore();
  const snap = await db.collection(COLLECTIONS.RND_PROJECTS).doc(String(args.projectId)).get();
  if (!snap.exists) throw new Error(`R&D project '${args.projectId}' not found.`);
  return serializeDoc(snap.id, snap.data()!);
}

async function handleGetRndProjects(args: Record<string, unknown>) {
  const db = admin.firestore();
  let q: admin.firestore.Query = db.collection(COLLECTIONS.RND_PROJECTS)
    .orderBy("updatedAt", "desc");
  if (typeof args.phase === "string") q = q.where("phase", "==", args.phase);
  if (typeof args.status === "string") q = q.where("status", "==", args.status);
  if (typeof args.domain === "string") q = q.where("domain", "==", args.domain);
  if (typeof args.leadAgent === "string") q = q.where("leadAgent", "==", args.leadAgent);
  const limit = typeof args.limit === "number" ? Math.min(Math.max(1, args.limit), 200) : 50;
  q = q.limit(limit);
  const snap = await q.get();
  return snap.docs.map((d) => serializeDoc(d.id, d.data()));
}

async function handleUpdateRndProject(args: Record<string, unknown>) {
  const db = admin.firestore();
  const id = String(args.projectId);
  const ref = db.collection(COLLECTIONS.RND_PROJECTS).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`R&D project '${id}' not found.`);
  const existing = snap.data()!;

  const updates: Record<string, unknown> = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };

  const stringFields = ["phase", "status", "priority", "title", "shortDescription", "modernisationPath", "targetCompletionDate", "imsComplianceStatus"];
  for (const f of stringFields) {
    if (typeof args[f] === "string") updates[f] = args[f];
  }
  if (typeof args.estimatedBudget === "number") {
    updates.estimatedBudget = args.estimatedBudget;
    updates.requiresDirectorApproval = args.estimatedBudget > 50000;
  }
  const arrayFields = ["deliverables", "stakeholders", "relatedProducts", "kpis", "risks", "imsDocumentIds"];
  for (const f of arrayFields) {
    if (Array.isArray(args[f])) updates[f] = args[f];
  }

  // Append to statusLog if phase or status changed
  if (typeof args.phase === "string" || typeof args.status === "string") {
    const statusLog = (existing.statusLog as unknown[]) || [];
    statusLog.push(stripUndefined({
      phase: typeof args.phase === "string" ? args.phase : undefined,
      status: typeof args.status === "string" ? args.status : undefined,
      changedAt: new Date().toISOString(),
      changedBy: typeof args.changedBy === "string" ? args.changedBy : "system",
      note: typeof args.changeNote === "string" ? args.changeNote : undefined,
    }));
    updates.statusLog = statusLog;
  }

  await ref.update(updates);
  const updated = await ref.get();
  return serializeDoc(updated.id, updated.data()!);
}

async function handleRecordRndProjectApproval(args: Record<string, unknown>) {
  const db = admin.firestore();
  const id = String(args.projectId);
  const approver = args.approver as "ATHENA" | "DIRECTOR";
  const decision = args.decision as "approved" | "rejected";

  const ref = db.collection(COLLECTIONS.RND_PROJECTS).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`R&D project '${id}' not found.`);
  const existing = snap.data()!;

  const key = approver === "ATHENA" ? "athena" : "director";
  const approvals = (existing.approvals as Record<string, unknown>) || {};
  approvals[key] = stripUndefined({
    decision,
    approver,
    decidedAt: new Date().toISOString(),
    decidedBy: typeof args.decidedBy === "string" ? args.decidedBy : approver,
    note: typeof args.note === "string" ? args.note : undefined,
  });

  const statusLog = (existing.statusLog as unknown[]) || [];
  statusLog.push({
    changedAt: new Date().toISOString(),
    changedBy: typeof args.decidedBy === "string" ? args.decidedBy : approver,
    note: `${approver} ${decision}${typeof args.note === "string" ? `: ${args.note}` : ""}`,
  });

  await ref.update({
    approvals,
    statusLog,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  const updated = await ref.get();
  return serializeDoc(updated.id, updated.data()!);
}

async function handleLogRndProjectSpend(args: Record<string, unknown>) {
  const db = admin.firestore();
  const id = String(args.projectId);
  const amount = Number(args.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("amount must be a positive number.");

  const ref = db.collection(COLLECTIONS.RND_PROJECTS).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`R&D project '${id}' not found.`);
  const existing = snap.data()!;
  const current = typeof existing.actualSpendToDate === "number" ? existing.actualSpendToDate : 0;
  const newTotal = current + amount;

  const statusLog = (existing.statusLog as unknown[]) || [];
  statusLog.push({
    changedAt: new Date().toISOString(),
    changedBy: "LEDGER",
    note: `Spend logged: +$${amount.toFixed(2)} (total: $${newTotal.toFixed(2)})${typeof args.note === "string" ? ` — ${args.note}` : ""}`,
  });

  await ref.update({
    actualSpendToDate: newTotal,
    statusLog,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { projectId: id, amountAdded: amount, actualSpendToDate: newTotal };
}

// ─── Grants Pipeline ─────────────────────────────────────────────────────────

async function handleCreateGrantApplication(args: Record<string, unknown>) {
  if (!args.programmeName) throw new Error("programmeName is required.");
  if (!args.programmeBody) throw new Error("programmeBody is required.");
  if (!args.fundingType) throw new Error("fundingType is required.");

  const db = admin.firestore();
  const grantNumber = await nextRndNumber("GRT");
  const now = admin.firestore.FieldValue.serverTimestamp();
  const stage = typeof args.stage === "string" ? args.stage : "monitoring";

  const payload = stripUndefined({
    grantNumber,
    programmeName: String(args.programmeName),
    programmeBody: String(args.programmeBody),
    programmeUrl: typeof args.programmeUrl === "string" ? args.programmeUrl : undefined,
    roundName: typeof args.roundName === "string" ? args.roundName : undefined,
    stage,
    fundingType: String(args.fundingType),
    awardValue: typeof args.awardValue === "number" ? args.awardValue : undefined,
    linkedRndProjectIds: Array.isArray(args.linkedRndProjectIds) ? args.linkedRndProjectIds : [],
    requirements: [],
    roundOpensAt: typeof args.roundOpensAt === "string" ? args.roundOpensAt : undefined,
    submissionDeadline: typeof args.submissionDeadline === "string" ? args.submissionDeadline : undefined,
    expectedDecisionDate: typeof args.expectedDecisionDate === "string" ? args.expectedDecisionDate : undefined,
    acquittalDueDate: typeof args.acquittalDueDate === "string" ? args.acquittalDueDate : undefined,
    internalApprovals: {
      athena: { decision: "pending", approver: "ATHENA" },
      director: { decision: "pending", approver: "DIRECTOR" },
    },
    draftDocumentIds: [],
    submittedDocumentIds: [],
    compliance: { reportsRequired: [], milestonesRequired: [] },
    statusLog: [{
      stage,
      changedAt: new Date().toISOString(),
      changedBy: "ARCHER",
      note: "Grant application created",
    }],
    notes: typeof args.notes === "string" ? args.notes : undefined,
    createdAt: now,
    createdBy: "ARCHER",
    updatedAt: now,
  });

  const ref = await db.collection(COLLECTIONS.GRANT_APPLICATIONS).add(payload);
  const doc = await ref.get();
  return serializeDoc(doc.id, doc.data()!);
}

async function handleGetGrantApplication(args: Record<string, unknown>) {
  const db = admin.firestore();
  const snap = await db.collection(COLLECTIONS.GRANT_APPLICATIONS).doc(String(args.grantId)).get();
  if (!snap.exists) throw new Error(`Grant application '${args.grantId}' not found.`);
  return serializeDoc(snap.id, snap.data()!);
}

async function handleGetGrantApplications(args: Record<string, unknown>) {
  const db = admin.firestore();
  let q: admin.firestore.Query = db.collection(COLLECTIONS.GRANT_APPLICATIONS)
    .orderBy("updatedAt", "desc");
  if (typeof args.stage === "string") q = q.where("stage", "==", args.stage);
  if (typeof args.programmeBody === "string") q = q.where("programmeBody", "==", args.programmeBody);
  if (typeof args.fundingType === "string") q = q.where("fundingType", "==", args.fundingType);
  const limit = typeof args.limit === "number" ? Math.min(Math.max(1, args.limit), 200) : 50;
  q = q.limit(limit);
  const snap = await q.get();
  let results = snap.docs.map((d) => serializeDoc(d.id, d.data()));
  if (args.awardedOnly === true) {
    results = results.filter((r) => r.stage === "approved" || r.stage === "acquitted");
  }
  return results;
}

async function handleUpdateGrantApplication(args: Record<string, unknown>) {
  const db = admin.firestore();
  const id = String(args.grantId);
  const ref = db.collection(COLLECTIONS.GRANT_APPLICATIONS).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Grant application '${id}' not found.`);
  const existing = snap.data()!;

  const updates: Record<string, unknown> = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };

  const stringFields = ["stage", "submissionDeadline", "expectedDecisionDate", "acquittalDueDate"];
  for (const f of stringFields) {
    if (typeof args[f] === "string") updates[f] = args[f];
  }
  if (typeof args.awardValue === "number") updates.awardValue = args.awardValue;
  if (typeof args.awardedAmount === "number") updates.awardedAmount = args.awardedAmount;

  const arrayFields = ["requirements", "linkedRndProjectIds", "draftDocumentIds", "submittedDocumentIds"];
  for (const f of arrayFields) {
    if (Array.isArray(args[f])) updates[f] = args[f];
  }

  // Auto-set submittedAt when stage moves to submitted
  if (args.stage === "submitted" && !existing.submittedAt) {
    updates.submittedAt = admin.firestore.FieldValue.serverTimestamp();
  }
  // Auto-set decisionReceivedAt when stage moves to approved/rejected
  if ((args.stage === "approved" || args.stage === "rejected") && !existing.decisionReceivedAt) {
    updates.decisionReceivedAt = admin.firestore.FieldValue.serverTimestamp();
  }

  // Append to statusLog if stage changed
  if (typeof args.stage === "string" && args.stage !== existing.stage) {
    const statusLog = (existing.statusLog as unknown[]) || [];
    statusLog.push(stripUndefined({
      stage: args.stage,
      changedAt: new Date().toISOString(),
      changedBy: typeof args.changedBy === "string" ? args.changedBy : "system",
      note: typeof args.changeNote === "string" ? args.changeNote : undefined,
    }));
    updates.statusLog = statusLog;
  }

  await ref.update(updates);
  const updated = await ref.get();
  return serializeDoc(updated.id, updated.data()!);
}

async function handleRecordGrantInternalApproval(args: Record<string, unknown>) {
  const db = admin.firestore();
  const id = String(args.grantId);
  const approver = args.approver as "ATHENA" | "DIRECTOR";
  const decision = args.decision as "approved" | "rejected";

  const ref = db.collection(COLLECTIONS.GRANT_APPLICATIONS).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Grant application '${id}' not found.`);
  const existing = snap.data()!;

  const key = approver === "ATHENA" ? "athena" : "director";
  const internalApprovals = (existing.internalApprovals as Record<string, unknown>) || {};
  internalApprovals[key] = stripUndefined({
    decision,
    approver,
    decidedAt: new Date().toISOString(),
    decidedBy: typeof args.decidedBy === "string" ? args.decidedBy : approver,
    note: typeof args.note === "string" ? args.note : undefined,
  });

  const statusLog = (existing.statusLog as unknown[]) || [];
  statusLog.push({
    stage: String(existing.stage || "scoping"),
    changedAt: new Date().toISOString(),
    changedBy: typeof args.decidedBy === "string" ? args.decidedBy : approver,
    note: `${approver} ${decision}${typeof args.note === "string" ? `: ${args.note}` : ""}`,
  });

  await ref.update({
    internalApprovals,
    statusLog,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  const updated = await ref.get();
  return serializeDoc(updated.id, updated.data()!);
}

async function handleLogGrantComplianceEvent(args: Record<string, unknown>) {
  const db = admin.firestore();
  const id = String(args.grantId);
  const eventType = String(args.eventType);
  const refName = String(args.referenceName);

  const ref = db.collection(COLLECTIONS.GRANT_APPLICATIONS).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Grant application '${id}' not found.`);
  const existing = snap.data()!;

  const compliance = (existing.compliance as Record<string, unknown>) || { reportsRequired: [], milestonesRequired: [] };
  const reports = (compliance.reportsRequired as Array<Record<string, unknown>>) || [];
  const milestones = (compliance.milestonesRequired as Array<Record<string, unknown>>) || [];

  if (eventType === "report_submitted" || eventType === "report_accepted") {
    const idx = reports.findIndex((r) => r.reportType === refName);
    const now = new Date().toISOString();
    if (idx >= 0) {
      reports[idx].status = eventType === "report_submitted" ? "submitted" : "accepted";
      if (eventType === "report_submitted") reports[idx].submittedAt = now;
    } else {
      reports.push({
        reportType: refName,
        dueDate: now.split("T")[0],
        status: eventType === "report_submitted" ? "submitted" : "accepted",
        submittedAt: eventType === "report_submitted" ? now : undefined,
      });
    }
  } else if (eventType === "milestone_achieved" || eventType === "milestone_missed") {
    const idx = milestones.findIndex((m) => m.milestone === refName);
    const now = new Date().toISOString();
    if (idx >= 0) {
      milestones[idx].status = eventType === "milestone_achieved" ? "achieved" : "missed";
      if (eventType === "milestone_achieved") milestones[idx].achievedAt = now;
    } else {
      milestones.push({
        milestone: refName,
        dueDate: now.split("T")[0],
        status: eventType === "milestone_achieved" ? "achieved" : "missed",
        achievedAt: eventType === "milestone_achieved" ? now : undefined,
      });
    }
  }

  compliance.reportsRequired = reports;
  compliance.milestonesRequired = milestones;

  const statusLog = (existing.statusLog as unknown[]) || [];
  statusLog.push({
    stage: String(existing.stage || "approved"),
    changedAt: new Date().toISOString(),
    changedBy: "ARCHER",
    note: `Compliance: ${eventType} — ${refName}${typeof args.note === "string" ? ` (${args.note})` : ""}`,
  });

  await ref.update({
    compliance,
    statusLog,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  const updated = await ref.get();
  return serializeDoc(updated.id, updated.data()!);
}

async function handleGetGrantsDashboard() {
  const db = admin.firestore();
  const snap = await db.collection(COLLECTIONS.GRANT_APPLICATIONS).get();
  const grants = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Array<Record<string, unknown>>;

  const currentYear = new Date().getFullYear();
  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysOut = new Date(Date.now() + 30 * 86400_000).toISOString().split("T")[0];

  const byStage: Record<string, number> = {};
  let totalAwardedYtd = 0;
  let totalPotentialInFlight = 0;
  const upcomingDeadlines: Array<Record<string, unknown>> = [];
  const overdueCompliance: Array<Record<string, unknown>> = [];

  for (const g of grants) {
    const stage = String(g.stage || "monitoring");
    byStage[stage] = (byStage[stage] || 0) + 1;

    // Awarded YTD
    if ((stage === "approved" || stage === "acquitted") && g.decisionReceivedAt) {
      const decided = g.decisionReceivedAt as { toMillis?: () => number } | undefined;
      if (decided?.toMillis && new Date(decided.toMillis()).getFullYear() === currentYear) {
        if (typeof g.awardedAmount === "number") totalAwardedYtd += g.awardedAmount;
      }
    }

    // Potential in flight
    const inFlight = ["scoping", "drafting", "internal_review", "submitted", "under_review", "interview_stage"];
    if (inFlight.includes(stage) && typeof g.awardValue === "number") {
      totalPotentialInFlight += g.awardValue;
    }

    // Upcoming submission deadlines (next 30 days)
    if (typeof g.submissionDeadline === "string" && g.submissionDeadline >= today && g.submissionDeadline <= thirtyDaysOut) {
      upcomingDeadlines.push({
        grantId: g.id,
        grantNumber: g.grantNumber,
        programmeName: g.programmeName,
        submissionDeadline: g.submissionDeadline,
        stage,
      });
    }

    // Overdue compliance
    const compliance = g.compliance as { reportsRequired?: Array<Record<string, unknown>>; milestonesRequired?: Array<Record<string, unknown>> } | undefined;
    if (compliance) {
      for (const r of compliance.reportsRequired || []) {
        if (r.status === "pending" && typeof r.dueDate === "string" && r.dueDate < today) {
          overdueCompliance.push({
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
          overdueCompliance.push({
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

  upcomingDeadlines.sort((a, b) => String(a.submissionDeadline).localeCompare(String(b.submissionDeadline)));

  return {
    totalApplications: grants.length,
    byStage,
    totalAwardedYtd,
    totalPotentialInFlight,
    upcomingDeadlines,
    overdueCompliance,
    generatedAt: new Date().toISOString(),
  };
}

// ─── R&D Opportunity Log ─────────────────────────────────────────────────────

async function handleLogRndOpportunity(args: Record<string, unknown>) {
  if (!args.title) throw new Error("title is required.");
  if (!args.description) throw new Error("description is required.");
  if (!args.type) throw new Error("type is required.");
  if (!args.sourcedBy) throw new Error("sourcedBy is required.");

  const db = admin.firestore();
  const opportunityNumber = await nextRndNumber("OPP");
  const now = admin.firestore.FieldValue.serverTimestamp();

  const payload = stripUndefined({
    opportunityNumber,
    title: String(args.title),
    description: String(args.description),
    type: String(args.type),
    sourcedBy: String(args.sourcedBy),
    sourceContext: typeof args.sourceContext === "string" ? args.sourceContext : undefined,
    sourceReferences: Array.isArray(args.sourceReferences) ? args.sourceReferences : undefined,
    status: "new",
    notes: typeof args.notes === "string" ? args.notes : undefined,
    createdAt: now,
    createdBy: String(args.sourcedBy),
    updatedAt: now,
  });

  const ref = await db.collection(COLLECTIONS.RND_OPPORTUNITY_LOG).add(payload);
  const doc = await ref.get();
  return serializeDoc(doc.id, doc.data()!);
}

async function handleGetRndOpportunities(args: Record<string, unknown>) {
  const db = admin.firestore();
  let q: admin.firestore.Query = db.collection(COLLECTIONS.RND_OPPORTUNITY_LOG)
    .orderBy("createdAt", "desc");
  if (typeof args.status === "string") q = q.where("status", "==", args.status);
  if (typeof args.type === "string") q = q.where("type", "==", args.type);
  if (typeof args.sourcedBy === "string") q = q.where("sourcedBy", "==", args.sourcedBy);
  const limit = typeof args.limit === "number" ? Math.min(Math.max(1, args.limit), 200) : 50;
  q = q.limit(limit);
  const snap = await q.get();
  return snap.docs.map((d) => serializeDoc(d.id, d.data()));
}

async function handleGetOpportunitiesAwaitingReview(args: Record<string, unknown>) {
  const db = admin.firestore();
  const limit = typeof args.limit === "number" ? Math.min(Math.max(1, args.limit), 200) : 50;
  const today = new Date().toISOString().split("T")[0];

  // New + under_review queue
  const pendingSnap = await db.collection(COLLECTIONS.RND_OPPORTUNITY_LOG)
    .where("status", "in", ["new", "under_review"])
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  const pending = pendingSnap.docs.map((d) => serializeDoc(d.id, d.data()));

  // Parked opportunities ready for revisit
  const parkedSnap = await db.collection(COLLECTIONS.RND_OPPORTUNITY_LOG)
    .where("status", "==", "parked")
    .limit(limit)
    .get();
  const readyForRevisit = parkedSnap.docs
    .map((d) => serializeDoc(d.id, d.data()))
    .filter((o) => typeof o.parkedUntil === "string" && o.parkedUntil <= today);

  return {
    pending,
    readyForRevisit,
    pendingCount: pending.length,
    revisitCount: readyForRevisit.length,
  };
}

async function handleReviewRndOpportunity(args: Record<string, unknown>) {
  const db = admin.firestore();
  const id = String(args.opportunityId);
  const decision = args.decision as "accept" | "park" | "reject";

  const ref = db.collection(COLLECTIONS.RND_OPPORTUNITY_LOG).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Opportunity '${id}' not found.`);

  const updates: Record<string, unknown> = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  // Score (if any dimension provided)
  const hasAnyScore = ["strategicFit", "technicalFeasibility", "fundingPotential", "impactSize"]
    .some((f) => typeof args[f] === "number");
  if (hasAnyScore) {
    const strategicFit = typeof args.strategicFit === "number" ? args.strategicFit : 0;
    const technicalFeasibility = typeof args.technicalFeasibility === "number" ? args.technicalFeasibility : 0;
    const fundingPotential = typeof args.fundingPotential === "number" ? args.fundingPotential : 0;
    const impactSize = typeof args.impactSize === "number" ? args.impactSize : 0;
    const overall = (strategicFit + technicalFeasibility + fundingPotential + impactSize) / 4;
    updates.reviewScore = stripUndefined({
      strategicFit,
      technicalFeasibility,
      fundingPotential,
      impactSize,
      overall: Math.round(overall * 10) / 10,
      reviewedAt: new Date().toISOString(),
      reviewedBy: typeof args.reviewedBy === "string" ? args.reviewedBy : "ARCHER",
      reviewNotes: typeof args.reviewNotes === "string" ? args.reviewNotes : undefined,
    });
  }

  // Decision
  if (decision === "accept") {
    updates.status = "accepted";
  } else if (decision === "park") {
    updates.status = "parked";
    if (typeof args.parkedUntil === "string") updates.parkedUntil = args.parkedUntil;
  } else if (decision === "reject") {
    updates.status = "rejected";
    if (typeof args.rejectionReason === "string") updates.rejectionReason = args.rejectionReason;
  }

  await ref.update(updates);
  const updated = await ref.get();
  return serializeDoc(updated.id, updated.data()!);
}

async function handleConvertOpportunityToProject(args: Record<string, unknown>) {
  const db = admin.firestore();
  const oppId = String(args.opportunityId);
  const oppRef = db.collection(COLLECTIONS.RND_OPPORTUNITY_LOG).doc(oppId);
  const oppSnap = await oppRef.get();
  if (!oppSnap.exists) throw new Error(`Opportunity '${oppId}' not found.`);
  const opp = oppSnap.data()!;

  // Create the project, prefilled from the opportunity
  const projectArgs: Record<string, unknown> = {
    title: typeof args.title === "string" ? args.title : String(opp.title),
    shortDescription: typeof args.shortDescription === "string"
      ? args.shortDescription
      : String(opp.description).slice(0, 200),
    domain: String(args.domain),
    priority: typeof args.priority === "string" ? args.priority : "medium",
    estimatedBudget: typeof args.estimatedBudget === "number" ? args.estimatedBudget : undefined,
    targetCompletionDate: typeof args.targetCompletionDate === "string" ? args.targetCompletionDate : undefined,
    leadAgent: typeof args.leadAgent === "string" ? args.leadAgent : "ARCHER",
    sourcedFrom: {
      type: "opportunity_log",
      reference: oppId,
      note: `Converted from opportunity ${opp.opportunityNumber}`,
    },
    notes: `Converted from opportunity ${opp.opportunityNumber} (${opp.title}). Original signal from ${opp.sourcedBy}.`,
  };

  const project = await handleCreateRndProject(projectArgs);
  const projectId = (project as { id: string }).id;

  // Update the opportunity
  await oppRef.update({
    status: "converted",
    convertedToProjectId: projectId,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    opportunityId: oppId,
    projectId,
    project,
  };
}

// ─── R&D Nomination handlers ────────────────────────────────────────────────
// Thin MCP wrappers over the same logic that /api/rnd/nomination runs — lets
// Archer pull her own queue, write a pre-feas brief, and (for Director-level
// operations) approve/reject from her agent.

function clampPreFeasScore(n: unknown): number {
  const v = typeof n === "number" ? n : 0;
  return Math.max(1, Math.min(5, Math.round(v)));
}

async function handleGetRndNominations(args: Record<string, unknown>) {
  const db = admin.firestore();
  const limit = safeLimit(args.limit, 50, 200);
  let q: admin.firestore.Query = db
    .collection(COLLECTIONS.RND_PROJECT_NOMINATIONS)
    .orderBy("createdAt", "desc");
  if (typeof args.status === "string") q = q.where("status", "==", args.status);
  q = q.limit(limit);
  const snap = await q.get();
  return snap.docs.map((d) => serializeDoc(d.id, d.data()));
}

async function handleGetRndNomination(args: Record<string, unknown>) {
  const id = String(args.nominationId || "");
  if (!id) throw new Error("nominationId is required.");
  const db = admin.firestore();
  const snap = await db.collection(COLLECTIONS.RND_PROJECT_NOMINATIONS).doc(id).get();
  if (!snap.exists) throw new Error(`Nomination '${id}' not found.`);
  return serializeDoc(snap.id, snap.data()!);
}

async function handleUpdateRndNominationPrefeas(args: Record<string, unknown>) {
  const id = String(args.nominationId || "");
  if (!id) throw new Error("nominationId is required.");
  if (!args.marketRegulatoryContext || !args.grantMatch || !args.verdict) {
    throw new Error("marketRegulatoryContext, grantMatch, and verdict are required.");
  }
  const db = admin.firestore();
  const ref = db.collection(COLLECTIONS.RND_PROJECT_NOMINATIONS).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Nomination '${id}' not found.`);

  const preFeas = {
    strategicFitScore: clampPreFeasScore(args.strategicFitScore),
    technicalFeasibilityScore: clampPreFeasScore(args.technicalFeasibilityScore),
    marketRegulatoryContext: String(args.marketRegulatoryContext),
    grantMatch: String(args.grantMatch),
    costEnvelopeMin: typeof args.costEnvelopeMin === "number" ? args.costEnvelopeMin : null,
    costEnvelopeMax: typeof args.costEnvelopeMax === "number" ? args.costEnvelopeMax : null,
    flagsAndRisks: Array.isArray(args.flagsAndRisks)
      ? (args.flagsAndRisks as string[]).filter((s) => typeof s === "string")
      : [],
    verdict: String(args.verdict),
    writtenBy: "ARCHER",
    writtenAt: new Date().toISOString(),
  };

  await ref.update({
    preFeas,
    status: "prefeas_complete",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    nominationId: id,
    status: "prefeas_complete",
    preFeas,
  };
}

async function handleApproveRndNomination(args: Record<string, unknown>) {
  const id = String(args.nominationId || "");
  if (!id) throw new Error("nominationId is required.");
  const db = admin.firestore();
  const ref = db.collection(COLLECTIONS.RND_PROJECT_NOMINATIONS).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Nomination '${id}' not found.`);
  const existing = snap.data()!;

  const actorName = "mcp-agent";
  const nowIso = new Date().toISOString();
  const now = admin.firestore.FieldValue.serverTimestamp();

  // Create the RndProject via the canonical handler so project numbers,
  // counters, and defaults stay consistent.
  const title = String(existing.title || "Untitled R&D Project");
  const rationale = String(existing.rationale || "");
  const preFeas = (existing.preFeas || {}) as Record<string, unknown>;
  const estimatedBudget =
    typeof preFeas.costEnvelopeMax === "number"
      ? preFeas.costEnvelopeMax
      : typeof preFeas.costEnvelopeMin === "number"
        ? preFeas.costEnvelopeMin
        : undefined;

  const projectArgs: Record<string, unknown> = {
    title,
    shortDescription: rationale.slice(0, 400),
    domain: existing.domain || "other",
    priority: existing.priority || "medium",
    leadAgent: "ARCHER",
    estimatedBudget,
    targetCompletionDate: existing.targetCompletionDate,
    notes: `Approved from nomination ${id}.${
      typeof args.note === "string" && args.note.trim() ? ` ${args.note.trim()}` : ""
    }`,
  };
  const created = await handleCreateRndProject(projectArgs);
  const projectId = (created as { id: string }).id;

  // Stamp director approval on the project so it's closed-loop.
  try {
    await db.collection(COLLECTIONS.RND_PROJECTS).doc(projectId).update({
      approvals: {
        athena: { decision: "pending", approver: "ATHENA" },
        director: {
          decision: "approved",
          approver: "DIRECTOR",
          decidedAt: nowIso,
          decidedBy: actorName,
          note: typeof args.note === "string" ? args.note : "Approved via nomination pipeline (MCP).",
        },
      },
      nominationId: id,
      nominationPreFeas: existing.preFeas || null,
      updatedAt: now,
    });
  } catch (err) {
    console.error("[approve_rnd_nomination] Failed to stamp approval on project:", err);
  }

  // Draft grant applications against selected programmes.
  const programmeIds = Array.isArray(args.createGrantDraftsFor)
    ? (args.createGrantDraftsFor as string[]).filter((s) => typeof s === "string")
    : ((existing.selectedProgrammeIds as string[] | undefined) || []);
  const convertedGrantIds: string[] = [];
  for (const programmeId of programmeIds) {
    try {
      const progSnap = await db
        .collection(COLLECTIONS.RND_GRANT_PROGRAMMES)
        .doc(programmeId)
        .get();
      if (!progSnap.exists) continue;
      const prog = progSnap.data()!;
      const grantNumber = await nextRndNumber("GRT");
      const grantRef = await db.collection(COLLECTIONS.GRANT_APPLICATIONS).add({
        grantNumber,
        programmeName: prog.programmeName,
        programmeBody: prog.programmeBody,
        programmeId,
        fundingType: prog.fundingType || "grant",
        stage: "scoping",
        awardValue: prog.typicalValueMax || prog.typicalValueMin || null,
        linkedRndProjectIds: [projectId],
        nominationId: id,
        statusLog: [
          {
            stage: "scoping",
            changedAt: nowIso,
            changedBy: actorName,
            note: `Drafted from nomination ${id} approval (project ${projectId}).`,
          },
        ],
        createdAt: now,
        updatedAt: now,
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
    directorNote: typeof args.note === "string" ? args.note : null,
    directorDecidedAt: nowIso,
    directorDecidedBy: actorName,
    convertedProjectId: projectId,
    convertedGrantIds,
    updatedAt: now,
  });

  return {
    ok: true,
    nominationId: id,
    status: "approved",
    convertedProjectId: projectId,
    convertedGrantIds,
  };
}

async function handleRejectRndNomination(args: Record<string, unknown>) {
  const id = String(args.nominationId || "");
  if (!id) throw new Error("nominationId is required.");
  const db = admin.firestore();
  const ref = db.collection(COLLECTIONS.RND_PROJECT_NOMINATIONS).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Nomination '${id}' not found.`);

  const nowIso = new Date().toISOString();
  await ref.update({
    status: "rejected",
    directorDecision: "rejected",
    directorNote: typeof args.note === "string" ? args.note : null,
    directorDecidedAt: nowIso,
    directorDecidedBy: "mcp-agent",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ok: true, nominationId: id, status: "rejected" };
}

// ─── Grant Programme Watchlist handlers ──────────────────────────────────────

async function handleCreateGrantProgramme(args: Record<string, unknown>) {
  if (!args.programmeName) throw new Error("programmeName is required.");
  if (!args.programmeBody) throw new Error("programmeBody is required.");
  if (!args.level) throw new Error("level is required.");
  if (!args.description) throw new Error("description is required.");
  if (!args.fundingType) throw new Error("fundingType is required.");
  if (!args.frequency) throw new Error("frequency is required.");

  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();

  const payload = stripUndefined({
    programmeName: String(args.programmeName),
    programmeBody: String(args.programmeBody),
    level: String(args.level),
    jurisdiction: typeof args.jurisdiction === "string" ? args.jurisdiction : undefined,
    description: String(args.description),
    programmeUrl: typeof args.programmeUrl === "string" ? args.programmeUrl : undefined,
    fundingType: String(args.fundingType),
    typicalValueMin: typeof args.typicalValueMin === "number" ? args.typicalValueMin : undefined,
    typicalValueMax: typeof args.typicalValueMax === "number" ? args.typicalValueMax : undefined,
    frequency: String(args.frequency),
    nextRoundOpensAt: typeof args.nextRoundOpensAt === "string" ? args.nextRoundOpensAt : undefined,
    typicalDeadlineLead: typeof args.typicalDeadlineLead === "string" ? args.typicalDeadlineLead : undefined,
    fitScore: typeof args.fitScore === "number" ? args.fitScore : undefined,
    eligibilityNotes: typeof args.eligibilityNotes === "string" ? args.eligibilityNotes : undefined,
    applicabilityNotes: typeof args.applicabilityNotes === "string" ? args.applicabilityNotes : undefined,
    isActive: true,
    tags: Array.isArray(args.tags) ? args.tags : undefined,
    notes: typeof args.notes === "string" ? args.notes : undefined,
    createdAt: now,
    createdBy: "ARCHER",
    updatedAt: now,
  });

  const ref = await db.collection(COLLECTIONS.RND_GRANT_PROGRAMMES).add(payload);
  const doc = await ref.get();
  return serializeDoc(doc.id, doc.data()!);
}

async function handleGetGrantProgrammes(args: Record<string, unknown>) {
  const db = admin.firestore();
  let q: admin.firestore.Query = db.collection(COLLECTIONS.RND_GRANT_PROGRAMMES);

  // Default: active only (unless explicitly set false)
  const isActive = typeof args.isActive === "boolean" ? args.isActive : true;
  q = q.where("isActive", "==", isActive);

  if (typeof args.level === "string") q = q.where("level", "==", args.level);

  const limit = typeof args.limit === "number" ? Math.min(Math.max(1, args.limit), 200) : 100;
  q = q.limit(limit);

  const snap = await q.get();
  let results = snap.docs.map((d) => serializeDoc(d.id, d.data()));

  // Upcoming filter (client-side because of index simplicity)
  if (typeof args.upcomingWithinDays === "number") {
    const cutoff = new Date(Date.now() + args.upcomingWithinDays * 86400_000).toISOString().split("T")[0];
    const today = new Date().toISOString().split("T")[0];
    results = results.filter((p) =>
      typeof p.nextRoundOpensAt === "string" &&
      p.nextRoundOpensAt >= today &&
      p.nextRoundOpensAt <= cutoff
    );
  }

  return results;
}

async function handleUpdateGrantProgramme(args: Record<string, unknown>) {
  const db = admin.firestore();
  const id = String(args.programmeId);
  const ref = db.collection(COLLECTIONS.RND_GRANT_PROGRAMMES).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Grant programme '${id}' not found.`);

  const updates: Record<string, unknown> = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };

  if (typeof args.isActive === "boolean") updates.isActive = args.isActive;
  if (typeof args.nextRoundOpensAt === "string") updates.nextRoundOpensAt = args.nextRoundOpensAt;
  if (typeof args.fitScore === "number") updates.fitScore = args.fitScore;
  if (typeof args.eligibilityNotes === "string") updates.eligibilityNotes = args.eligibilityNotes;
  if (typeof args.applicabilityNotes === "string") updates.applicabilityNotes = args.applicabilityNotes;
  if (typeof args.notes === "string") updates.notes = args.notes;
  if (args.markAsChecked === true) updates.lastCheckedAt = admin.firestore.FieldValue.serverTimestamp();

  await ref.update(updates);
  const updated = await ref.get();
  return serializeDoc(updated.id, updated.data()!);
}

async function handleDeleteGrantProgramme(args: Record<string, unknown>) {
  const db = admin.firestore();
  const id = String(args.programmeId);
  await db.collection(COLLECTIONS.RND_GRANT_PROGRAMMES).doc(id).delete();
  return { ok: true, programmeId: id };
}

// ─── Archer Weekly Report ──────────────────────────────────────────────────

async function handlePushArcherWeeklyReport(args: Record<string, unknown>) {
  const weekEnding = String(args.weekEnding);
  if (!weekEnding) throw new Error("weekEnding is required.");
  if (!args.summary) throw new Error("summary is required.");

  const db = admin.firestore();
  const docId = `archer_${weekEnding}`;

  const report = stripUndefined({
    summary: String(args.summary),
    rndMetrics: (args.rndMetrics || {}) as Record<string, unknown>,
    grantMetrics: (args.grantMetrics || {}) as Record<string, unknown>,
    highlights: Array.isArray(args.highlights) ? args.highlights : [],
    risks: Array.isArray(args.risks) ? args.risks : [],
    recommendations: Array.isArray(args.recommendations) ? args.recommendations : [],
    newOpportunitiesLogged: typeof args.newOpportunitiesLogged === "number" ? args.newOpportunitiesLogged : 0,
    opportunitiesConverted: typeof args.opportunitiesConverted === "number" ? args.opportunitiesConverted : 0,
    rawData: args.rawData as Record<string, unknown> | undefined,
  });

  await db.collection(COLLECTIONS.DEPARTMENT_REPORTS).doc(docId).set({
    department: "archer",
    weekEnding,
    report,
    submittedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { ok: true, reportId: docId, department: "archer", weekEnding };
}

// ─── Contact Lookup handler ─────────────────────────────────────────────────

async function handleContactLookup(args: Record<string, unknown>) {
  const email = typeof args.email === "string" ? args.email.toLowerCase().trim() : "";
  const name = typeof args.name === "string" ? args.name.trim() : "";
  if (!email && !name) throw new Error("At least one of email or name is required.");

  const db = admin.firestore();
  const matches: Array<Record<string, unknown>> = [];

  // Search Portal organisations/contacts
  const orgsSnap = await db.collection(COLLECTIONS.CONTACT_ORGANIZATIONS).limit(300).get();
  const contactsSnap = await db.collection(COLLECTIONS.ORGANIZATION_CONTACTS).limit(500).get();

  // Search org contacts by email
  contactsSnap.docs.forEach((d) => {
    const c = d.data();
    const cEmail = String(c.email || "").toLowerCase();
    const cName = String(c.name || "").toLowerCase();
    if ((email && cEmail === email) || (name && cName.includes(name.toLowerCase()))) {
      matches.push({
        source: "portal-customer",
        contactName: c.name || "",
        companyName: c.organizationName || "",
        email: c.email || "",
        contactId: d.id,
        xeroContactId: null,
      });
    }
  });

  // Search orgs by name
  if (name) {
    orgsSnap.docs.forEach((d) => {
      const o = d.data();
      const oName = String(o.name || "").toLowerCase();
      if (oName.includes(name.toLowerCase())) {
        matches.push({
          source: "portal-supplier",
          contactName: o.primaryContactName || o.name || "",
          companyName: o.name || "",
          email: o.primaryContactEmail || o.email || "",
          contactId: d.id,
          xeroContactId: o.xeroContactId || null,
        });
      }
    });
  }

  // Search Portal leads
  const leadsSnap = await db.collection(COLLECTIONS.LEADS).limit(300).get();
  leadsSnap.docs.filter((d) => !d.data().isDeleted).forEach((d) => {
    const l = d.data();
    const contacts = (l.contacts || []) as Array<Record<string, unknown>>;
    for (const c of contacts) {
      const cEmail = String(c.email || "").toLowerCase();
      const cName = String(c.name || "").toLowerCase();
      if ((email && cEmail === email) || (name && cName.includes(name.toLowerCase()))) {
        matches.push({
          source: "portal-lead",
          contactName: c.name || "",
          companyName: l.companyName || "",
          email: c.email || "",
          contactId: d.id,
          xeroContactId: null,
        });
      }
    }
  });

  // Search Xero contacts
  try {
    const xeroContacts = await xeroListContacts(email || name || undefined) as Record<string, unknown> | null;
    const xeroContactList = (xeroContacts?.Contacts || xeroContacts?.contacts || []) as Array<Record<string, unknown>>;
    if (xeroContactList.length > 0) {
      for (const xc of xeroContactList) {
        const xcName = String(xc.Name || xc.name || "").toLowerCase();
        const xcEmail = String(xc.EmailAddress || xc.emailAddress || "").toLowerCase();
        if ((email && xcEmail === email) || (name && xcName.includes(name.toLowerCase()))) {
          matches.push({
            source: "xero",
            contactName: xc.Name || xc.name || "",
            companyName: xc.Name || xc.name || "",
            email: xcEmail,
            contactId: xc.ContactID || xc.contactId || "",
            xeroContactId: xc.ContactID || xc.contactId || "",
          });
        }
      }
    }
  } catch {
    // Xero may not be connected — skip silently
  }

  return { found: matches.length > 0, matches };
}

// ─── Email Template handlers ────────────────────────────────────────────────

async function handleCreateEmailTemplate(args: Record<string, unknown>) {
  if (!args.agent || !args.category || !args.name || !args.subject || !args.bodyHtml) {
    throw new Error("agent, category, name, subject, and bodyHtml are required.");
  }
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const seq = args.sequence as Record<string, unknown> | null;

  const ref = await db.collection(COLLECTIONS.EMAIL_TEMPLATES).add({
    agent: String(args.agent),
    category: String(args.category),
    name: String(args.name),
    description: String(args.description || ""),
    subject: String(args.subject),
    bodyHtml: String(args.bodyHtml),
    variables: (args.variables as string[]) || [],
    sequence: seq ? { sequenceId: String(seq.sequenceId || ""), touchNumber: Number(seq.touchNumber || 1), dayOffset: Number(seq.dayOffset || 0) } : null,
    authLevel: String(args.authLevel || "draft-for-review"),
    status: String(args.status || "draft"),
    version: 1,
    createdAt: now, updatedAt: now,
    createdBy: String(args.createdBy || "mcp-agent"),
    approvedBy: null, approvedAt: null,
  });

  return { id: ref.id, name: String(args.name), agent: String(args.agent), version: 1 };
}

async function handleGetEmailTemplates(args: Record<string, unknown>) {
  const db = admin.firestore();
  const limit = safeLimit(args.limit, 50, 200);
  let q: admin.firestore.Query = db.collection(COLLECTIONS.EMAIL_TEMPLATES).orderBy("createdAt", "desc");
  if (typeof args.agent === "string") q = q.where("agent", "==", args.agent);
  if (typeof args.category === "string") q = q.where("category", "==", args.category);
  if (typeof args.status === "string") q = q.where("status", "==", args.status);
  q = q.limit(limit);
  const snap = await q.get();
  let templates = snap.docs.map((d) => serializeDoc(d.id, d.data()));
  if (typeof args.authLevel === "string") templates = templates.filter((t) => t.authLevel === args.authLevel);
  if (typeof args.sequenceId === "string") templates = templates.filter((t) => (t.sequence as Record<string, unknown> | null)?.sequenceId === args.sequenceId);
  return templates;
}

async function handleGetEmailTemplate(args: Record<string, unknown>) {
  const db = admin.firestore();
  const snap = await db.collection(COLLECTIONS.EMAIL_TEMPLATES).doc(String(args.id)).get();
  if (!snap.exists) return { error: "Template not found" };
  return serializeDoc(snap.id, snap.data()!);
}

async function handleUpdateEmailTemplate(args: Record<string, unknown>) {
  const id = String(args.id);
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const existing = await db.collection(COLLECTIONS.EMAIL_TEMPLATES).doc(id).get();
  if (!existing.exists) throw new Error("Template not found.");

  const updates: Record<string, unknown> = { updatedAt: now, version: admin.firestore.FieldValue.increment(1) };
  if (typeof args.name === "string") updates.name = args.name;
  if (typeof args.description === "string") updates.description = args.description;
  if (typeof args.subject === "string") updates.subject = args.subject;
  if (typeof args.bodyHtml === "string") updates.bodyHtml = args.bodyHtml;
  if (Array.isArray(args.variables)) updates.variables = args.variables;
  if (args.sequence !== undefined) {
    const seq = args.sequence as Record<string, unknown> | null;
    updates.sequence = seq ? { sequenceId: String(seq.sequenceId || ""), touchNumber: Number(seq.touchNumber || 1), dayOffset: Number(seq.dayOffset || 0) } : null;
  }
  if (typeof args.authLevel === "string") updates.authLevel = args.authLevel;
  if (typeof args.status === "string") updates.status = args.status;

  await db.collection(COLLECTIONS.EMAIL_TEMPLATES).doc(id).set(updates, { merge: true });
  const updated = await db.collection(COLLECTIONS.EMAIL_TEMPLATES).doc(id).get();
  return serializeDoc(updated.id, updated.data()!);
}

async function handleDeleteEmailTemplate(args: Record<string, unknown>) {
  const id = String(args.id);
  const db = admin.firestore();
  await db.collection(COLLECTIONS.EMAIL_TEMPLATES).doc(id).set(
    { status: "archived", updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true },
  );
  return { ok: true, id, status: "archived" };
}

async function handleApproveEmailTemplate(args: Record<string, unknown>) {
  const id = String(args.id);
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  await db.collection(COLLECTIONS.EMAIL_TEMPLATES).doc(id).set(
    { approvedBy: "director", approvedAt: now, updatedAt: now },
    { merge: true },
  );
  const updated = await db.collection(COLLECTIONS.EMAIL_TEMPLATES).doc(id).get();
  return serializeDoc(updated.id, updated.data()!);
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

// ─── CRM Organisation handlers ───────────────────────────────────────────────

async function handleUpdateOrganization(args: Record<string, unknown>) {
  const db = admin.firestore();
  const orgId = String(args.organizationId || "");
  if (!orgId) throw new Error("organizationId is required.");

  const ref = db.collection(COLLECTIONS.CONTACT_ORGANIZATIONS).doc(orgId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Organisation '${orgId}' not found.`);

  const rawUpdates = (args.updates || {}) as Record<string, unknown>;
  const allowed = ["name", "email", "accountsEmail", "phone", "abn", "status", "marketStream", "jobCode", "industry", "website"];
  const updates: Record<string, unknown> = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };

  for (const key of allowed) {
    if (key in rawUpdates) updates[key] = rawUpdates[key];
  }

  if (Object.keys(updates).length <= 1) throw new Error("No valid fields to update. Supported: " + allowed.join(", "));

  await ref.update(updates);
  const updated = await ref.get();
  return serializeDoc(updated.id, updated.data()!);
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

async function handleScheduleImsAudit(args: Record<string, unknown>) {
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const nowIso = new Date().toISOString();

  const plannedDate = String(args.plannedDate || "");
  if (!plannedDate) throw new Error("plannedDate is required (YYYY-MM-DD).");
  const standard = String(args.standard || "");
  if (!standard) throw new Error("standard is required.");
  const scope = String(args.scope || "");
  if (!scope) throw new Error("scope is required.");
  const leadAuditor = String(args.leadAuditor || "");
  if (!leadAuditor) throw new Error("leadAuditor is required.");

  // Generate an audit ID if not provided
  const year = new Date(plannedDate).getFullYear();
  const month = String(new Date(plannedDate).getMonth() + 1).padStart(2, "0");
  const generatedId = `AUD-${year}-${month}-${Math.floor(Math.random() * 900 + 100)}`;
  const auditId = String(args.auditId || generatedId);

  const metadata = {
    auditId,
    standard,
    auditType: String(args.auditType || "internal"),
    scope,
    period: String(args.period || `${year}`),
    sites: Array.isArray(args.sites) ? args.sites : [],
    processes: Array.isArray(args.processes) ? args.processes : [],
    leadAuditor,
    auditDate: plannedDate,
    plannedDate,
    status: "scheduled",
    scheduledBy: String(args.scheduledBy || "GUARDIAN"),
    scheduledAt: nowIso,
    calendarEventId: null as string | null,
  };

  const payload = {
    metadata,
    plan: { objectives: [], criteria: [], methods: [], schedule: [] },
    checklist: [],
    findings: [],
    summary: { strengths: [], risks: [], overallConclusion: "" },
    questions: [],
    source: "agent",
    createdAt: now,
    updatedAt: now,
    createdById: "mcp-agent",
    createdByName: String(args.scheduledBy || "GUARDIAN"),
    createdByEmail: "",
  };

  const ref = await db.collection(COLLECTIONS.IMS_AUDITS).add(payload);

  // Best-effort Google Calendar event creation. Failure is non-fatal — the
  // audit is scheduled in Firestore regardless. The Director can link a
  // calendar event later from the IMS Auditor page if the portal doesn't
  // have calendar OAuth.
  let calendarEventId: string | null = null;
  if (args.createCalendarEvent === true) {
    try {
      // NB: calendar OAuth lives per-user. For now we just record the intent
      // on the audit record and let the UI complete the calendar event via
      // the existing /api/google/calendar/create-event endpoint with the
      // current user's token. The MCP backend does not have a user session.
      calendarEventId = null;
    } catch {
      calendarEventId = null;
    }
  }

  if (calendarEventId) {
    await ref.set({ metadata: { ...metadata, calendarEventId } }, { merge: true });
  }

  return {
    ok: true,
    id: ref.id,
    auditId,
    plannedDate,
    standard,
    status: "scheduled",
  };
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

async function generateJobReportPdf(jobId: string): Promise<{ pdfBytes: Uint8Array; fileName: string }> {
  // In-process PDF build — avoids the self-HTTP round-trip which was hitting
  // auth/host-check edge cases under Netlify serverless and bouncing as 401.
  const { buildJobCompletionReport } = await import("@/lib/server/job-report-pdf");
  const { pdfBytes, fileName } = await buildJobCompletionReport(jobId, "LEDGER Agent");
  return { pdfBytes, fileName };
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
    leadsRegister: await (async () => {
      const regSnap = await db.collection(COLLECTIONS.LEADS_REGISTER).limit(300).get();
      const regEntries = regSnap.docs.map((d) => d.data());
      const regStream = (stream: string) => {
        const se = regEntries.filter((e) => e.streamType === stream);
        return {
          activePursuits: se.filter((e) => e.status === "promoted" && e.promotedToPipeline).length,
          awaitingAssessment: se.filter((e) => e.status === "identified" && !e.roeScore).length,
          shortlisted: se.filter((e) => e.status === "shortlisted").length,
        };
      };
      return { supply_chain: regStream("supply_chain"), sales: regStream("sales") };
    })(),
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

// ─── Agent Heartbeat handlers ────────────────────────────────────────────────

const KNOWN_AGENTS = ["athena", "vanguard", "sentinel", "mercer", "archer", "ledger", "guardian", "blackstone", "cipher", "meridian", "shield", "vesta"];

async function handleAgentHeartbeat(args: Record<string, unknown>) {
  const agentId = String(args.agentId || "").toLowerCase();
  if (!KNOWN_AGENTS.includes(agentId)) {
    throw new Error(`Unknown agentId '${agentId}'. Valid: ${KNOWN_AGENTS.join(", ")}`);
  }
  const status = String(args.status || "online");
  if (!["online", "busy", "idle", "error"].includes(status)) {
    throw new Error(`Invalid status '${status}'. Must be online|busy|idle|error.`);
  }
  const activity = typeof args.activity === "string" ? args.activity : null;
  const metadata = (args.metadata && typeof args.metadata === "object") ? args.metadata : null;

  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const nowIso = new Date().toISOString();

  await db.collection(COLLECTIONS.AGENT_HEARTBEATS).doc(agentId).set({
    agentId,
    status,
    activity,
    metadata,
    lastActiveAt: nowIso,
    lastActiveAtServer: now,
    updatedAt: now,
  }, { merge: true });

  return { ok: true, agentId, status, lastActiveAt: nowIso };
}

async function handleGetAgentHeartbeats() {
  const db = admin.firestore();
  const snap = await db.collection(COLLECTIONS.AGENT_HEARTBEATS).get();
  const STALE_MINUTES = 15;
  const now = Date.now();
  const heartbeats: Record<string, unknown> = {};
  snap.docs.forEach((d) => {
    const data = d.data();
    const lastActiveAt = String(data.lastActiveAt || "");
    let isLive = false;
    let minutesAgo: number | null = null;
    if (lastActiveAt) {
      try {
        const diffMs = now - new Date(lastActiveAt).getTime();
        minutesAgo = Math.floor(diffMs / 60000);
        isLive = diffMs < STALE_MINUTES * 60000;
      } catch {
        // invalid date
      }
    }
    heartbeats[d.id] = {
      agentId: d.id,
      status: data.status || "unknown",
      activity: data.activity || null,
      lastActiveAt,
      minutesAgo,
      isLive,
      metadata: data.metadata || null,
    };
  });
  return { heartbeats, staleThresholdMinutes: STALE_MINUTES };
}

// ─── SHIELD APEAX Distribution handlers ──────────────────────────────────────

async function handleGetShieldQueue(args: Record<string, unknown>) {
  const queueType = String(args.queueType || "all");
  const db = admin.firestore();
  const result: Record<string, unknown> = {};

  // Quote requests: leadsRegister entries with source apeax_portal_quote, status identified/assessed
  if (queueType === "quotes" || queueType === "all") {
    const snap = await db.collection(COLLECTIONS.LEADS_REGISTER)
      .where("source.type", "==", "apeax_portal_quote")
      .where("status", "in", ["identified", "assessed"])
      .limit(100)
      .get();
    result.quotes = snap.docs.map((d) => serializeDoc(d.id, d.data()));
  }

  // Trade applications: leadsRegister entries with source apeax_portal_trade_app, status identified
  if (queueType === "applications" || queueType === "all") {
    const snap = await db.collection(COLLECTIONS.LEADS_REGISTER)
      .where("source.type", "==", "apeax_portal_trade_app")
      .where("status", "in", ["identified", "assessed"])
      .limit(100)
      .get();
    result.applications = snap.docs.map((d) => serializeDoc(d.id, d.data()));
  }

  // Orders awaiting SHIELD validation
  if (queueType === "orders" || queueType === "all") {
    const snap = await db.collection(COLLECTIONS.APEAX_ORDERS)
      .where("status", "==", "pending_validation")
      .limit(100)
      .get();
    result.orders = snap.docs.map((d) => serializeDoc(d.id, d.data()));
  }

  return result;
}

async function handleApproveTradeApplication(args: Record<string, unknown>) {
  const registerEntryId = String(args.registerEntryId || "");
  if (!registerEntryId) throw new Error("registerEntryId is required.");
  const tradeDiscountBand = String(args.tradeDiscountBand || "C");
  if (!["A", "B", "C"].includes(tradeDiscountBand)) {
    throw new Error("tradeDiscountBand must be A, B, or C.");
  }
  const approvedBy = String(args.approvedBy || "shield-agent");
  const notes = typeof args.notes === "string" ? args.notes : "";

  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const nowIso = new Date().toISOString();

  // Load the register entry
  const regRef = db.collection(COLLECTIONS.LEADS_REGISTER).doc(registerEntryId);
  const regSnap = await regRef.get();
  if (!regSnap.exists) throw new Error(`Leads register entry '${registerEntryId}' not found.`);
  const regData = regSnap.data()!;

  if (regData.source?.type !== "apeax_portal_trade_app") {
    throw new Error("This register entry is not an APEAX trade application.");
  }

  // Create the ContactOrganization with trade account flags
  const company = (regData.company || {}) as Record<string, unknown>;
  const contact = (regData.contact || {}) as Record<string, unknown>;
  const orgRef = await db.collection(COLLECTIONS.CONTACT_ORGANIZATIONS).add({
    name: String(company.name || "Unknown"),
    category: "trade_client",
    type: "customer",
    status: "active",
    abn: company.abn || null,
    industry: company.sector || null,
    phone: contact.phone || null,
    email: contact.email || null,
    website: company.website || null,
    isApeaxTradeInstaller: true,
    tradeAccount: {
      sectorDeclaration: company.sectorDeclaration || null,
      exclusivityDisclosureText: company.exclusivityDisclosureText || null,
      exclusivityDisclosureDate: company.exclusivityDisclosureDate || null,
      tradeDiscountBand,
      approvedAt: nowIso,
      approvedBy,
      vettingLockoutUntil: null,
      credentials: company.credentials || null,
      approvalNotes: notes || null,
    },
    sites: [],
    createdAt: now,
    updatedAt: now,
  });

  // Update the register entry → promoted
  await regRef.set({
    status: "promoted",
    promotedToPipeline: true,
    promotedDate: nowIso,
    pipelineLeadId: orgRef.id,
    updatedAt: now,
  }, { merge: true });

  return {
    ok: true,
    organizationId: orgRef.id,
    organizationName: company.name,
    tradeDiscountBand,
    approvedAt: nowIso,
    approvedBy,
  };
}

async function handleRejectTradeApplication(args: Record<string, unknown>) {
  const registerEntryId = String(args.registerEntryId || "");
  const reason = String(args.reason || "");
  if (!registerEntryId) throw new Error("registerEntryId is required.");
  if (!reason) throw new Error("reason is required for audit trail.");
  const rejectedBy = String(args.rejectedBy || "shield-agent");

  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const nowIso = new Date().toISOString();
  const lockoutUntil = new Date(Date.now() + 365 * 86400000).toISOString();

  const regRef = db.collection(COLLECTIONS.LEADS_REGISTER).doc(registerEntryId);
  const regSnap = await regRef.get();
  if (!regSnap.exists) throw new Error(`Leads register entry '${registerEntryId}' not found.`);

  await regRef.set({
    status: "rejected",
    rejectionReason: reason,
    rejectedAt: nowIso,
    rejectedBy,
    vettingLockoutUntil: lockoutUntil,
    updatedAt: now,
  }, { merge: true });

  return { ok: true, registerEntryId, rejectedAt: nowIso, vettingLockoutUntil: lockoutUntil };
}

async function handleValidateApeaxOrder(args: Record<string, unknown>) {
  const orderId = String(args.orderId || "");
  if (!orderId) throw new Error("orderId is required.");
  const validatedBy = String(args.validatedBy || "shield-agent");
  const notes = typeof args.notes === "string" ? args.notes : "";

  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const nowIso = new Date().toISOString();

  const orderRef = db.collection(COLLECTIONS.APEAX_ORDERS).doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) throw new Error(`APEAX order '${orderId}' not found.`);
  const order = orderSnap.data()!;

  // Check stock for each line item
  const lines = (order.lines as Array<Record<string, unknown>>) || [];
  const stockShortfall: Array<{ sku: string; requested: number; available: number }> = [];
  for (const line of lines) {
    const sku = String(line.sku || "");
    if (!sku) continue;
    const stockSnap = await db.collection(COLLECTIONS.STOCK_ITEMS).where("sku", "==", sku).limit(1).get();
    if (stockSnap.empty) {
      stockShortfall.push({ sku, requested: Number(line.quantity || 0), available: 0 });
    } else {
      const available = Number(stockSnap.docs[0].data().quantityOnHand || 0);
      const requested = Number(line.quantity || 0);
      if (available < requested) {
        stockShortfall.push({ sku, requested, available });
      }
    }
  }

  const poRequired = stockShortfall.length > 0;

  await orderRef.set({
    status: poRequired ? "validated_po_required" : "validated_stock_available",
    shieldValidatedAt: nowIso,
    shieldValidatedBy: validatedBy,
    shieldNotes: notes || null,
    stockShortfall,
    poRequired,
    updatedAt: now,
  }, { merge: true });

  return {
    ok: true,
    orderId,
    validated: true,
    poRequired,
    stockShortfall,
    validatedAt: nowIso,
  };
}

async function handleGetApeaxStock(args: Record<string, unknown>) {
  const sku = typeof args.sku === "string" ? args.sku : null;
  const db = admin.firestore();
  let q: admin.firestore.Query = db.collection(COLLECTIONS.STOCK_ITEMS);
  // Filter to APEAX product lines (by sku prefix or category tag)
  if (sku) {
    q = q.where("sku", "==", sku);
  } else {
    q = q.where("supplier", "==", "APEAX");
  }
  const snap = await q.limit(200).get();
  const items = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      sku: data.sku,
      name: data.name,
      description: data.description,
      quantityOnHand: data.quantityOnHand || 0,
      reorderPoint: data.reorderPoint || 0,
      unitCostUsd: data.unitCostUsd || null,
      unitPriceAud: data.unitPriceAud || null,
      updatedAt: data.updatedAt,
    };
  });
  return { items, totalSkus: items.length };
}

// ─── Jobs — lean summary for LEDGER / Xero workflows ──────────────────────────

async function handleListJobsSummary(args: Record<string, unknown>) {
  const db = admin.firestore();
  const limit = typeof args.limit === "number"
    ? Math.min(Math.max(1, args.limit), 500)
    : 50;

  // Pull more than limit so we can apply in-memory filters without composite indexes.
  const fetchSize = Math.min(1000, limit * 4);
  let q: FirebaseFirestore.Query = db.collection(COLLECTIONS.JOBS)
    .orderBy("createdAt", "desc")
    .limit(fetchSize);

  if (typeof args.status === "string") q = q.where("status", "==", args.status);
  if (typeof args.clientId === "string") q = q.where("clientId", "==", args.clientId);

  const snap = await q.get();
  const fromDate = typeof args.fromDate === "string" ? new Date(args.fromDate) : null;
  const unbilled = args.unbilled === true;

  const rows = snap.docs
    .map((d) => {
      const data = d.data();
      const created = data.createdAt && typeof (data.createdAt as { toDate?: () => Date }).toDate === "function"
        ? (data.createdAt as { toDate: () => Date }).toDate()
        : null;
      const completed = data.completedDate && typeof (data.completedDate as { toDate?: () => Date }).toDate === "function"
        ? (data.completedDate as { toDate: () => Date }).toDate()
        : null;
      const invoiceDate = data.invoiceDate && typeof (data.invoiceDate as { toDate?: () => Date }).toDate === "function"
        ? (data.invoiceDate as { toDate: () => Date }).toDate()
        : null;

      // Total cost rollup from jobVehicles (falls back to 0)
      const jobVehicles = Array.isArray(data.jobVehicles) ? data.jobVehicles : [];
      const totalCost = jobVehicles.reduce((sum: number, jv: { totalCost?: number }) => sum + (jv.totalCost || 0), 0);

      return {
        id: d.id,
        jobNumber: data.jobNumber,
        clientId: data.clientId,
        clientName: data.clientName,
        organizationId: data.organizationId,
        status: data.status,
        totalCost: Number(totalCost.toFixed(2)),
        invoiceNumber: data.invoiceNumber || null,
        invoiceDate: invoiceDate ? invoiceDate.toISOString().slice(0, 10) : null,
        createdAt: created ? created.toISOString() : null,
        completedDate: completed ? completed.toISOString().slice(0, 10) : null,
        scheduledDate: data.scheduledDate && typeof (data.scheduledDate as { toDate?: () => Date }).toDate === "function"
          ? (data.scheduledDate as { toDate: () => Date }).toDate().toISOString().slice(0, 10)
          : null,
        vehicleCount: jobVehicles.length,
      };
    })
    .filter((r) => {
      if (unbilled && r.invoiceNumber) return false;
      if (fromDate && r.createdAt && new Date(r.createdAt) < fromDate) return false;
      return true;
    })
    .slice(0, limit);

  return { count: rows.length, jobs: rows };
}

// ─── KPI Traceability capture handlers ────────────────────────────────────────

async function handleCreateFuelRecord(args: Record<string, unknown>) {
  const db = admin.firestore();
  const organizationId = String(args.organizationId || "");
  const vehicleRegistration = String(args.vehicleRegistration || "").toUpperCase();
  const baseline = typeof args.baselineConsumptionLPer100km === "number" ? args.baselineConsumptionLPer100km : null;

  if (!organizationId || !vehicleRegistration || baseline === null) {
    throw new Error("organizationId, vehicleRegistration, and baselineConsumptionLPer100km are required.");
  }

  const orgSnap = await db.collection(COLLECTIONS.CONTACT_ORGANIZATIONS).doc(organizationId).get();
  if (!orgSnap.exists) throw new Error(`Organisation '${organizationId}' not found.`);
  const organizationName = String(orgSnap.data()?.name || "");

  const postInstall = typeof args.postInstallConsumptionLPer100km === "number" ? args.postInstallConsumptionLPer100km : undefined;
  const annualKm = typeof args.annualDistanceKm === "number" ? args.annualDistanceKm : undefined;
  const costPerLitre = typeof args.fuelCostPerLitre === "number" ? args.fuelCostPerLitre : 1.80;

  const fuelDelta = postInstall !== undefined ? baseline - postInstall : undefined;
  const fuelDeltaPct = fuelDelta !== undefined ? (fuelDelta / baseline) * 100 : undefined;
  const annualLitresSaved = fuelDelta !== undefined && annualKm ? (fuelDelta * annualKm) / 100 : undefined;
  const costSavings = annualLitresSaved !== undefined ? annualLitresSaved * costPerLitre : undefined;
  const kwhSaved = annualLitresSaved !== undefined ? annualLitresSaved * 10.1 : undefined;

  const payload: Record<string, unknown> = {
    organizationId,
    organizationName,
    vehicleRegistration,
    vehicleDescription: typeof args.vehicleDescription === "string" ? args.vehicleDescription : undefined,
    fuelType: typeof args.fuelType === "string" ? args.fuelType : "diesel",
    baselineConsumptionLPer100km: baseline,
    baselinePeriodStart: typeof args.baselinePeriodStart === "string" ? args.baselinePeriodStart : "",
    baselinePeriodEnd: typeof args.baselinePeriodEnd === "string" ? args.baselinePeriodEnd : "",
    baselineSource: typeof args.baselineSource === "string" ? args.baselineSource : "manual",
    postInstallConsumptionLPer100km: postInstall,
    postInstallPeriodStart: typeof args.postInstallPeriodStart === "string" ? args.postInstallPeriodStart : undefined,
    postInstallPeriodEnd: typeof args.postInstallPeriodEnd === "string" ? args.postInstallPeriodEnd : undefined,
    postInstallSource: typeof args.postInstallSource === "string" ? args.postInstallSource : "manual",
    fuelDeltaLPer100km: fuelDelta,
    fuelDeltaPercent: fuelDeltaPct !== undefined ? Number(fuelDeltaPct.toFixed(2)) : undefined,
    hvacLoadReductionKw: typeof args.hvacLoadReductionKw === "number" ? args.hvacLoadReductionKw : undefined,
    estimatedKwhSaved: kwhSaved !== undefined ? Math.round(kwhSaved) : undefined,
    fuelCostPerLitre: costPerLitre,
    estimatedCostSavingsPerYear: costSavings !== undefined ? Math.round(costSavings) : undefined,
    annualDistanceKm: annualKm,
    filmInstallationId: typeof args.filmInstallationId === "string" ? args.filmInstallationId : undefined,
    radshieldInstalled: typeof args.radshieldInstalled === "boolean" ? args.radshieldInstalled : true,
    installDate: typeof args.installDate === "string" ? args.installDate : undefined,
    notes: typeof args.notes === "string" ? args.notes : undefined,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: "mcp-agent",
  };

  const ref = await db.collection(COLLECTIONS.FUEL_RECORDS).add(payload);
  return { id: ref.id, organizationId, organizationName, vehicleRegistration, estimatedCostSavingsPerYear: payload.estimatedCostSavingsPerYear };
}

async function handleCreateEmissionsReport(args: Record<string, unknown>) {
  const db = admin.firestore();
  const organizationId = String(args.organizationId || "");
  const periodStart = String(args.periodStart || "");
  const periodEnd = String(args.periodEnd || "");

  if (!organizationId || !periodStart || !periodEnd) {
    throw new Error("organizationId, periodStart, and periodEnd are required.");
  }

  const orgSnap = await db.collection(COLLECTIONS.CONTACT_ORGANIZATIONS).doc(organizationId).get();
  if (!orgSnap.exists) throw new Error(`Organisation '${organizationId}' not found.`);
  const organizationName = String(orgSnap.data()?.name || "");

  const DIESEL_FACTOR = 2.68;
  const litres = typeof args.dieselSavedLitres === "number" ? args.dieselSavedLitres : 0;
  const co2Kg = litres * DIESEL_FACTOR;
  const glassKg = typeof args.glassAvoidedKg === "number" ? args.glassAvoidedKg : 0;
  const filmKg = typeof args.filmDisposalsAvoidedKg === "number" ? args.filmDisposalsAvoidedKg : 0;

  const payload: Record<string, unknown> = {
    organizationId,
    organizationName,
    reportingPeriod: typeof args.reportingPeriod === "string" ? args.reportingPeriod : "annual",
    periodStart,
    periodEnd,
    scope1: {
      dieselSavedLitres: litres,
      co2AvoidedKg: Number(co2Kg.toFixed(2)),
      co2AvoidedTonnes: Number((co2Kg / 1000).toFixed(4)),
      calculationMethod: `diesel_saved (${litres}L) x ${DIESEL_FACTOR} kg CO2/L (Australian NGA factor)`,
    },
    waste: {
      glassAvoidedKg: glassKg,
      filmDisposalsAvoidedKg: filmKg,
      totalWasteAvoidedKg: glassKg + filmKg,
    },
    status: typeof args.status === "string" ? args.status : "draft",
    notes: typeof args.notes === "string" ? args.notes : undefined,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: "mcp-agent",
  };

  const ref = await db.collection(COLLECTIONS.EMISSIONS_REPORTS).add(payload);
  return { id: ref.id, organizationId, co2AvoidedTonnes: (payload.scope1 as { co2AvoidedTonnes: number }).co2AvoidedTonnes };
}

async function handleCreateTelemetryReading(args: Record<string, unknown>) {
  const db = admin.firestore();
  const organizationId = String(args.organizationId || "");
  const vehicleRegistration = String(args.vehicleRegistration || "").toUpperCase();
  if (!organizationId || !vehicleRegistration) {
    throw new Error("organizationId and vehicleRegistration are required.");
  }

  const orgSnap = await db.collection(COLLECTIONS.CONTACT_ORGANIZATIONS).doc(organizationId).get();
  const organizationName = orgSnap.exists ? String(orgSnap.data()?.name || "") : undefined;

  const cabinPre = typeof args.cabinTempPreC === "number" ? args.cabinTempPreC : undefined;
  const cabinPost = typeof args.cabinTempPostC === "number" ? args.cabinTempPostC : undefined;
  const compHours = typeof args.compressorHoursTotal === "number" ? args.compressorHoursTotal : undefined;
  const estLife = typeof args.estimatedLifeHours === "number" ? args.estimatedLifeHours : 12000;
  const remainingPct = compHours !== undefined ? Math.max(0, ((estLife - compHours) / estLife) * 100) : undefined;

  const payload: Record<string, unknown> = {
    organizationId,
    organizationName,
    vehicleRegistration,
    readingDate: typeof args.readingDate === "string" ? args.readingDate : new Date().toISOString().slice(0, 10),
    readingSource: typeof args.readingSource === "string" ? args.readingSource : "manual",
    compressor: typeof args.dutyCyclePercent === "number" ? {
      dutyCyclePercent: args.dutyCyclePercent,
      runHoursTotal: typeof args.runHoursTotal === "number" ? args.runHoursTotal : 0,
      tempDeltaCabin: typeof args.tempDeltaCabin === "number" ? args.tempDeltaCabin : 0,
    } : undefined,
    electrical: typeof args.totalSystemLoadKw === "number" ? {
      totalSystemLoadKw: args.totalSystemLoadKw,
      alternatorReductionKw: typeof args.alternatorReductionKw === "number" ? args.alternatorReductionKw : undefined,
    } : undefined,
    temperature: cabinPre !== undefined && cabinPost !== undefined ? {
      ambientTempC: typeof args.ambientTempC === "number" ? args.ambientTempC : 0,
      cabinTempPreC: cabinPre,
      cabinTempPostC: cabinPost,
      deltaTempC: cabinPre - cabinPost,
    } : undefined,
    componentLifecycle: compHours !== undefined ? {
      compressorHoursTotal: compHours,
      estimatedLifeHours: estLife,
      remainingLifePercent: Number((remainingPct || 0).toFixed(1)),
      alertLevel: remainingPct !== undefined ? (remainingPct < 10 ? "critical" : remainingPct < 25 ? "warning" : "ok") : "ok",
    } : undefined,
    notes: typeof args.notes === "string" ? args.notes : undefined,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: "mcp-agent",
  };

  const ref = await db.collection(COLLECTIONS.TELEMETRY_READINGS).add(payload);
  return { id: ref.id, organizationId, vehicleRegistration };
}

async function handleCreateMaintenanceEvent(args: Record<string, unknown>) {
  const db = admin.firestore();
  const organizationId = String(args.organizationId || "");
  const vehicleRegistration = String(args.vehicleRegistration || "").toUpperCase();
  const eventDate = String(args.eventDate || "");
  const eventType = String(args.eventType || "");
  const description = String(args.description || "");
  const actualCost = typeof args.actualCost === "number" ? args.actualCost : null;

  if (!organizationId || !vehicleRegistration || !eventDate || !eventType || !description || actualCost === null) {
    throw new Error("organizationId, vehicleRegistration, eventDate, eventType, description, and actualCost are required.");
  }

  const orgSnap = await db.collection(COLLECTIONS.CONTACT_ORGANIZATIONS).doc(organizationId).get();
  if (!orgSnap.exists) throw new Error(`Organisation '${organizationId}' not found.`);
  const organizationName = String(orgSnap.data()?.name || "");

  const avoided = typeof args.replacementCostAvoided === "number" ? args.replacementCostAvoided : undefined;

  const payload: Record<string, unknown> = {
    organizationId,
    organizationName,
    vehicleRegistration,
    eventDate,
    eventType,
    description,
    actualCost,
    replacementCostAvoided: avoided,
    costSavings: avoided !== undefined ? avoided - actualCost : undefined,
    jobId: typeof args.jobId === "string" ? args.jobId : undefined,
    jobNumber: typeof args.jobNumber === "string" ? args.jobNumber : undefined,
    filmInstallationId: typeof args.filmInstallationId === "string" ? args.filmInstallationId : undefined,
    performedBy: typeof args.performedBy === "string" ? args.performedBy : undefined,
    notes: typeof args.notes === "string" ? args.notes : undefined,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: "mcp-agent",
  };

  const ref = await db.collection(COLLECTIONS.MAINTENANCE_EVENTS).add(payload);
  return { id: ref.id, organizationId, vehicleRegistration, replacementCostAvoided: avoided, costSavings: payload.costSavings };
}

async function handleSubmitSatisfactionSurvey(args: Record<string, unknown>) {
  const db = admin.firestore();
  const organizationId = String(args.organizationId || "");
  const submittedByName = String(args.submittedByName || "");
  const overall = typeof args.overallSatisfaction === "number" ? args.overallSatisfaction : null;

  if (!organizationId || !submittedByName || overall === null) {
    throw new Error("organizationId, submittedByName, and overallSatisfaction are required.");
  }

  const orgSnap = await db.collection(COLLECTIONS.CONTACT_ORGANIZATIONS).doc(organizationId).get();
  if (!orgSnap.exists) throw new Error(`Organisation '${organizationId}' not found.`);
  const organizationName = String(orgSnap.data()?.name || "");

  const payload: Record<string, unknown> = {
    organizationId,
    organizationName,
    jobId: typeof args.jobId === "string" ? args.jobId : undefined,
    jobNumber: typeof args.jobNumber === "string" ? args.jobNumber : undefined,
    submittedBy: "mcp-agent",
    submittedByName,
    submittedAt: admin.firestore.FieldValue.serverTimestamp(),
    overallSatisfaction: overall,
    serviceQuality: typeof args.serviceQuality === "number" ? args.serviceQuality : overall,
    communication: typeof args.communication === "number" ? args.communication : overall,
    timeliness: typeof args.timeliness === "number" ? args.timeliness : overall,
    valueForMoney: typeof args.valueForMoney === "number" ? args.valueForMoney : overall,
    wouldRecommend: typeof args.wouldRecommend === "boolean" ? args.wouldRecommend : overall >= 4,
    comments: typeof args.comments === "string" ? args.comments : undefined,
    risks: Array.isArray(args.risks) ? args.risks.filter((r) => typeof r === "string") : undefined,
    opportunities: Array.isArray(args.opportunities) ? args.opportunities.filter((r) => typeof r === "string") : undefined,
    athenaGenerated: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const ref = await db.collection(COLLECTIONS.SATISFACTION_SURVEYS).add(payload);
  return { id: ref.id, organizationId, overallSatisfaction: overall };
}

async function handleGetKpiSummary(args: Record<string, unknown>) {
  const db = admin.firestore();
  const organizationId = typeof args.organizationId === "string" ? args.organizationId : null;

  const fuelQ = organizationId
    ? db.collection(COLLECTIONS.FUEL_RECORDS).where("organizationId", "==", organizationId)
    : db.collection(COLLECTIONS.FUEL_RECORDS);
  const emissionsQ = organizationId
    ? db.collection(COLLECTIONS.EMISSIONS_REPORTS).where("organizationId", "==", organizationId)
    : db.collection(COLLECTIONS.EMISSIONS_REPORTS);
  const maintenanceQ = organizationId
    ? db.collection(COLLECTIONS.MAINTENANCE_EVENTS).where("organizationId", "==", organizationId)
    : db.collection(COLLECTIONS.MAINTENANCE_EVENTS);
  const surveysQ = organizationId
    ? db.collection(COLLECTIONS.SATISFACTION_SURVEYS).where("organizationId", "==", organizationId)
    : db.collection(COLLECTIONS.SATISFACTION_SURVEYS);

  const [fuelSnap, emissionsSnap, maintenanceSnap, surveysSnap] = await Promise.all([
    fuelQ.get(),
    emissionsQ.get(),
    maintenanceQ.get(),
    surveysQ.get(),
  ]);

  const fuelRecords = fuelSnap.docs.map((d) => d.data());
  const emissionsReports = emissionsSnap.docs.map((d) => d.data());
  const maintenanceEvents = maintenanceSnap.docs.map((d) => d.data());
  const surveys = surveysSnap.docs.map((d) => d.data());

  const totalFuelLitresSaved = fuelRecords.reduce((sum: number, r) => {
    const rec = r as { fuelDeltaLPer100km?: number; annualDistanceKm?: number };
    if (rec.fuelDeltaLPer100km && rec.annualDistanceKm) {
      return sum + (rec.fuelDeltaLPer100km * rec.annualDistanceKm) / 100;
    }
    return sum;
  }, 0);

  const totalCostSavings = fuelRecords.reduce(
    (sum: number, r) => sum + ((r as { estimatedCostSavingsPerYear?: number }).estimatedCostSavingsPerYear || 0),
    0
  );

  const co2FromReports = emissionsReports.reduce(
    (sum: number, r) => sum + ((r as { scope1?: { co2AvoidedTonnes?: number } }).scope1?.co2AvoidedTonnes || 0),
    0
  );
  const co2FromFuel = (totalFuelLitresSaved * 2.68) / 1000;

  const totalMaintenanceAvoided = maintenanceEvents.reduce(
    (sum: number, e) => sum + ((e as { replacementCostAvoided?: number }).replacementCostAvoided || 0),
    0
  );

  const avgSatisfaction = surveys.length > 0
    ? surveys.reduce((s: number, r) => s + ((r as { overallSatisfaction?: number }).overallSatisfaction || 0), 0) / surveys.length
    : null;

  return {
    scope: organizationId || "asi-total",
    fuel: {
      vehicleRecords: fuelRecords.length,
      totalLitresSavedPerYear: Math.round(totalFuelLitresSaved),
      totalCostSavingsAud: Math.round(totalCostSavings),
    },
    emissions: {
      reportCount: emissionsReports.length,
      co2AvoidedTonnes: Number((co2FromReports > 0 ? co2FromReports : co2FromFuel).toFixed(2)),
      calculationSource: co2FromReports > 0 ? "filed_reports" : "derived_from_fuel",
    },
    maintenance: {
      eventCount: maintenanceEvents.length,
      replacementCostAvoidedAud: Math.round(totalMaintenanceAvoided),
    },
    satisfaction: {
      surveyCount: surveys.length,
      avgOverallScore: avgSatisfaction !== null ? Number(avgSatisfaction.toFixed(2)) : null,
    },
  };
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
    case "schedule_ims_audit":   return handleScheduleImsAudit(args);
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
    case "submit_ims_document_for_review": return handleSubmitImsDocumentForReview(args);
    case "approve_ims_document":  return handleApproveImsDocument(args);
    case "activate_ims_document": return handleActivateImsDocument(args);
    case "obsolete_ims_document": return handleObsoleteImsDocument(args);
    case "get_ims_health_snapshot": return handleGetImsHealthSnapshot();
    case "export_ims_document_pdf": return handleExportImsDocumentPdf(args);
    case "provision_auditor_access": return handleProvisionAuditorAccess(args);
    case "revoke_auditor_access":    return handleRevokeAuditorAccess(args);
    // Sales pipeline
    case "get_leads":            return handleGetLeads(args);
    case "get_pipeline_stats":   return handleGetPipelineStats(args);
    case "create_lead":          return handleCreateLead(args);
    case "update_lead_stage":    return handleUpdateLeadStage(args);
    case "log_outreach_event":   return handleLogOutreachEvent(args);
    case "enrich_pipeline_from_osint": return handleEnrichPipelineFromOsint(args);
    case "import_leads_from_osint": return handleImportLeadsFromOsint(args);
    case "ingest_osint_scan":    return handleIngestOsintScan(args);
    // Leads Register
    case "create_leads_register_entry": return handleCreateLeadsRegisterEntry(args);
    case "get_leads_register":          return handleGetLeadsRegister(args);
    case "get_leads_register_entry":    return handleGetLeadsRegisterEntry(args);
    case "update_leads_register_entry": return handleUpdateLeadsRegisterEntry(args);
    case "promote_leads_register_entry": return handlePromoteLeadsRegisterEntry(args);
    case "get_leads_register_weekly_shortlist": return handleGetLeadsRegisterWeeklyShortlist(args);
    case "get_leads_register_active_pursuits":  return handleGetLeadsRegisterActivePursuits(args);
    case "get_leads_register_stats":    return handleGetLeadsRegisterStats(args);
    // R&D & Grants Management (ARCHER / Sophie Archer)
    case "create_rnd_project":                return handleCreateRndProject(args);
    case "get_rnd_project":                   return handleGetRndProject(args);
    case "get_rnd_projects":                  return handleGetRndProjects(args);
    case "update_rnd_project":                return handleUpdateRndProject(args);
    case "record_rnd_project_approval":       return handleRecordRndProjectApproval(args);
    case "log_rnd_project_spend":             return handleLogRndProjectSpend(args);
    case "create_grant_application":          return handleCreateGrantApplication(args);
    case "get_grant_application":             return handleGetGrantApplication(args);
    case "get_grant_applications":            return handleGetGrantApplications(args);
    case "update_grant_application":          return handleUpdateGrantApplication(args);
    case "record_grant_internal_approval":    return handleRecordGrantInternalApproval(args);
    case "log_grant_compliance_event":        return handleLogGrantComplianceEvent(args);
    case "get_grants_dashboard":              return handleGetGrantsDashboard();
    case "log_rnd_opportunity":               return handleLogRndOpportunity(args);
    case "get_rnd_opportunities":             return handleGetRndOpportunities(args);
    case "get_opportunities_awaiting_review": return handleGetOpportunitiesAwaitingReview(args);
    case "review_rnd_opportunity":            return handleReviewRndOpportunity(args);
    case "convert_opportunity_to_project":    return handleConvertOpportunityToProject(args);
    // R&D Nominations
    case "get_rnd_nominations":               return handleGetRndNominations(args);
    case "get_rnd_nomination":                return handleGetRndNomination(args);
    case "update_rnd_nomination_prefeas":     return handleUpdateRndNominationPrefeas(args);
    case "approve_rnd_nomination":            return handleApproveRndNomination(args);
    case "reject_rnd_nomination":             return handleRejectRndNomination(args);
    // Grant Programme Watchlist
    case "create_grant_programme":            return handleCreateGrantProgramme(args);
    case "get_grant_programmes":              return handleGetGrantProgrammes(args);
    case "update_grant_programme":            return handleUpdateGrantProgramme(args);
    case "delete_grant_programme":            return handleDeleteGrantProgramme(args);
    case "push_archer_weekly_report":         return handlePushArcherWeeklyReport(args);
    // Contact Lookup
    case "contact_lookup":              return handleContactLookup(args);
    // Email Templates
    case "create_email_template":       return handleCreateEmailTemplate(args);
    case "get_email_templates":         return handleGetEmailTemplates(args);
    case "get_email_template":          return handleGetEmailTemplate(args);
    case "update_email_template":       return handleUpdateEmailTemplate(args);
    case "delete_email_template":       return handleDeleteEmailTemplate(args);
    case "approve_email_template":      return handleApproveEmailTemplate(args);
    case "push_vanguard_report": return handlePushVanguardReport(args);
    case "get_vanguard_report":  return handleGetVanguardReport(args);
    case "get_vanguard_reports": return handleGetVanguardReports(args);
    // CRM Organisations
    case "update_organization":  return handleUpdateOrganization(args);
    // Xero accounting
    case "xero_status":          return handleXeroStatus();
    case "close_out_job":        return handleCloseOutJob(args);
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
    // Agent heartbeat
    case "agent_heartbeat":           return handleAgentHeartbeat(args);
    case "get_agent_heartbeats":      return handleGetAgentHeartbeats();
    // SHIELD APEAX Distribution
    case "get_shield_queue":          return handleGetShieldQueue(args);
    case "approve_trade_application": return handleApproveTradeApplication(args);
    case "reject_trade_application":  return handleRejectTradeApplication(args);
    case "validate_apeax_order":      return handleValidateApeaxOrder(args);
    case "get_apeax_stock":           return handleGetApeaxStock(args);
    // ─── Jobs (lean) ────────────────────────────────────────────────────────
    case "list_jobs_summary":         return handleListJobsSummary(args);
    // ─── KPI Traceability ───────────────────────────────────────────────────
    case "create_fuel_record":        return handleCreateFuelRecord(args);
    case "create_emissions_report":   return handleCreateEmissionsReport(args);
    case "create_telemetry_reading":  return handleCreateTelemetryReading(args);
    case "create_maintenance_event":  return handleCreateMaintenanceEvent(args);
    case "submit_satisfaction_survey": return handleSubmitSatisfactionSurvey(args);
    case "get_kpi_summary":           return handleGetKpiSummary(args);
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
    case "mark_warranty_not_applicable":   return handleMarkWarrantyNotApplicable(args);
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

    // Gmail
    case "gmail_connect":       return handleGmailConnect();
    case "gmail_status":        return handleGmailStatus(args);
    case "gmail_get_profile":   return handleGmailGetProfile(args);
    case "gmail_search":        return handleGmailSearch(args);
    case "gmail_read_message":  return handleGmailReadMessage(args);
    case "gmail_read_thread":   return handleGmailReadThread(args);
    case "gmail_send":          return handleGmailSend(args);
    case "gmail_create_draft":  return handleGmailCreateDraft(args);
    case "gmail_list_drafts":   return handleGmailListDrafts(args);
    case "gmail_send_draft":    return handleGmailSendDraft(args);
    case "gmail_list_labels":   return handleGmailListLabels(args);
    case "gmail_modify_labels": return handleGmailModifyLabels(args);
    case "gmail_trash":         return handleGmailTrash(args);
    case "agent_email_audit":   return handleAgentEmailAudit(args);

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

  // Auto-seed KPI fuel record stub so this install feeds into the KPI Traceability module
  // once the baseline is captured. Organisation is the clientId (contactOrganizations doc id).
  const fuelStubPayload: Record<string, unknown> = {
    organizationId: clientId,
    organizationName: clientName,
    vehicleRegistration: String(assetIdentifier).toUpperCase(),
    vehicleDescription: typeof args.assetDescription === "string"
      ? args.assetDescription
      : [args.vehicleMake, args.vehicleModel].filter(Boolean).join(" ") || undefined,
    fuelType: "diesel",
    baselineConsumptionLPer100km: 0,
    baselinePeriodStart: "",
    baselinePeriodEnd: "",
    baselineSource: "manual",
    filmInstallationId: installRef.id,
    radshieldInstalled: filmType === "optishield" || String(args.filmProduct || "").toLowerCase().includes("optishield"),
    installDate: installedDate,
    notes: `Auto-seeded from film installation ${installationNumber}. Capture baseline + post-install consumption to enable KPI rollup.`,
    createdAt: now,
    updatedAt: now,
    createdBy: installedBy,
  };
  await db.collection(COLLECTIONS.FUEL_RECORDS).add(fuelStubPayload);

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

async function handleMarkWarrantyNotApplicable(args: Record<string, unknown>) {
  const db = admin.firestore();
  const ids = (args.installationIds as string[]) || [];
  if (ids.length === 0) throw new Error("installationIds array is required.");
  const reason = typeof args.reason === "string" ? args.reason : "Product does not require APEAX warranty registration";

  const results: Array<{ id: string; status: string }> = [];
  for (const id of ids) {
    const ref = db.collection(COLLECTIONS.FILM_INSTALLATIONS).doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      results.push({ id, status: "not_found" });
      continue;
    }
    await ref.update({
      "warrantyRegistration.status": "not_applicable",
      "warrantyRegistration.notes": reason,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    // Update warranty register if it exists
    const regSnap = await db.collection(COLLECTIONS.FILM_WARRANTY_REGISTER)
      .where("filmInstallationId", "==", id).limit(1).get();
    if (!regSnap.empty) {
      await regSnap.docs[0].ref.update({
        registrationStatus: "not_applicable",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    results.push({ id, status: "marked_not_applicable" });
  }

  return { success: true, updated: results.filter(r => r.status === "marked_not_applicable").length, results };
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

// ─── Gmail handlers ─────────────────────────────────────────────────────────

async function handleGmailConnect() {
  const { randomBytes } = await import("crypto");
  const state = randomBytes(16).toString("hex");
  const url = buildGmailAuthUrl(state);
  return { authUrl: url, instructions: "Open this URL in a browser to authorize Gmail access for Joshua's personal account. Agent mailboxes (accountmanager, development) use service account delegation and do NOT need OAuth." };
}

function getFromAccount(args: Record<string, unknown>): string {
  const v = args.from_account;
  return typeof v === "string" && v.trim() ? v.trim() : "default";
}

function getAgentIdentity(args: Record<string, unknown>): string | undefined {
  const v = args.agent_identity;
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

async function handleGmailStatus(args: Record<string, unknown>) {
  const fromAccount = getFromAccount(args);
  try {
    const profile = await gmailGetProfileForAccount(fromAccount) as { emailAddress?: string; messagesTotal?: number; threadsTotal?: number };
    return { connected: true, fromAccount, email: profile.emailAddress, messagesTotal: profile.messagesTotal, threadsTotal: profile.threadsTotal };
  } catch (err) {
    return { connected: false, fromAccount, error: err instanceof Error ? err.message : "Not connected" };
  }
}

async function handleGmailGetProfile(args: Record<string, unknown>) {
  return gmailGetProfileForAccount(getFromAccount(args));
}

async function handleGmailSearch(args: Record<string, unknown>) {
  const fromAccount = getFromAccount(args);
  const query = String(args.query || "");
  const maxResults = Math.min(Number(args.max_results) || 20, 100);
  const pageToken = args.page_token ? String(args.page_token) : undefined;

  const list = await gmailListMessagesForAccount(fromAccount, { query, maxResults, pageToken });
  const messages = (list.messages || []) as { id: string; threadId: string }[];

  const results = await Promise.all(
    messages.slice(0, maxResults).map(async (m) => {
      try {
        return await gmailGetMessageForAccount(fromAccount, m.id, "metadata");
      } catch {
        return { id: m.id, threadId: m.threadId, error: "Failed to fetch" };
      }
    })
  );

  return {
    fromAccount,
    messages: results,
    count: results.length,
    nextPageToken: list.nextPageToken || null,
    resultSizeEstimate: list.resultSizeEstimate,
  };
}

async function handleGmailReadMessage(args: Record<string, unknown>) {
  return gmailGetMessageForAccount(getFromAccount(args), String(args.message_id));
}

async function handleGmailReadThread(args: Record<string, unknown>) {
  return gmailGetThreadForAccount(getFromAccount(args), String(args.thread_id));
}

async function handleGmailSend(args: Record<string, unknown>) {
  return gmailSendMessageForAccount(getFromAccount(args), {
    to: String(args.to),
    subject: String(args.subject),
    body: String(args.body),
    cc: args.cc ? String(args.cc) : undefined,
    bcc: args.bcc ? String(args.bcc) : undefined,
    replyTo: args.reply_to ? String(args.reply_to) : undefined,
    inReplyTo: args.in_reply_to ? String(args.in_reply_to) : undefined,
    threadId: args.thread_id ? String(args.thread_id) : undefined,
    agentIdentity: getAgentIdentity(args),
  });
}

async function handleGmailCreateDraft(args: Record<string, unknown>) {
  return gmailCreateDraftForAccount(getFromAccount(args), {
    to: String(args.to),
    subject: String(args.subject),
    body: String(args.body),
    cc: args.cc ? String(args.cc) : undefined,
    bcc: args.bcc ? String(args.bcc) : undefined,
    agentIdentity: getAgentIdentity(args),
  });
}

async function handleGmailListDrafts(args: Record<string, unknown>) {
  return gmailListDraftsForAccount(getFromAccount(args), Number(args.max_results) || 10);
}

async function handleGmailSendDraft(args: Record<string, unknown>) {
  return gmailSendDraftForAccount(
    getFromAccount(args),
    String(args.draft_id),
    getAgentIdentity(args),
  );
}

async function handleGmailListLabels(args: Record<string, unknown>) {
  return gmailListLabelsForAccount(getFromAccount(args));
}

async function handleGmailModifyLabels(args: Record<string, unknown>) {
  return gmailModifyLabelsForAccount(
    getFromAccount(args),
    String(args.message_id),
    (args.add_labels as string[]) || [],
    (args.remove_labels as string[]) || [],
    getAgentIdentity(args),
  );
}

async function handleGmailTrash(args: Record<string, unknown>) {
  return gmailTrashMessageForAccount(
    getFromAccount(args),
    String(args.message_id),
    getAgentIdentity(args),
  );
}

async function handleAgentEmailAudit(args: Record<string, unknown>) {
  const db = admin.firestore();
  let q: admin.firestore.Query = db.collection(COLLECTIONS.AGENT_EMAIL_AUDIT)
    .orderBy("createdAt", "desc");

  if (typeof args.accountKey === "string") q = q.where("accountKey", "==", args.accountKey);
  if (typeof args.agentIdentity === "string") q = q.where("agentIdentity", "==", args.agentIdentity);
  if (typeof args.action === "string") q = q.where("action", "==", args.action);
  if (typeof args.success === "boolean") q = q.where("success", "==", args.success);

  const limit = typeof args.limit === "number" ? Math.min(Math.max(1, args.limit), 500) : 50;
  q = q.limit(limit);

  const snap = await q.get();
  return snap.docs.map((d) => serializeDoc(d.id, d.data()));
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

  let timer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // Tell the client to POST messages to this same endpoint
      controller.enqueue(
        encoder.encode(`event: endpoint\ndata: ${url.pathname}\n\n`)
      );
      // Keep-alive comments so the connection doesn't time out immediately.
      // Tracked on the outer scope so cancel() can clear it — otherwise the
      // interval fires forever after disconnect and tries to write to a
      // closed controller, spamming unhandled rejections into the function
      // health stream and triggering flaky-looking reconnects.
      timer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keep-alive\n\n`));
        } catch {
          if (timer) clearInterval(timer);
          timer = null;
        }
      }, 15000);
    },
    cancel() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  });

  // Also bail if the request itself is aborted (Netlify connection drops,
  // client navigates away, etc.) — ReadableStream.cancel isn't always
  // fired in every runtime, so belt-and-braces.
  req.signal.addEventListener("abort", () => {
    if (timer) clearInterval(timer);
    timer = null;
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
