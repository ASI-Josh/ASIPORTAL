export const COLLECTIONS = {
  USERS: "users",
  BOOKINGS: "bookings",
  JOBS: "jobs",
  INSPECTIONS: "inspections",
  LEADS: "leads",
  SALES_ACTIVITIES: "salesActivities",
  SALES_TASKS: "salesTasks",
  CONTACT_ORGANIZATIONS: "contactOrganizations",
  ORGANIZATION_CONTACTS: "organizationContacts",
  FILM_INSTALLATIONS: "filmInstallations",
  FILM_WARRANTY_INSPECTIONS: "filmWarrantyInspections",
  FILM_WARRANTY_REGISTER: "filmWarrantyRegister",
  QUOTES: "quotes",
  CALENDAR_EVENTS: "calendarEvents",
  CALENDAR_TOKENS: "calendarTokens",
  WORKS_REGISTER: "worksRegister",
  NOTIFICATIONS: "notifications",
  MAIL: "mail",
  USER_INVITES: "userInvites",
  GOODS_RECEIVED: "goodsReceivedInspections",
  ANALYTICS_DAILY: "analyticsDaily",
  AI_INSIGHTS: "aiInsights",
  CLIENT_INSIGHTS: "clientInsights",
  FLEET_VEHICLES: "fleetVehicles",
  STOCK_ITEMS: "stockItems",
  PURCHASE_ORDERS: "purchaseOrders",
  PRESTART_CHECKS: "prestartChecks",
  IMS_DOCUMENTS: "imsDocuments",
  IMS_DOCUMENT_COUNTERS: "imsDocumentCounters",
  IMS_AUDITS: "imsAudits",
  ASSISTANT_MESSAGES: "assistantMessages",
  ASSISTANT_KNOWLEDGE: "assistantKnowledge",
  AUTOMATION_AGENTS: "automationAgents",
  AGENT_HEARTBEATS: "agentHeartbeats",
  TRADE_ACCOUNTS: "tradeAccounts",
  APEAX_ORDERS: "apeaxOrders",
  APEAX_SESSIONS: "apeaxSessions",
  AGENT_PROFILES: "agentProfiles",
  AGENT_HUB_MESSAGES: "agentHubMessages",
  AGENT_HUB_ACTIONS: "agentHubActions",
  AGENT_HUB_DOCS: "agentHubDocs",
  AGENT_HUB_THREADS: "agentHubThreads",
  IMS_CORRECTIVE_ACTIONS: "imsCorrectiveActions",
  IMS_INCIDENTS: "imsIncidents",
  IMS_RISK_REGISTER: "imsRiskRegister",
  OSINT_SCANS: "osintScans",
  OPPORTUNITIES: "opportunities",
  VANGUARD_REPORTS: "vanguardReports",
  XERO_TOKENS: "xeroTokens",
  EXECUTIVE_REPORTS: "executiveReports",
  DEPARTMENT_REPORTS: "departmentReports",
  MEETINGS: "meetings",
  MEETING_TEMPLATES: "meetingTemplates",
  MEETING_ACTIONS: "meetingActions",
  // KPI Traceability Module
  FUEL_RECORDS: "fuelRecords",
  EMISSIONS_REPORTS: "emissionsReports",
  TELEMETRY_READINGS: "telemetryReadings",
  MAINTENANCE_EVENTS: "maintenanceEvents",
  ZEB_ENERGY_RECORDS: "zebEnergyRecords",
  KPI_SNAPSHOTS: "kpiSnapshots",
  SATISFACTION_SURVEYS: "satisfactionSurveys",
  // Leads Register & Email Templates
  LEADS_REGISTER: "leadsRegister",
  EMAIL_TEMPLATES: "emailTemplates",
  // Agent email audit trail (every email sent/received by an agent mailbox)
  AGENT_EMAIL_AUDIT: "agentEmailAudit",
  GMAIL_TOKENS: "gmailTokens",
  // Secure server-side credentials (service account keys, API secrets)
  // kept out of env vars to avoid AWS Lambda 4KB ceiling.
  SECURE_CREDENTIALS: "secureCredentials",
  // R&D & Grants Management (Sophie Archer's domain)
  RND_PROJECTS: "rndProjects",
  GRANT_APPLICATIONS: "grantApplications",
  RND_OPPORTUNITY_LOG: "rndOpportunityLog",
  RND_COUNTERS: "rndCounters",
  RND_GRANT_PROGRAMMES: "rndGrantProgrammes",
  RND_PROJECT_NOMINATIONS: "rndProjectNominations",
  // Cutting workflow (Phase 0 — standalone, multi-tenant ready)
  CUTTING_JOBS: "cuttingJobs",
  CUTTING_MATERIAL_PROFILES: "cuttingMaterialProfiles",
  CUTTING_COUNTERS: "cuttingCounters",
} as const;

/**
 * Agent mailbox registry. Maps an agent identifier to:
 *   - the real Gmail address they send from
 *   - the human display name used in the From: header
 *   - the list of agents authorised to use this mailbox
 *
 * All mailboxes use service account domain-wide delegation — no per-
 * mailbox OAuth required. The service account impersonates the address
 * at call time.
 *
 * To add a new mailbox: add a new entry here, grant the address in your
 * Google Workspace admin console, and ensure the GOOGLE_SERVICE_ACCOUNT_B64
 * service account has domain-wide delegation enabled for gmail scopes.
 */
export const AGENT_MAILBOXES = {
  accountmanager: {
    address: "accountmanager@asi-australia.com.au",
    displayName: "James Ledger",
    authorisedAgents: ["LEDGER"],
    description: "LEDGER — Accounts Manager / CFO correspondence",
  },
  development: {
    address: "development@asi-australia.com.au",
    displayName: "ASI Development",
    authorisedAgents: ["SENTINEL", "MERCER", "VANGUARD", "ARCHER"],
    description: "Sales — HV/Bus/Coach (David Sentinel), Sales — Passenger/Trade (Emily Mercer), innovation/supply chain (Peter Vanguard), R&D & grants (Sophie Archer) correspondence",
  },
  resources: {
    address: "resources@asi-australia.com.au",
    displayName: "Vesta Hearth",
    authorisedAgents: ["VESTA"],
    description: "Human & AI Resources — onboarding, training, inductions, requals (Vesta Hearth)",
  },
} as const;

export type AgentMailboxKey = keyof typeof AGENT_MAILBOXES;

export function isAgentMailbox(key: string): key is AgentMailboxKey {
  return key in AGENT_MAILBOXES;
}
