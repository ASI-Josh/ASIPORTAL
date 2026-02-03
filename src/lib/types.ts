import { Timestamp } from "firebase/firestore";

// ============================================
// USER TYPES
// ============================================

export type UserRole = "admin" | "technician" | "client" | "contractor";

export interface User {
  uid: string;
  email: string;
  role: UserRole;
  name: string;
  phone?: string;
  avatarUrl?: string;
  organizationId?: string;
  organizationName?: string;
  contactId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface UserInvite {
  id: string;
  email: string;
  name?: string;
  role: UserRole;
  organizationId?: string;
  organizationName?: string;
  contactId?: string;
  invitedBy?: string;
  status: "pending" | "accepted" | "revoked";
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  acceptedAt?: Timestamp;
  userId?: string;
}

export interface FileAttachment {
  id: string;
  name: string;
  url: string;
  uploadedAt?: Timestamp;
  uploadedBy?: {
    id: string;
    name: string;
    email?: string;
  };
}

// ============================================
// JOB LIFECYCLE MANAGEMENT (JLM)
// ============================================

export type JobStatus = "pending" | "scheduled" | "in_progress" | "completed" | "closed" | "cancelled";

export type JobLifecycleStage = "rfq" | "job_scheduled" | "job_live" | "job_completed" | "management_closeoff";

export type BookingType = 
  | "windscreen_crack_chip_repair"
  | "windscreen_replacement"
  | "scratch_graffiti_removal"
  | "film_installation"
  | "trim_restoration_interior"
  | "trim_restoration_exterior"
  | "polymer_lens_restoration";

export const BOOKING_TYPE_LABELS: Record<BookingType, string> = {
  windscreen_crack_chip_repair: "Windscreen Crack/Chip Repair",
  windscreen_replacement: "Windscreen Replacement",
  scratch_graffiti_removal: "Scratch/Graffiti Removal",
  film_installation: "Film Installation",
  trim_restoration_interior: "Trim Restoration (Interior)",
  trim_restoration_exterior: "Trim Restoration (Exterior)",
  polymer_lens_restoration: "Polymer Lens Restoration",
};

export const JOB_LIFECYCLE_LABELS: Record<JobLifecycleStage, string> = {
  rfq: "RFQ",
  job_scheduled: "Job Scheduled",
  job_live: "Job Live",
  job_completed: "Job Completed",
  management_closeoff: "Management Close-off",
};

// ============================================
// VEHICLE & REPAIR SITE TYPES (Job Card Data Entry)
// ============================================

export interface Vehicle {
  registration: string;
  make?: string;
  model?: string;
  year?: number;
  vin?: string;
  color?: string;
  fleetAssetNumber?: string;
  bodyManufacturer?: string;
  poWorksOrderNumber?: string;
}

export interface FleetVehicle {
  id: string;
  organizationId: string;
  registration: string;
  vin?: string;
  fleetAssetNumber?: string;
  bodyManufacturer?: string;
  year?: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface JobVehicle {
  id: string;
  // Required: Registration OR VIN (at least one)
  registration?: string;
  vin?: string;
  // Optional fields
  fleetAssetNumber?: string;
  bodyManufacturer?: string;
  year?: number;
  poWorksOrderNumber?: string;
  // Repair sites on this vehicle
  repairSites: RepairSite[];
  // Consumables used (for scratch/graffiti repairs)
  microfiberDisksUsed: MicrofiberDiskUsage[];
  // Vehicle-level status
  status: "pending" | "in_progress" | "completed" | "on_hold";
  holdReason?: string; // Required if status is on_hold (e.g., "Parts on order", "Awaiting approval")
  // Calculated totals
  totalCost: number;
  totalLabourCost: number;
  totalMaterialsCost: number;
}

export type RepairType = BookingType;

export type RepairWorkStatus = "not_started" | "in_progress" | "on_hold" | "completed";
export type RepairWorkLogStatus = "started" | "held" | "resumed" | "completed";

export interface RepairWorkLogEntry {
  status: RepairWorkLogStatus;
  at: Timestamp;
  by: string;
  note?: string;
}

export interface RepairSite {
  id: string;
  repairType: RepairType;
  location: string; // e.g., "Front windscreen - driver side", "Rear bumper - left panel"
  description?: string;
  severity?: "minor" | "moderate" | "severe";
  // Photos
  preWorkPhotos: string[]; // URLs to pre-work images
  postWorkPhotos: string[]; // URLs to post-work images
  // Cost entry by user
  totalCost: number;
  // Auto-calculated: 70% labour, 30% materials
  labourCost: number; // totalCost * 0.70
  materialsCost: number; // totalCost * 0.30
  // Status
  isCompleted: boolean;
  workStatus?: RepairWorkStatus;
  workLog?: RepairWorkLogEntry[];
  holdReason?: string;
  completedAt?: Timestamp;
  completedBy?: string;
}

// Microfiber Disk consumables for scratch/graffiti removal
export type MicrofiberDiskGrade = "1" | "2" | "3" | "4" | "5";
export type MicrofiberDiskSize = "2" | "3" | "5"; // inches

export interface MicrofiberDiskUsage {
  grade: MicrofiberDiskGrade;
  size: MicrofiberDiskSize;
  quantity: number;
}

// Pre-defined microfiber disk options for UI
export const MICROFIBER_DISK_GRADES: { value: MicrofiberDiskGrade; label: string }[] = [
  { value: "1", label: "Grade #1" },
  { value: "2", label: "Grade #2" },
  { value: "3", label: "Grade #3" },
  { value: "4", label: "Grade #4" },
  { value: "5", label: "Grade #5" },
];

export const MICROFIBER_DISK_SIZES: { value: MicrofiberDiskSize; label: string }[] = [
  { value: "2", label: "2\"" },
  { value: "3", label: "3\"" },
  { value: "5", label: "5\"" },
];

// Helper function to calculate cost breakdown
export function calculateCostBreakdown(totalCost: number): { labourCost: number; materialsCost: number } {
  return {
    labourCost: Math.round(totalCost * 0.70 * 100) / 100,
    materialsCost: Math.round(totalCost * 0.30 * 100) / 100,
  };
}

// Legacy DamageItem for backwards compatibility
export interface DamageItem {
  id: string;
  description: string;
  severity: "minor" | "moderate" | "severe";
  location: string;
  photoUrls: string[];
  estimatedCost?: number;
}

export interface QuoteLineItem {
  id: string;
  type: "labor" | "material";
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface QuoteDetails {
  items: QuoteLineItem[];
  subtotal: number;
  gst: number;
  total: number;
  validUntil?: Timestamp;
  approvedAt?: Timestamp;
  approvedBy?: string;
}

export interface TechnicianAssignment {
  technicianId: string;
  technicianName?: string;
  role: "primary" | "secondary";
  assignedAt: Timestamp;
  assignedBy: string;
}

export interface StatusLogEntry {
  status: JobStatus;
  changedAt: Timestamp;
  changedBy: string;
  notes?: string;
}

export interface BookingInfo {
  preferredDate?: Timestamp;
  preferredTime?: string;
  urgency?: "low" | "medium" | "high";
  specialInstructions?: string;
}

export interface Booking {
  id: string;
  bookingNumber: string;
  bookingType: BookingType;
  organizationId: string;
  organizationName: string;
  contactId: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  siteLocation: {
    id?: string;
    name: string;
    address: Address;
  };
  scheduledDate: Timestamp;
  scheduledTime: string;
  allocatedStaff: {
    id: string;
    name: string;
    type: "asi_staff" | "subcontractor";
  }[];
  allocatedStaffIds: string[];
  notes?: string;
  status: "pending" | "confirmed" | "converted_to_job" | "cancelled";
  convertedJobId?: string;
  calendarEventId?: string;
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
}

export interface Job {
  id: string;
  jobNumber: string;
  jobDescription?: string;
  clientId: string;
  clientName: string;
  clientEmail: string;
  clientPhone?: string;
  organizationId?: string;
  // Legacy vehicle array (for backwards compatibility)
  vehicles: Vehicle[];
  // New: Enhanced job vehicles with repair sites and cost tracking
  jobVehicles: JobVehicle[];
  // Legacy damage array (for backwards compatibility)
  damage: DamageItem[];
  status: JobStatus;
  assignedTechnicians: TechnicianAssignment[];
  assignedTechnicianIds?: string[];
  booking?: BookingInfo;
  quoteDetails?: QuoteDetails;
  statusLog: StatusLogEntry[];
  scheduledDate?: Timestamp;
  completedDate?: Timestamp;
  managementApprovedAt?: Timestamp;
  managementApprovedBy?: string;
  invoiceNumber?: string;
  invoiceDate?: Timestamp;
  invoiceSentAt?: Timestamp;
  closedAt?: Timestamp;
  closedBy?: string;
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
  notes?: string;
  isDeleted?: boolean;
  deletedAt?: Timestamp;
  deletedBy?: string;
  restoredAt?: Timestamp;
  restoredBy?: string;
  // Site location for the job
  siteLocation?: {
    name: string;
    address: string;
  };
  // Job-level totals (calculated from all vehicles)
  totalJobCost?: number;
  totalLabourCost?: number;
  totalMaterialsCost?: number;
  completionAudit?: JobCompletionAudit;
}

export interface JobCompletionAudit {
  status: "pass" | "needs_attention";
  issues: string[];
  billingNotes: string[];
  commercialOpportunities: string[];
  improvements: string[];
  complianceChecks: string[];
  generatedAt: Timestamp;
  generatedBy?: string;
  source?: "agent" | "manual";
}

// ============================================
// INSPECTION SYSTEM
// ============================================

export type InspectionStatus = "draft" | "submitted" | "approved" | "converted" | "rejected";

export type InspectionRepairType = "bodywork" | "paint" | "glass" | "trim" | "mechanical" | "other";

export interface DamageReportItem {
  id: string;
  repairType: RepairType;
  description: string;
  location: string;
  severity: "minor" | "moderate" | "severe";
  photoUrls?: string[];
  preWorkPhotos?: string[];
  postWorkPhotos?: string[];
  recommendedAction?: string;
  estimatedCost?: number;
  totalCost?: number;
  labourCost?: number;
  materialsCost?: number;
  clientDecision?: "pending" | "approved" | "rejected";
  clientDecisionNotes?: string;
  clientDecisionAt?: Timestamp;
}

export interface VehicleReport {
  vehicleId: string;
  vehicle: Vehicle;
  damages: DamageReportItem[];
  overallCondition: "excellent" | "good" | "fair" | "poor";
  additionalNotes?: string;
}

export interface Inspection {
  id: string;
  inspectionNumber: string;
  organizationId?: string;
  organizationName?: string;
  contactId?: string;
  contactName?: string;
  clientId?: string;
  clientName: string;
  clientEmail: string;
  clientPhone?: string;
  scheduledDate?: Timestamp;
  scheduledTime?: string;
  assignedStaff?: {
    id: string;
    name: string;
    type: "asi_staff" | "subcontractor";
    email?: string;
  }[];
  assignedStaffIds?: string[];
  notes?: string;
  siteLocation?: {
    name: string;
    address: Address;
  };
  vehicleReports: VehicleReport[];
  status: InspectionStatus;
  submittedAt?: Timestamp;
  approvedAt?: Timestamp;
  clientApprovalStatus?: "pending" | "approved" | "rejected" | "partial";
  clientApprovalUpdatedAt?: Timestamp;
  convertedToJobId?: string;
  worksRegisterId?: string;
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
  findings?: string;
  reportSummary?: string;
  reportSummaryUpdatedAt?: Timestamp;
}

// ============================================
// GOODS RECEIVED (ISO 9001 QA)
// ============================================

export type GoodsInspectionStatus = "draft" | "submitted" | "closed";
export type GoodsDecision = "accepted" | "rejected" | "conditional";
export type GoodsConformance = "conforming" | "non_conforming";
export type CorrectiveActionStatus = "open" | "in_progress" | "closed";

export interface GoodsReceivedItem {
  id: string;
  description: string;
  itemType?: "consumable" | "stock" | "plant";
  stockNumber?: string;
  supplierPartNumber?: string;
  quantity: number;
  unit?: string;
  batchNumber?: string;
  conformance: GoodsConformance;
  notes?: string;
}

export interface CorrectiveAction {
  required: boolean;
  description?: string;
  assignedTo?: string;
  dueDate?: Timestamp;
  status?: CorrectiveActionStatus;
  closureNotes?: string;
  closedAt?: Timestamp;
  closedBy?: string;
}

export interface GoodsReceivedInspection {
  id: string;
  poNumber: string;
  clientReference?: string;
  supplierName: string;
  supplierId?: string;
  category?: string;
  receivedDate?: Timestamp;
  receivedBy?: {
    id: string;
    name: string;
    email?: string;
  };
  status: GoodsInspectionStatus;
  decision?: GoodsDecision;
  nonConformanceNotes?: string;
  correctiveAction?: CorrectiveAction;
  items: GoodsReceivedItem[];
  attachments?: {
    shippingDocs?: FileAttachment[];
    packingList?: FileAttachment[];
  };
  stockAppliedAt?: Timestamp;
  stockAppliedBy?: string;
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
  closedAt?: Timestamp;
  closedBy?: string;
}

export type StockItemType = "consumable" | "stock" | "plant";

export interface StockItem {
  id: string;
  supplierId?: string;
  supplierName?: string;
  description: string;
  lookupKey: string;
  internalStockNumber: string;
  supplierPartNumber?: string;
  category?: string;
  itemType: StockItemType;
  quantityOnHand: number;
  unit?: string;
  lastReceivedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ============================================
// DAILY PRESTART CHECKS (ISO 9001)
// ============================================

export type PrestartIssueStatus = "open" | "in_progress" | "closed";
export type PrestartIssueCategory = "tools" | "consumables" | "devices" | "vehicle" | "other";

export interface PrestartIssue {
  id: string;
  title: string;
  description?: string;
  category?: PrestartIssueCategory;
  status: PrestartIssueStatus;
  assignedToId?: string;
  assignedToName?: string;
  assignedToEmail?: string;
  dueDate?: Timestamp;
  createdAt: Timestamp;
  createdById: string;
  createdByName: string;
  createdByEmail?: string;
  closureNotes?: string;
  closedAt?: Timestamp;
  closedBy?: string;
}

export interface PrestartChecklist {
  toolsReady: boolean;
  toolsNotes?: string;
  consumablesReady: boolean;
  consumablesNotes?: string;
  devicesCharged: boolean;
  devicesNotes?: string;
  vehicleSafety: {
    tyresOk: boolean;
    lightsOk: boolean;
    fluidsOk: boolean;
    safetyEquipmentOk: boolean;
    registrationOk: boolean;
    cabCleanOk: boolean;
  };
  vehicleNotes?: string;
  kits: {
    crackRepairKit: boolean;
    scratchRemovalKit: boolean;
    trimRepairKit: boolean;
    filmInstallationKit: boolean;
  };
  kitNotes?: string;
}

export interface PrestartCheck {
  id: string;
  prestartDate: string;
  status: "completed" | "draft";
  checklist: PrestartChecklist;
  issues: PrestartIssue[];
  notes?: string;
  createdAt: Timestamp;
  createdById: string;
  createdByName: string;
  createdByEmail?: string;
  updatedAt: Timestamp;
}

// ============================================
// IMS DOCUMENT CONTROL
// ============================================

export type IMSDocumentType =
  | "policy"
  | "manual"
  | "ims_procedure"
  | "technical_procedure"
  | "work_instruction"
  | "form"
  | "register";

export type IMSDocumentStatus = "draft" | "active" | "obsolete";
export type IMSRevisionStatus = "draft" | "review" | "issued" | "obsolete";

export interface IMSDocumentFile {
  name: string;
  path: string;
  contentType?: string;
  size?: number;
}

export interface IMSAgentDraftOutput {
  metadata: {
    docId: string;
    title: string;
    type: IMSDocumentType;
    status: string;
    revision: string;
    issueDate: string;
    processOwner: string;
    isoClauses: string[];
    relatedDocs: string[];
  };
  sections: Array<{
    title: string;
    content: string;
  }>;
  changeSummary: string[];
  adminIssuanceChecklist: string[];
  questions: string[];
}

export interface IMSDocumentRevision {
  id: string;
  revisionNumber: number;
  issueDate: Timestamp;
  status: IMSRevisionStatus;
  summary?: string;
  file?: IMSDocumentFile;
  supportingFiles?: IMSDocumentFile[];
  draftOutput?: IMSAgentDraftOutput;
  draftPrompt?: string;
  source?: "agent" | "manual";
  isCurrent: boolean;
  createdAt: Timestamp;
  createdById: string;
  createdByName: string;
  createdByEmail?: string;
  submittedForReviewAt?: Timestamp;
  submittedForReviewById?: string;
  submittedForReviewByName?: string;
  approvedAt?: Timestamp;
  approvedById?: string;
  approvedByName?: string;
  approvedByEmail?: string;
  approvedBy?: string;
}

export interface IMSDocument {
  id: string;
  docNumber: string;
  title: string;
  docType: IMSDocumentType;
  status: IMSDocumentStatus;
  owner?: {
    id: string;
    name: string;
    email?: string;
  };
  isoClauses?: string[];
  currentRevisionId?: string;
  currentRevisionNumber?: number;
  currentIssueDate?: Timestamp;
  currentFile?: IMSDocumentFile;
  createdAt: Timestamp;
  createdById: string;
  createdByName: string;
  createdByEmail?: string;
  updatedAt: Timestamp;
}

export interface IMSAuditReport {
  id: string;
  metadata: {
    auditId: string;
    standard: "ISO9001:2015";
    scope: string;
    period: string;
    sites: string[];
    processes: string[];
    leadAuditor: string;
    auditDate: string;
    status: "planned" | "in_progress" | "completed";
  };
  plan: {
    objectives: string[];
    criteria: string[];
    methods: string[];
    schedule: Array<{
      area: string;
      time: string;
      owner: string;
    }>;
  };
  checklist: Array<{
    clause: string;
    question: string;
    evidenceNeeded: string;
    records: string[];
  }>;
  findings: Array<{
    id: string;
    type: "conformity" | "observation" | "OFI" | "minor_nc" | "major_nc";
    clause: string;
    requirement: string;
    evidence: string;
    description: string;
    risk: string;
    correctiveAction: string;
    owner: string;
    dueDate: string;
    status: "open" | "closed";
  }>;
  summary: {
    strengths: string[];
    risks: string[];
    overallConclusion: string;
  };
  questions: string[];
  prompt?: string;
  source?: "agent" | "manual";
  createdAt: Timestamp;
  createdById: string;
  createdByName: string;
  createdByEmail?: string;
  updatedAt: Timestamp;
}

export type AgentCommunityCategory = "professional" | "awareness";

export interface AgentProfile {
  id: string;
  name: string;
  roleTitle: string;
  aboutWork?: string;
  aboutPersonal?: string;
  avatarUrl?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

// ============================================
// AUTOMATION AGENTS
// ============================================

export type AutomationAgentStatus = "draft" | "active" | "paused" | "retired";
export type AutomationAgentType = "workflow" | "assistant" | "api";

export interface AutomationAgent {
  id: string;
  name: string;
  type: AutomationAgentType;
  status: AutomationAgentStatus;
  purpose?: string;
  model?: string;
  workflowId?: string;
  assistantId?: string;
  endpoint?: string;
  owner?: {
    id: string;
    name: string;
    email?: string;
  };
  capabilities?: string[];
  notes?: string;
  lastRunAt?: Timestamp;
  lastRunStatus?: "success" | "failed" | "unknown";
  createdAt: Timestamp;
  createdById: string;
  createdByName: string;
  createdByEmail?: string;
  updatedAt: Timestamp;
}

// ============================================
// CRM & SALES PIPELINE
// ============================================

export type PipelineStage = "leads" | "cold-leads" | "hot-leads" | "meeting-booked" | "deal-closed" | "onboarding";

export type ActivityType = "call" | "email" | "meeting" | "follow-up" | "qualification";

export interface SalesActivity {
  id: string;
  leadId: string;
  type: ActivityType;
  title: string;
  description: string;
  createdBy: string;
  createdAt: Timestamp;
}

export interface SalesTask {
  id: string;
  leadId: string;
  title: string;
  description?: string;
  type: ActivityType;
  priority: "low" | "medium" | "high";
  assignedTo: string;
  dueDate: Timestamp;
  completed: boolean;
  completedAt?: Timestamp;
  createdAt: Timestamp;
}

export interface Lead {
  id: string;
  companyName: string;
  contactPerson: string;
  email: string;
  phone?: string;
  stage: PipelineStage;
  value: number;
  probability: number;
  serviceType: string;
  source?: string;
  assignedTo: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastContactedAt?: Timestamp;
  expectedCloseDate?: Timestamp;
  notes?: string;
}

// ============================================
// CONTACT ORGANIZATIONS
// ============================================

export type ContactCategory = "trade_client" | "retail_client" | "supplier_vendor" | "asi_staff";

export const CONTACT_CATEGORY_LABELS: Record<ContactCategory, string> = {
  trade_client: "Trade Client",
  retail_client: "Retail Client",
  supplier_vendor: "Supplier/Vendor",
  asi_staff: "ASI Staff",
};

export type OrganizationType = "customer" | "supplier" | "partner";
export type OrganizationStatus = "active" | "inactive" | "prospect";
export type MarketStream = "commercial" | "government" | "retail" | "industrial";

export interface Address {
  street: string;
  suburb: string;
  state: string;
  postcode: string;
  country: string;
}

export interface SiteLocation {
  id?: string;
  name: string;
  address: Address;
  isDefault: boolean;
  contactName?: string;
  contactPhone?: string;
  notes?: string;
}

export interface ContactOrganization {
  id: string;
  name: string;
  category: ContactCategory;
  type: OrganizationType;
  status: OrganizationStatus;
  jobCode?: string;
  abn?: string;
  marketStream?: MarketStream;
  domains?: string[];
  portalRole?: UserRole;
  industry?: string;
  address?: Address;
  sites: SiteLocation[];
  phone?: string;
  email?: string;
  website?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type ContactRole = "primary" | "billing" | "technical" | "management";
export type ContactStatus = "active" | "inactive";

export interface OrganizationContact {
  id: string;
  organizationId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  mobile?: string;
  role: ContactRole;
  jobTitle?: string;
  status: ContactStatus;
  isPrimary: boolean;
  hasPortalAccess: boolean;
  portalUserId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ============================================
// FILM MANAGEMENT (APEAX)
// ============================================

export type FilmType = "APEAX" | "other";
export type WarrantyStatus = "active" | "expired" | "claimed";

export interface FilmInstallation {
  id: string;
  jobId: string;
  clientId: string;
  clientName: string;
  clientEmail: string;
  vehicle: Vehicle;
  filmType: FilmType;
  coverageAreas: string[];
  installationDate: Timestamp;
  installedBy: string;
  warrantyYears: number;
  warrantyExpiry: Timestamp;
  warrantyStatus: WarrantyStatus;
  serialNumber?: string;
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface FilmClaim {
  id: string;
  filmInstallationId: string;
  claimDate: Timestamp;
  issue: string;
  photoUrls: string[];
  status: "pending" | "approved" | "rejected" | "completed";
  resolution?: string;
  resolvedAt?: Timestamp;
  createdAt: Timestamp;
}

// ============================================
// QUOTES
// ============================================

export type QuoteStatus = "draft" | "sent" | "approved" | "rejected" | "expired";

export interface Quote {
  id: string;
  quoteNumber: string;
  clientId: string;
  jobId?: string;
  items: QuoteLineItem[];
  subtotal: number;
  gst: number;
  total: number;
  status: QuoteStatus;
  validUntil: Timestamp;
  approvedAt?: Timestamp;
  rejectedAt?: Timestamp;
  notes?: string;
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
}

// ============================================
// CALENDAR EVENTS
// ============================================

export interface CalendarEvent {
  id: string;
  googleEventId?: string;
  title: string;
  description?: string;
  startTime: Timestamp;
  endTime: Timestamp;
  attendees: string[];
  jobId?: string;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  syncStatus?: "pending" | "synced" | "failed";
}

// ============================================
// GOOGLE CALENDAR INTEGRATION
// ============================================

export interface UserCalendarToken {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Timestamp;
  scope: string;
  updatedAt: Timestamp;
}

// ============================================
// WORKS REGISTER (ISO COMPLIANCE)
// ============================================

export type ComplianceStandard = "ISO9001" | "ISO14001" | "ISO45001" | "AS_NZS_2366";

export interface WorksRegisterEntry {
  id: string;
  jobId: string;
  jobNumber: string;
  organizationId: string;
  clientName: string;
  serviceType: string;
  recordType?: "job" | "inspection";
  technicianId: string;
  technicianName: string;
  startDate: Timestamp;
  completionDate?: Timestamp;
  qualityChecks: QualityCheck[];
  complianceStandards: ComplianceStandard[];
  auditNotes?: string;
  approvedBy?: string;
  approvedAt?: Timestamp;
  createdAt: Timestamp;
}

export interface QualityCheck {
  id: string;
  checkType: string;
  description: string;
  passed: boolean;
  checkedBy: string;
  checkedAt: Timestamp;
  notes?: string;
}

// ============================================
// NOTIFICATIONS
// ============================================

export type NotificationType =
  | "job_assigned"
  | "job_status_changed"
  | "job_started"
  | "job_on_hold"
  | "job_completed"
  | "quote_approved"
  | "inspection_submitted"
  | "booking_received"
  | "agent_mention"
  | "ims_review";

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  relatedEntityId?: string;
  relatedEntityType?: "job" | "inspection" | "lead" | "quote" | "agent_thread" | "ims_document";
  createdAt: Timestamp;
}

// ============================================
// ANALYTICS & REPORTING
// ============================================

export interface RevenueMetric {
  period: string;
  revenue: number;
  jobCount: number;
  averageJobValue: number;
}

export interface TechnicianPerformance {
  technicianId: string;
  technicianName: string;
  jobsCompleted: number;
  averageCompletionTime: number;
  customerRating: number;
  period: string;
}

// ============================================
// HELPER TYPES
// ============================================

export interface PaginationParams {
  limit: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: "asc" | "desc";
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
