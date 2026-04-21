import { Timestamp } from "firebase/firestore";

// ============================================
// USER TYPES
// ============================================

export type UserRole = "admin" | "technician" | "client" | "contractor" | "auditor";

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

export type JobDivision = "service" | "distribution";

export type JobType =
  | "standard_service"
  | "APEAX_DISTRIBUTION_ORDER";

export type JobLifecycleStage = "rfq" | "job_scheduled" | "job_live" | "job_completed" | "management_closeoff";

export type BookingType =
  | "windscreen_crack_chip_repair"
  | "scratch_graffiti_removal"
  | "film_installation"
  | "trim_restoration_interior"
  | "trim_restoration_exterior"
  | "polymer_lens_restoration"
  | "glass_replacement";

export type ResourceDurationTemplate = "na" | "short" | "medium" | "long";

export const RESOURCE_DURATION_LABELS: Record<ResourceDurationTemplate, string> = {
  na: "N/A (1 hour window)",
  short: "Short (1 day)",
  medium: "Medium (3 days)",
  long: "Long (5 days)",
};

export const BOOKING_TYPE_LABELS: Record<BookingType, string> = {
  windscreen_crack_chip_repair: "Windscreen Crack/Chip Repair",
  scratch_graffiti_removal: "Scratch/Graffiti Removal",
  film_installation: "Film Installation",
  trim_restoration_interior: "Trim Restoration (Interior)",
  trim_restoration_exterior: "Trim Restoration (Exterior)",
  polymer_lens_restoration: "Polymer Lens Restoration",
  glass_replacement: "Glass Replacement",
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
  // Other consumables used
  consumablesUsed?: ConsumableUsage[];
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
  filmProduct?: "optishield" | "grafshield" | "bodyshield" | "radshield";
  tintRemovalRequired?: boolean;
  substrateQaPassed?: boolean;
  remediationType?: "scratch_removal" | "decontamination" | "prep_polish" | "none";
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

export interface ConsumableUsage {
  item: string;
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

// Helper function to calculate cost breakdown.
// Glass replacement uses 30:70 labour/materials (materials-heavy).
// All other repair types use 70:30 labour/materials (labour-heavy).
export function calculateCostBreakdown(totalCost: number, repairType?: string): { labourCost: number; materialsCost: number } {
  if (repairType === "glass_replacement") {
    return {
      labourCost: Math.round(totalCost * 0.30 * 100) / 100,
      materialsCost: Math.round(totalCost * 0.70 * 100) / 100,
    };
  }
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
  // Optional booking-level vehicle details (legacy/fallback)
  vehicles?: Vehicle[];
  resourceDurationTemplate?: ResourceDurationTemplate;
  resourceDurationOverrideDays?: number;
  resourceDurationOverrideHours?: number;
  finishDate?: Timestamp;
  finishTime?: string;
  eotCheck?: {
    status: "pending" | "not_required" | "requested";
    promptedAt?: Timestamp;
    decidedAt?: Timestamp;
    decidedBy?: string;
    note?: string;
  };
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
  // SHIELD / Distribution
  division?: JobDivision; // "service" (default) or "distribution" (APEAX orders)
  jobType?: JobType;
  // ISO traceability touchpoints populated as the job progresses through lifecycle
  isoClauseTouchpoints?: string[];
  sourceSystem?: string; // e.g. "apeax_portal" for SHIELD orders
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
  riskAssessment?: JobRiskAssessment;
  replacementCostAvoided?: number;
}

export type RiskAssessmentRiskLevel = "low" | "medium" | "high" | "critical";

export interface JobRiskAssessmentHazard {
  id: string;
  label: string;
  present: boolean;
  riskLevel: RiskAssessmentRiskLevel;
  residualRiskLevel?: RiskAssessmentRiskLevel;
  initialLikelihood?: number;
  initialConsequence?: number;
  residualLikelihood?: number;
  residualConsequence?: number;
  exposureNotes?: string;
  controls: string;
}

export interface JobRiskAssessment {
  completedAt?: Timestamp;
  completedBy?: {
    id: string;
    name: string;
  };
  coveredStaffIds?: string[];
  coveredStaffNames?: string[];
  siteConditions: {
    weather: string;
    lighting: "good" | "poor";
    accessClear: boolean;
    trafficControlInPlace: boolean;
    emergencyAccessClear: boolean;
  };
  ppe: {
    gloves: boolean;
    eyeProtection: boolean;
    hiVis: boolean;
    hearingProtection: boolean;
    respirator: boolean;
    hardHat: boolean;
    safetyBoots: boolean;
    other: string;
  };
  hazards: JobRiskAssessmentHazard[];
  additionalControls: string;
  supervisorNotified: boolean;
  stopWorkAuthorityConfirmed: boolean;
  notes: string;
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

export type InspectionStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "partially_converted"  // One or more vehicles converted, others still pending
  | "converted"
  | "rejected";

/**
 * Per-vehicle conversion lifecycle on an inspection report.
 *
 * "pending"   — default. Vehicle is on the inspection, client hasn't signed off yet,
 *               or has signed off but conversion hasn't happened. Carries an optional
 *               note (e.g. "client wants to do this one in 2 weeks when the bus
 *               returns from charter") so the reason lives on the record.
 * "converted" — vehicle has been converted into its own standalone Job. The
 *               `convertedJobId` field on the same VehicleReport holds the target.
 *               Inspection card persists — this vehicle just no longer produces
 *               new jobs.
 * "rejected"  — client declined this vehicle's work. Stays on the inspection
 *               card for audit trail but never converts.
 */
export type VehicleConversionStatus = "pending" | "converted" | "rejected";

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
  estimatedDowntimeHours?: number;
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
  // ── Per-vehicle conversion tracking ────────────────────────────────────────
  // Added 2026-04-10 so inspections can convert vehicle-by-vehicle instead of
  // all-or-nothing. Each vehicle carries its own lifecycle so a 3-vehicle
  // inspection can ship 1 job now, 1 in two weeks, 1 a month later, without
  // losing the inspection card. Legacy inspections (no conversionStatus set)
  // behave as "pending" for the whole vehicle.
  conversionStatus?: VehicleConversionStatus;
  convertedJobId?: string;
  convertedJobNumber?: string;
  convertedAt?: Timestamp;
  convertedBy?: string;
  conversionNote?: string;    // Free-text reason shown alongside the status (e.g. "owner on leave until 24 Apr, convert then")
}

export interface InspectionQuoteFile {
  fileName: string;
  storagePath: string;
  downloadUrl: string;
  contentType: "application/pdf";
  size: number;
}

export interface InspectionQuote {
  status?: "generated" | "sent";
  file?: InspectionQuoteFile;
  generatedAt?: Timestamp;
  generatedById?: string;
  generatedByName?: string;
  sentAt?: Timestamp;
  sentTo?: string;
  sentById?: string;
  sentByName?: string;
  note?: string;
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
  finishDate?: Timestamp;
  finishTime?: string;
  estimatedDowntime?: {
    value: number;
    unit: "hours" | "days";
  };
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
  quote?: InspectionQuote;
  /**
   * Legacy: single job ID from the old all-or-nothing conversion flow.
   * Kept for back-compat on existing inspections. New conversions (per-vehicle)
   * append to `convertedJobIds[]` instead. When the last remaining pending
   * vehicle converts on a multi-vehicle inspection, we also set this to the
   * most recent job ID so any legacy UI still finds something to point at.
   */
  convertedToJobId?: string;
  /**
   * Full audit trail of every job created from this inspection, one entry per
   * vehicle converted. Populated by the per-vehicle conversion flow.
   */
  convertedJobIds?: Array<{
    vehicleId: string;
    jobId: string;
    jobNumber: string;
    convertedAt: Timestamp;
    convertedBy: string;
  }>;
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
  xeroItemCode?: string;
  category?: string;
  itemType: StockItemType;
  quantityOnHand: number;
  reorderThreshold?: number;
  reorderQuantity?: number;
  costPrice?: number;
  unit?: string;
  notes?: string;
  lastReceivedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ============================================
// PURCHASE ORDERS (Xero-linked)
// ============================================

export type PurchaseOrderStatus = "DRAFT" | "AUTHORISED" | "SUBMITTED" | "BILLED" | "DELETED";

export interface PurchaseOrderLineItem {
  itemCode?: string;
  description: string;
  quantity: number;
  unitAmount: number;
  accountCode?: string;
  taxType?: string;
  stockItemId?: string;
}

export interface PurchaseOrder {
  id: string;
  xeroPurchaseOrderId?: string;
  purchaseOrderNumber?: string;
  supplierName: string;
  supplierId?: string;
  reference?: string;
  status: PurchaseOrderStatus;
  deliveryDate?: string;
  lineItems: PurchaseOrderLineItem[];
  subTotal?: number;
  totalTax?: number;
  total?: number;
  isAutoReorder?: boolean;
  goodsReceivedId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  sentAt?: Timestamp;
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

export type IMSAuditStatus = "scheduled" | "planned" | "in_progress" | "completed" | "cancelled";

export interface IMSAuditReport {
  id: string;
  metadata: {
    auditId: string;
    standard: "ISO9001:2015" | "ISO14001:2015" | "ISO45001:2018" | "Integrated";
    scope: string;
    period: string;
    sites: string[];
    processes: string[];
    leadAuditor: string;
    auditDate: string;           // Actual audit execution date (YYYY-MM-DD)
    plannedDate?: string;        // Originally scheduled date (may differ from auditDate if rescheduled)
    status: IMSAuditStatus;
    calendarEventId?: string;    // Google Calendar event ID if scheduled
    auditType?: "internal" | "external" | "supplier" | "management_review";
    scheduledBy?: string;        // Who scheduled it (Director, GUARDIAN, etc.)
    scheduledAt?: string;        // ISO timestamp when it was first scheduled
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

export type StreamType = "sales" | "supply_chain" | "trade_distribution";

export type SalesPipelineStage =
  | "identified"
  | "researched"
  | "qualified"
  | "outreach"
  | "engaged"
  | "discovery"
  | "proposal"
  | "negotiation"
  | "won"
  | "lost"
  | "nurture";

export type SupplyChainPipelineStage =
  | "identified"
  | "researched"
  | "qualified"
  | "outreach"
  | "engaged"
  | "evaluation"
  | "negotiation"
  | "agreement"
  | "onboarded"
  | "inactive"
  | "watchlist";

// Trade distribution pipeline — SHIELD / APEAX trade installer channel.
// Differs from both sales and supply chain because it involves installer
// vetting, GUARDIAN QA hold, APEAX USA PO placement, warranty registration,
// and an ongoing active-installer relationship with a distinct lifecycle.
export type TradeDistributionPipelineStage =
  | "identified"          // Lead discovered (application, outreach, referral)
  | "researched"          // Background check, business validation
  | "qualified"           // Meets trade installer criteria
  | "application_review"  // Application submitted, under SHIELD review
  | "vetting"             // GUARDIAN QA hold / compliance check
  | "agreement_sent"      // Trade agreement issued
  | "agreement_signed"    // Returned signed, contract live
  | "onboarded"           // Trained, initial orders placed, installer active
  | "first_order"         // First APEAX USA purchase order placed
  | "active"              // Ongoing trade client, warranty-registered installs
  | "paused"              // Temporarily inactive (seasonal, under review)
  | "terminated";         // Trade agreement ended

// Union of all pipeline stages (backwards-compatible)
export type PipelineStage =
  | SalesPipelineStage
  | SupplyChainPipelineStage
  | TradeDistributionPipelineStage;

export const SALES_STAGES: SalesPipelineStage[] = [
  "identified", "researched", "qualified", "outreach", "engaged",
  "discovery", "proposal", "negotiation", "won", "lost", "nurture",
];

export const SUPPLY_CHAIN_STAGES: SupplyChainPipelineStage[] = [
  "identified", "researched", "qualified", "outreach", "engaged",
  "evaluation", "negotiation", "agreement", "onboarded", "inactive", "watchlist",
];

export const TRADE_DISTRIBUTION_STAGES: TradeDistributionPipelineStage[] = [
  "identified", "researched", "qualified", "application_review", "vetting",
  "agreement_sent", "agreement_signed", "onboarded", "first_order", "active",
  "paused", "terminated",
];

export const SALES_STAGE_LABELS: Record<SalesPipelineStage, string> = {
  identified: "Identified", researched: "Researched", qualified: "Qualified",
  outreach: "Outreach", engaged: "Engaged", discovery: "Discovery",
  proposal: "Proposal", negotiation: "Negotiation", won: "Won", lost: "Lost", nurture: "Nurture",
};

export const SUPPLY_CHAIN_STAGE_LABELS: Record<SupplyChainPipelineStage, string> = {
  identified: "Identified", researched: "Researched", qualified: "Qualified",
  outreach: "Outreach", engaged: "Engaged", evaluation: "Evaluation",
  negotiation: "Negotiation", agreement: "Agreement", onboarded: "Onboarded",
  inactive: "Inactive", watchlist: "Watchlist",
};

export const TRADE_DISTRIBUTION_STAGE_LABELS: Record<TradeDistributionPipelineStage, string> = {
  identified: "Identified",
  researched: "Researched",
  qualified: "Qualified",
  application_review: "Application Review",
  vetting: "Vetting (QA Hold)",
  agreement_sent: "Agreement Sent",
  agreement_signed: "Agreement Signed",
  onboarded: "Onboarded",
  first_order: "First Order",
  active: "Active Installer",
  paused: "Paused",
  terminated: "Terminated",
};

export const SALES_STAGE_COLORS: Record<SalesPipelineStage, string> = {
  identified: "zinc", researched: "violet", qualified: "teal", outreach: "blue",
  engaged: "cyan", discovery: "indigo", proposal: "amber", negotiation: "orange",
  won: "green", lost: "red", nurture: "purple",
};

export const SUPPLY_CHAIN_STAGE_COLORS: Record<SupplyChainPipelineStage, string> = {
  identified: "zinc", researched: "violet", qualified: "teal", outreach: "blue",
  engaged: "cyan", evaluation: "indigo", negotiation: "orange", agreement: "amber",
  onboarded: "green", inactive: "red", watchlist: "purple",
};

export const TRADE_DISTRIBUTION_STAGE_COLORS: Record<TradeDistributionPipelineStage, string> = {
  identified: "zinc",
  researched: "violet",
  qualified: "teal",
  application_review: "blue",
  vetting: "amber",
  agreement_sent: "cyan",
  agreement_signed: "indigo",
  onboarded: "fuchsia",
  first_order: "purple",
  active: "green",
  paused: "orange",
  terminated: "red",
};

export type LeadSector =
  // Heavy vehicle / fleet (SENTINEL's market)
  | "mass-transit"          // Bus, coach, rail operators
  | "manufacturing"          // Industrial / commercial manufacturing
  | "wholesale-trade"        // B2B wholesale distribution
  | "structural"             // Structural glass / large format
  | "marine"                 // Marine / maritime
  // Passenger / trade (MERCER's market)
  | "passenger_trade"        // Generic passenger vehicle / trade (catch-all for MERCER)
  | "dealership"             // New / used car dealerships (BMW, LSH, etc.)
  | "panel_beater"           // Panel / body repair shops (Eurohub-type)
  | "trade_workshop"         // Independent trade workshops (Millennium Auto-type)
  | "detailing"              // Auto detailing / protection specialists
  // Other
  | "other";

export type LeadGrade = "A" | "B" | "C" | "D" | "E";

export type LeadSourceType =
  | "osint"
  | "referral"
  | "inbound"
  | "manual"
  | "linkedin"
  | "event"
  | "tender";

export type OutreachEventType =
  | "linkedin_connect"
  | "linkedin_message"
  | "email"
  | "phone"
  | "meeting"
  | "proposal"
  | "follow_up";

export interface LeadContact {
  id: string;
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  linkedInUrl?: string;
  isPrimary: boolean;
  notes?: string;
}

export interface LeadSource {
  type: LeadSourceType;
  osintScanDate?: string;
  osintFinding?: string;
  osintPillar?: string;
  osintRelevanceScore?: number;
  referralSource?: string;
  tenderReference?: string;
  detail?: string;
}

export interface StageChange {
  fromStage: PipelineStage;
  toStage: PipelineStage;
  changedAt: string;
  changedBy: string;
  reason?: string;
}

export interface OutreachStatus {
  linkedInConnected: boolean;
  linkedInMessageSent: boolean;
  emailsSent: number;
  lastContactDate?: string;
  lastResponseDate?: string;
  responseReceived: boolean;
  meetingScheduled: boolean;
}

export interface OutreachEvent {
  id: string;
  type: OutreachEventType;
  date: string;
  subject?: string;
  summary: string;
  response?: string;
  nextStep?: string;
  loggedBy?: string;
}

export interface AgentActionLogEntry {
  agent: string;
  action: string;
  timestamp: string;
  details: string;
  stageTransition?: { from: PipelineStage; to: PipelineStage };
}

/**
 * Market segment for sales-stream leads. Allows the sales stream to be
 * sub-divided between SENTINEL (heavy vehicle / fleet / bus & coach) and
 * MERCER (passenger vehicle / trade). Ignored for non-sales streams.
 *
 * - heavy_vehicle → SENTINEL (David Sentinel) — HV/Bus/Coach/Fleet
 * - light_vehicle → MERCER (Emily Mercer) — Passenger vehicles
 * - trade → MERCER — Trade sales
 */
export type LeadMarketSegment = "heavy_vehicle" | "light_vehicle" | "trade";

/**
 * Supplier classification for supply_chain stream leads. Only used when
 * streamType === "supply_chain". VANGUARD uses this to manage the supply
 * ecosystem across primary/backup sourcing, strategic partnerships, R&D
 * collaborators, distribution channels and transactional vendors.
 */
export type LeadSupplierType =
  | "tier_1"             // Primary supplier, critical dependency
  | "tier_2"             // Backup / second-source
  | "strategic_partner"  // Long-term partnership, joint roadmap
  | "research_partner"   // R&D collaboration (CSIRO, universities, APEAX R&D)
  | "distributor"        // Wholesale / reseller channel partner
  | "vendor";            // Transactional, non-strategic (consumables, tools)

export interface Lead {
  id: string;
  leadNumber: string;                // e.g. "LD-2026-0001"

  // Stream
  streamType: StreamType;            // "sales" | "supply_chain" | "trade_distribution"

  // Market segment (sales stream only — used to route leads between
  // SENTINEL and MERCER). Other streams ignore this field.
  marketSegment?: LeadMarketSegment;

  // Supplier type (supply_chain stream only — classifies VANGUARD's
  // supplier ecosystem). Other streams ignore this field.
  supplierType?: LeadSupplierType;

  // Company
  companyName: string;
  companyWebsite?: string;
  companyLinkedIn?: string;
  sector: LeadSector;
  companySize?: "enterprise" | "mid-market" | "smb";

  // Link to existing org
  existingOrganizationId?: string;
  isExistingClient: boolean;

  // Contacts
  contacts: LeadContact[];
  primaryContactId?: string;

  // BANT qualification
  bantScore: number;                 // 0-100
  bantBreakdown: {
    budget: number;                  // 0-20
    authority: number;               // 0-20
    need: number;                    // 0-25
    timing: number;                  // 0-20
    fit: number;                     // 0-15
  };
  leadGrade: LeadGrade;

  // Pipeline
  stage: PipelineStage;
  stageHistory: StageChange[];
  stageEnteredAt?: string;           // ISO date when current stage was entered

  // Source
  source: LeadSource;

  // Opportunity details
  estimatedValue?: number;
  estimatedServices: string[];
  painPoints: string[];
  asiSolutionFit: string[];

  // Outreach
  outreachSequence: "A" | "B" | "C" | null;
  outreachStatus: OutreachStatus;
  outreachHistory: OutreachEvent[];

  // OSINT hooks — SENTINEL/MERCER/SHIELD daily outreach gates on these.
  // Populated by ATHENA at lead creation or post-hoc via update_lead.
  osintHook?: string | null;
  osintHookShort?: string | null;

  // Context
  marketMode: "growth" | "downturn" | "neutral";
  nextActionDate?: string;
  nextAction?: string;
  lostReason?: string;
  notes: string;
  tags: string[];

  // Agent automation
  assignedAgent?: string;
  agentStatus?: "processing" | "waiting" | "escalated" | "completed";
  agentLastAction?: Timestamp;
  agentActionLog?: AgentActionLogEntry[];
  escalationReason?: string;
  humanReviewRequired?: boolean;

  // Meta
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  createdByName?: string;
  isDeleted?: boolean;
}

export interface Opportunity {
  id: string;
  leadId: string;
  organizationId: string;
  estimatedAnnualValue: number;
  services: string[];
  contractType: "one-off" | "recurring" | "retainer" | "tender";
  contractDuration?: string;
  wonDate: string;
  wonReason?: string;
  convertedJobIds: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

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

// ============================================
// CONTACT ORGANIZATIONS
// ============================================

export type ContactCategory =
  | "trade_client"
  | "retail_client"
  | "supplier_vendor"
  | "subcontractor"
  | "asi_staff";

export const CONTACT_CATEGORY_LABELS: Record<ContactCategory, string> = {
  trade_client: "Trade Client",
  retail_client: "Retail Client",
  supplier_vendor: "Supplier/Vendor",
  subcontractor: "Subcontractor",
  asi_staff: "ASI Staff",
};

export const CLIENT_CONTACT_CATEGORIES: ContactCategory[] = ["trade_client", "retail_client"];

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

export type TradeDiscountBand = "A" | "B" | "C";

export interface TradeAccount {
  sectorDeclaration?: string;
  exclusivityDisclosureText?: string;
  exclusivityDisclosureDate?: string;
  tradeDiscountBand: TradeDiscountBand;
  approvedAt?: string;
  approvedBy?: string;
  vettingLockoutUntil?: string | null;
  credentials?: string;
  approvalNotes?: string | null;
  isActive?: boolean;
  paymentTerms?: string;
  creditLimit?: number;
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
  accountsEmail?: string; // Accounts department email — included on all invoices alongside the job contact
  website?: string;
  parentOrganizationId?: string;
  subsidiaryType?: "parent" | "subsidiary";
  // APEAX Distribution (SHIELD)
  isApeaxTradeInstaller?: boolean;
  tradeAccount?: TradeAccount;
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

export type FilmProductType = "optishield" | "grafshield" | "paintshield" | "radshield" | "clearshield";

export type FilmAssetType = "windscreen" | "side_glass" | "rear_glass" | "destination_panel" | "headlight_lens" | "body_panel" | "other";

export type FilmLifecycleStatus =
  | "installed"
  | "warranty_registration_overdue"
  | "year_1_service_due"
  | "year_1_serviced"
  | "year_1_serviced_monitor"
  | "year_2_service_due"
  | "year_2_serviced"
  | "year_2_serviced_monitor"
  | "year_3_service_due"
  | "year_3_serviced"
  | "year_3_serviced_monitor"
  | "replacement_due"
  | "replaced"
  | "warranty_claim_pending"
  | "warranty_claim_submitted"
  | "claim_approved"
  | "claim_rejected"
  | "replacement_under_warranty"
  | "removed_early";

export type FilmWarrantyRegistrationStatus = "pending" | "overdue" | "submitted" | "confirmed" | "rejected" | "expired" | "not_applicable";

export type FilmClaimType = "defect" | "premature_failure" | "delamination" | "discolouration" | "adhesive_failure" | "optical_distortion" | "other";

export type FilmClaimStatus = "draft" | "submitted_to_apeax" | "under_review" | "approved" | "rejected" | "resolved";

export type FilmInspectionType = "year_1_inspection" | "year_2_inspection" | "year_3_inspection" | "ad_hoc_inspection" | "pre_replacement";

export type FilmInspectionResult = "pass" | "conditional_pass" | "fail";

export type FilmQaCriterionResult = "pass" | "fail" | "monitor";

export type FilmHealthStatus = "healthy" | "monitor" | "at_risk" | "failed" | "expired";

export interface FilmWarrantyRegistration {
  status: FilmWarrantyRegistrationStatus;
  registeredDate?: string;
  registrationDeadline: string;
  apeaxRegistrationRef?: string;
  registrationMethod?: "email" | "online_form" | "api";
  registrationEmailDraftId?: string;
  notes?: string;
}

export interface FilmWarrantyClaim {
  claimId: string;
  claimNumber: string;
  claimDate: string;
  claimType: FilmClaimType;
  description: string;
  severity: "minor" | "major" | "critical";
  evidencePhotos?: { url: string; caption: string; uploadedAt: string }[];
  claimStatus: FilmClaimStatus;
  apeaxClaimRef?: string;
  submittedToApeaxDate?: string;
  apeaxResponseDate?: string;
  resolution?: string;
  resolutionDate?: string;
  replacementInstallationId?: string;
  creditAmount?: number;
  notes?: string;
}

export interface FilmServiceHistoryEntry {
  serviceId: string;
  serviceType: FilmInspectionType | "replacement";
  serviceDate: string;
  performedBy: string;
  result: FilmInspectionResult;
  hydroguardApplied: boolean;
  notes?: string;
}

export interface FilmInstallation {
  id: string;
  installationNumber: string;
  filmType: FilmProductType;
  filmProduct: string;
  filmGrade?: string;
  batchNumber?: string;
  rollNumber?: string;
  clientId: string;
  clientName: string;
  assetId?: string;
  assetIdentifier: string;
  assetType: FilmAssetType;
  assetDescription?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleYear?: number;
  installedDate: string;
  installedBy: string;
  installedByTechId?: string;
  installationJobId?: string;
  installationJobNumber?: string;
  siteLocation?: { name: string; address: string };
  warrantyStartDate: string;
  warrantyEndDate: string;
  expectedReplacementDate: string;
  lifecycleStatus: FilmLifecycleStatus;
  warrantyRegistration: FilmWarrantyRegistration;
  warrantyClaims: FilmWarrantyClaim[];
  serviceHistory: FilmServiceHistoryEntry[];
  replacedByInstallationId?: string;
  replacementReason?: "end_of_life" | "warranty_claim" | "damage" | "customer_request";
  replacementDate?: string;
  status: "active" | "archived";
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  notes?: string;
}

export interface FilmQaCriterion {
  result: FilmQaCriterionResult;
  details?: string;
  location?: string;
  photoUrls?: string[];
}

export interface FilmVisualInspection {
  filmAdhesion: FilmQaCriterion;
  edgeLift: FilmQaCriterion & { liftMeasurementMm?: number };
  bubbling: FilmQaCriterion & { bubbleCount?: number; bubbleSizeMm?: number };
  delamination: FilmQaCriterion & { delaminationAreaMm2?: number };
  opticalClarity: FilmQaCriterion & { distortionObserved?: boolean; hazeLevel?: "none" | "slight" | "moderate" | "severe" };
  discolouration: FilmQaCriterion & { discolourationArea?: string; colourChange?: string };
  scratches: FilmQaCriterion & { scratchSeverity?: "light" | "moderate" | "deep"; driverLineOfSight?: boolean };
  pitting: FilmQaCriterion & { pittingDensity?: "isolated" | "scattered" | "widespread" };
  staining: FilmQaCriterion & { stainType?: "water_spot" | "chemical" | "organic" | "unknown"; removable?: boolean };
  hydrophobicPerformance: FilmQaCriterion & { waterBeadingObserved?: boolean; waterSheetingObserved?: boolean };
  wiperCompatibility: FilmQaCriterion & { wiperChatter?: boolean; wiperDrag?: "normal" | "slight" | "excessive"; wiperArcDamage?: boolean };
  adasCompatibility?: FilmQaCriterion & { sensorObstructed?: boolean; cameraCalibrationNeeded?: boolean };
}

export interface FilmHydroguardService {
  applied: boolean;
  productUsed?: string;
  batchNumber?: string;
  applicationMethod?: "spray" | "wipe" | "machine";
  coatsApplied?: number;
  cureTimeMinutes?: number;
  surfacePrepped?: boolean;
  surfacePrepMethod?: string;
  notes?: string;
}

export interface FilmWarrantyInspection {
  id: string;
  inspectionNumber: string;
  filmInstallationId: string;
  installationNumber: string;
  jobId?: string;
  jobNumber?: string;
  clientId: string;
  clientName: string;
  assetIdentifier: string;
  assetType: string;
  inspectionType: FilmInspectionType;
  inspectionDate: string;
  inspectedBy: string;
  inspectedByTechId?: string;
  siteLocation?: { name: string; address: string };
  yearOfWarranty: number;
  filmAgeMonths: number;
  overallCondition: "excellent" | "good" | "fair" | "poor" | "failed";
  visualInspection?: FilmVisualInspection;
  hydroguardService?: FilmHydroguardService;
  overallResult: FilmInspectionResult;
  conditions?: { conditionType: string; reviewDate: string; severity: "low" | "medium" | "high" }[];
  failureAction?: "warranty_claim" | "replacement_recommended" | "customer_advised";
  warrantyClaimTriggered?: boolean;
  warrantyClaimId?: string;
  nextServiceDue?: string;
  nextServiceType?: "year_2_inspection" | "year_3_inspection" | "replacement";
  technicianSignOff?: { signed: boolean; signedAt?: string; signedBy?: string };
  customerSignOff?: { signed: boolean; signedAt?: string; signedBy?: string; customerComments?: string };
  reportGenerated?: boolean;
  reportUrl?: string;
  reportSentToClient?: boolean;
  reportSentDate?: string;
  uvTransmission?: {
    reading: number;
    meter: string;
    location: string;
    passThreshold?: number;
    result?: "pass" | "fail";
  };
  status: "draft" | "in_progress" | "completed" | "cancelled";
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
}

export interface FilmWarrantyRegister {
  id: string;
  filmInstallationId: string;
  installationNumber: string;
  clientId: string;
  clientName: string;
  assetIdentifier: string;
  filmType: string;
  installedDate: string;
  warrantyStartDate: string;
  warrantyEndDate: string;
  registrationStatus: FilmWarrantyRegistrationStatus;
  registrationDeadline: string;
  apeaxRegistrationRef?: string;
  year1ServiceDue: string;
  year1ServiceCompleted: boolean;
  year1ServiceDate?: string;
  year1ServiceResult?: string;
  year2ServiceDue: string;
  year2ServiceCompleted: boolean;
  year2ServiceDate?: string;
  year2ServiceResult?: string;
  year3ServiceDue: string;
  year3ServiceCompleted: boolean;
  year3ServiceDate?: string;
  year3ServiceResult?: string;
  replacementDue: string;
  replacementCompleted: boolean;
  replacementDate?: string;
  totalClaims: number;
  openClaims: number;
  currentHealth: FilmHealthStatus;
  lastInspectionDate?: string;
  lastInspectionResult?: string;
  updatedAt: Timestamp;
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
  relatedEntityType?: "job" | "inspection" | "lead" | "quote" | "ims_document";
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
// IMS INCIDENT MANAGEMENT (ISO 9001/14001/45001)
// ============================================

export type ImsIncidentCategory = "whs" | "environment" | "quality" | "property" | "security" | "other";
export type ImsIncidentType =
  | "injury"
  | "near_miss"
  | "hazard"
  | "unsafe_condition"
  | "spill"
  | "nonconformance"
  | "property_damage"
  | "other";
export type ImsIncidentSeverity = "low" | "medium" | "high" | "critical";
export type ImsIncidentStatus =
  | "draft"
  | "reported"
  | "investigating"
  | "actions_required"
  | "closed";

export type ImsRiskDomain = "quality" | "environment" | "whs";
export type ImsRiskRegisterEntryType = "risk" | "opportunity";
export type ImsRiskRegisterStatus = "open" | "in_progress" | "closed";

export interface ImsIncidentAttachment {
  name: string;
  path: string;
  url: string;
  contentType?: string;
  size?: number;
  uploadedAt: Timestamp;
  uploadedById: string;
  uploadedByName: string;
}

export interface ImsIncidentHazard {
  id: string;
  label: string;
  present: boolean;
  riskLevel: "low" | "medium" | "high";
  controls: string;
}

export interface ImsIncidentInvestigation {
  investigator?: {
    id: string;
    name: string;
    email?: string;
  };
  startedAt?: Timestamp;
  completedAt?: Timestamp;
  summary?: string;
  rootCause?: string;
  contributingFactors?: string;
  correctiveActions?: Array<{
    id: string;
    title: string;
    description: string;
    ownerId?: string;
    ownerName?: string;
    dueDate?: string;
    status: "open" | "in_progress" | "closed";
    closureNotes?: string;
    closedAt?: Timestamp;
    closedByName?: string;
  }>;
  verificationEvidence?: string;
  lessonsLearned?: string;
}

export interface ImsIncident {
  id: string;
  incidentNumber: string;
  category: ImsIncidentCategory;
  incidentType: ImsIncidentType;
  severity: ImsIncidentSeverity;
  status: ImsIncidentStatus;
  occurredAt: Timestamp;
  reportedAt: Timestamp;
  reportedById: string;
  reportedByName: string;
  reportedByEmail?: string;
  jobId?: string;
  jobNumber?: string;
  organizationId?: string;
  organizationName?: string;
  siteLocation?: {
    name: string;
    address: string;
  };
  description: string;
  immediateActions?: string;
  hazards?: ImsIncidentHazard[];
  attachments?: ImsIncidentAttachment[];
  investigation?: ImsIncidentInvestigation;
  closedAt?: Timestamp;
  closedById?: string;
  closedByName?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ImsRiskRegisterEntry {
  id: string;
  entryType: ImsRiskRegisterEntryType;
  domain: ImsRiskDomain;
  title: string;
  description?: string;
  riskLevel?: RiskAssessmentRiskLevel;
  present?: boolean;
  existingControls?: string;
  additionalControls?: string;
  owner?: {
    id: string;
    name: string;
    email?: string;
  };
  status: ImsRiskRegisterStatus;
  source: {
    type: "incident" | "job_risk_assessment" | "inspection" | "prestart" | "other";
    id: string;
    label?: string;
    url?: string;
  };
  linkedCorrectiveActionIds?: string[];
  lastReviewedAt?: Timestamp;
  createdAt: Timestamp;
  createdById: string;
  createdByName: string;
  updatedAt: Timestamp;
}

// ============================================
// MEETINGS MODULE
// ============================================

export type MeetingStatus = "draft" | "scheduled" | "in_progress" | "completed" | "cancelled";
export type MeetingType = "management_review" | "startup" | "whs_committee" | "department" | "project" | "incident_review" | "custom";

export interface MeetingAttendee {
  id: string;
  name: string;
  email?: string;
  role: "chair" | "attendee" | "observer" | "agent";
  attended: boolean;
  department?: string;
}

export interface AgendaItem {
  id: string;
  order: number;
  title: string;
  description?: string;
  presenter?: string;
  duration?: number;
  type: "discussion" | "decision" | "information" | "agent_report" | "action_review";
  agentDepartment?: string;
  notes?: string;
  status: "pending" | "in_progress" | "completed" | "skipped";
}

export interface MeetingDecision {
  id: string;
  agendaItemId?: string;
  description: string;
  decidedBy: string;
  rationale?: string;
  createdAt: Timestamp;
}

export interface AgentReportRef {
  department: string;
  reportId: string;
  reportType: "executive" | "department" | "vanguard";
  summary?: string;
  attachedAt: Timestamp;
}

export interface MeetingAction {
  id: string;
  meetingId: string;
  meetingNumber: string;
  agendaItemId?: string;
  title: string;
  description?: string;
  assignedTo: { id: string; name: string; email?: string };
  dueDate: Timestamp;
  status: "open" | "in_progress" | "completed" | "overdue" | "cancelled";
  priority: "low" | "medium" | "high" | "critical";
  completedAt?: Timestamp;
  completedBy?: string;
  closureNotes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Meeting {
  id: string;
  meetingNumber: string;
  title: string;
  meetingType: MeetingType;
  status: MeetingStatus;
  scheduledDate: Timestamp;
  scheduledDuration: number;
  location?: string;
  chair: { id: string; name: string; email: string };
  attendees: MeetingAttendee[];
  agendaItems: AgendaItem[];
  agentReports?: AgentReportRef[];
  decisions: MeetingDecision[];
  summary?: string;
  isoClause?: string;
  templateId?: string;
  attachments?: FileAttachment[];
  startedAt?: Timestamp;
  completedAt?: Timestamp;
  createdAt: Timestamp;
  createdBy: string;
  createdByName: string;
  updatedAt: Timestamp;
}

export interface MeetingTemplate {
  id: string;
  name: string;
  meetingType: MeetingType;
  defaultDuration: number;
  agendaTemplate: AgendaItem[];
  isoClause?: string;
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
}

// ============================================
// EXECUTIVE REPORTS
// ============================================

export interface ExecutiveReportKpi {
  label: string;
  value: number | string;
  trend?: "up" | "down" | "flat";
  target?: number | string;
}

export interface ExecutiveReport {
  id: string;
  weekEnding: string;
  generatedAt: string;
  report: {
    executiveSummary: string;
    operations: Record<string, unknown>;
    salesPipeline: Record<string, unknown>;
    accounts: Record<string, unknown>;
    intelligence: Record<string, unknown>;
    risks: Array<string | { title: string; severity: string; description: string; mitigation?: string }>;
    recommendations: Array<string | { title: string; description: string; priority: string; owner?: string }>;
    nextWeekPriorities: Array<string | { title: string; description: string }>;
    kpis: ExecutiveReportKpi[] | Record<string, unknown>;
  };
}

// ============================================
// KPI TRACEABILITY MODULE
// ============================================

export const DIESEL_CO2_FACTOR_KG_PER_LITRE = 2.68; // Australian NGA factor

export type FuelType = "diesel" | "petrol" | "lpg" | "cng" | "electric";

export interface FuelRecord {
  id: string;
  organizationId: string;
  organizationName: string;
  vehicleId?: string;
  vehicleRegistration: string;
  vehicleDescription?: string;
  fuelType: FuelType;
  baselineConsumptionLPer100km: number;
  baselinePeriodStart: string;
  baselinePeriodEnd: string;
  baselineSource?: "manual" | "telematics" | "fleet_report";
  postInstallConsumptionLPer100km?: number;
  postInstallPeriodStart?: string;
  postInstallPeriodEnd?: string;
  postInstallSource?: "manual" | "telematics" | "fleet_report";
  fuelDeltaLPer100km?: number;
  fuelDeltaPercent?: number;
  hvacLoadReductionKw?: number;
  estimatedKwhSaved?: number;
  fuelCostPerLitre?: number;
  estimatedCostSavingsPerYear?: number;
  annualDistanceKm?: number;
  filmInstallationId?: string;
  radshieldInstalled: boolean;
  installDate?: string;
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
}

export type ReportingPeriod = "monthly" | "quarterly" | "annual";

export interface EmissionsReport {
  id: string;
  organizationId: string;
  organizationName: string;
  subsidiaryIds?: string[];
  reportingPeriod: ReportingPeriod;
  periodStart: string;
  periodEnd: string;
  scope1: {
    dieselSavedLitres: number;
    co2AvoidedKg: number;
    co2AvoidedTonnes: number;
    calculationMethod: string;
  };
  waste: {
    glassAvoidedKg: number;
    filmDisposalsAvoidedKg: number;
    totalWasteAvoidedKg: number;
  };
  priorPeriodCo2Tonnes?: number;
  yoyChangePercent?: number;
  asrsExported?: boolean;
  asrsExportedAt?: string;
  asrsExportedBy?: string;
  status: "draft" | "reviewed" | "submitted";
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
}

export interface TelemetryReading {
  id: string;
  organizationId: string;
  organizationName?: string;
  vehicleId?: string;
  vehicleRegistration: string;
  readingDate: string;
  readingSource: "manual" | "telematics" | "obd2" | "canbus";
  compressor?: {
    dutyCyclePercent: number;
    runHoursTotal: number;
    runHoursThisPeriod?: number;
    tempDeltaCabin: number;
    refrigerantPressure?: number;
  };
  electrical?: {
    totalSystemLoadKw: number;
    alternatorReductionKw?: number;
    auxiliaryLoadKw?: number;
  };
  temperature?: {
    ambientTempC: number;
    cabinTempPreC: number;
    cabinTempPostC: number;
    deltaTempC: number;
    measurementMethod?: "thermocouple" | "infrared" | "obd2" | "manual";
  };
  componentLifecycle?: {
    compressorHoursTotal: number;
    estimatedLifeHours: number;
    remainingLifePercent: number;
    alertLevel?: "ok" | "warning" | "critical";
    nextServiceDue?: string;
  };
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
}

export type MaintenanceEventType = "respray" | "major_repair" | "panel_replacement" | "film_replacement" | "glass_replacement" | "other";

export interface MaintenanceEvent {
  id: string;
  organizationId: string;
  organizationName: string;
  vehicleId?: string;
  vehicleRegistration: string;
  eventDate: string;
  eventType: MaintenanceEventType;
  description: string;
  actualCost: number;
  replacementCostAvoided?: number;
  costSavings?: number;
  jobId?: string;
  jobNumber?: string;
  filmInstallationId?: string;
  performedBy?: string;
  notes?: string;
  attachments?: { name: string; url: string }[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
}

export interface ZebEnergyRecord {
  id: string;
  organizationId: string;
  organizationName: string;
  vehicleId?: string;
  vehicleRegistration: string;
  recordDate: string;
  batteryCapacityKwh: number;
  energyConsumedKwh: number;
  rangeAchievedKm: number;
  rangeRatedKm: number;
  rangeExtensionKm?: number;
  rangeExtensionPercent?: number;
  hvacEnergyKwh?: number;
  hvacReductionKwh?: number;
  ambientTempC?: number;
  solarLoadWm2?: number;
  routeType?: "urban" | "suburban" | "highway" | "mixed";
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
}

export type KpiSnapshotLevel = "vehicle" | "fleet" | "subsidiary" | "group";

export interface KpiSnapshot {
  id: string;
  level: KpiSnapshotLevel;
  organizationId: string;
  organizationName: string;
  periodStart: string;
  periodEnd: string;
  totalFuelSavedLitres: number;
  totalKwhSaved: number;
  totalCostSavingsAud: number;
  costPerBusPerYear?: number;
  costPerFleetPerYear?: number;
  co2AvoidedTonnes: number;
  wasteAvoidedKg: number;
  avgDutyCycleReductionPercent?: number;
  avgTempDeltaC?: number;
  totalReplacementCostAvoided?: number;
  maintenanceEventsCount?: number;
  avgRangeExtensionPercent?: number;
  totalHvacEnergySavedKwh?: number;
  vehicleCount: number;
  vehicleIds?: string[];
  generatedAt: Timestamp;
  generatedBy: string;
}

// ============================================
// CLIENT SATISFACTION (ISO 9001)
// ============================================

export interface SatisfactionSurvey {
  id: string;
  organizationId: string;
  organizationName: string;
  jobId?: string;
  jobNumber?: string;
  submittedBy: string;
  submittedByName: string;
  submittedAt: Timestamp;
  overallSatisfaction: number; // 1-5
  serviceQuality: number; // 1-5
  communication: number; // 1-5
  timeliness: number; // 1-5
  valueForMoney: number; // 1-5
  wouldRecommend: boolean;
  comments?: string;
  risks?: string[];
  opportunities?: string[];
  athenaGenerated?: boolean; // true if Athena captured this dynamically
  createdAt: Timestamp;
  updatedAt: Timestamp;
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

// ============================================
// LEADS REGISTER (Pre-Pipeline Qualification)
// ============================================

export type LeadsRegisterStatus =
  | "identified"
  | "assessed"
  | "shortlisted"
  | "promoted"
  | "parked"
  | "rejected";

export type LeadsRegisterSourceType =
  | "osint"
  | "inbound"
  | "manual"
  | "referral"
  | "apeax_portal_quote"
  | "apeax_portal_trade_app";

export type LeadsRegisterSector =
  | "mass-transit"
  | "manufacturing"
  | "wholesale-trade"
  | "structural"
  | "marine"
  | "technology"
  | "other";

export type LeadsRegisterOpportunityCategory =
  | "technology"
  | "supplier"
  | "partner"
  | "distributor"
  | "customer"
  | "innovation"
  | "grant"
  | "other";

export type RoeGrade = "A" | "B" | "C" | "D" | "E";

export type StockdaleVerdict = "pursue" | "park" | "watch" | "reject";

export type LeadsRegisterAgent = "vanguard" | "sentinel" | "athena" | "director" | "osint-auto";

export interface LeadsRegisterSource {
  type: LeadsRegisterSourceType;
  scanDate?: string;
  scanId?: string;
  findingId?: string;
  notes?: string;
}

export interface LeadsRegisterCompany {
  name: string;
  website?: string;
  sector: LeadsRegisterSector;
  description?: string;
  location?: string;
  size?: string;
}

export interface LeadsRegisterContact {
  name?: string;
  role?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
}

export interface LeadsRegisterOpportunity {
  description?: string;
  category: LeadsRegisterOpportunityCategory;
  potentialValue?: number;
  potentialValueNotes?: string;
  urgencyFlag?: boolean;
  urgencyReason?: string;
}

export interface RoeScore {
  strategicFit: number;     // 0-25
  effortEstimate: number;   // 0-20
  revenueImpact: number;    // 0-25
  conversionProbability: number; // 0-15
  resourceRisk: number;     // 0-15
  total: number;            // 0-100
  grade: RoeGrade;
  assessedBy: LeadsRegisterAgent;
  assessedAt: string;
}

export interface StockdaleAssessment {
  resourceAvailability: "available" | "stretched" | "committed";
  gunpowderCheck?: string;
  growthRisk?: string;
  flywheelImpact?: string;
  verdict: StockdaleVerdict;
  assessedAt: string;
}

export interface WeeklyDecision {
  weekEnding: string;
  decision: "promote" | "park" | "reject" | "defer";
  reasoning: string;
  decidedBy: LeadsRegisterAgent;
}

export interface LeadsRegisterEntry {
  id: string;
  streamType: StreamType;
  status: LeadsRegisterStatus;

  source: LeadsRegisterSource;
  company: LeadsRegisterCompany;
  contact: LeadsRegisterContact;
  opportunity: LeadsRegisterOpportunity;

  roeScore?: RoeScore;
  stockdaleAssessment?: StockdaleAssessment;

  promotedToPipeline: boolean;
  promotedDate?: string;
  pipelineLeadId?: string;

  weeklyDecision?: WeeklyDecision;

  notes?: string;
  tags: string[];

  // OSINT outreach hooks — daily outreach cycle (SENTINEL/MERCER/SHIELD)
  // gates on these. Populated by ATHENA post-hoc via update_leads_register_entry.
  osintHook?: string | null;
  osintHookShort?: string | null;

  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: LeadsRegisterAgent;
}

// ============================================
// EMAIL TEMPLATES
// ============================================

export type EmailTemplateAgent = "athena" | "vanguard" | "sentinel";

export type EmailTemplateCategory =
  | "outreach"
  | "follow-up"
  | "response"
  | "scheduling"
  | "acknowledgement"
  | "info-request";

export type EmailTemplateAuthLevel = "auto-send" | "draft-for-review";

export type EmailTemplateStatus = "active" | "draft" | "archived";

export interface EmailTemplateSequence {
  sequenceId: string;
  touchNumber: number;
  dayOffset: number;
}

export interface EmailTemplate {
  id: string;
  agent: EmailTemplateAgent;
  category: EmailTemplateCategory;
  name: string;
  description?: string;
  subject: string;
  bodyHtml: string;
  variables: string[];
  sequence?: EmailTemplateSequence | null;
  authLevel: EmailTemplateAuthLevel;
  status: EmailTemplateStatus;
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  approvedBy?: string;
  approvedAt?: Timestamp;
}

// ============================================
// R&D & GRANTS MANAGEMENT (SOPHIE ARCHER / ARCHER)
// ============================================
//
// Three linked collections drive Sophie's domain:
//   1. rndProjects          — the R&D project register
//   2. grantApplications    — the grants pipeline (pursued grants)
//   3. rndOpportunityLog    — signals dropped by other agents for Sophie to review
//
// Approval chain for projects and grants: Archer designs the proposal,
// ATHENA reviews, Director (Josh) gives final go/no-go. Same two-gate
// chain is used for any budget sign-off.

export type RndProjectPhase =
  | "scoping"
  | "feasibility"
  | "design"
  | "prototype"
  | "pilot"
  | "validation"
  | "production"
  | "on_hold"
  | "archived";

export type RndProjectStatus = "active" | "on_hold" | "completed" | "cancelled";

export type RndProjectPriority = "low" | "medium" | "high" | "critical";

export type RndProjectDomain =
  | "product"       // Net-new product R&D (e.g. a new film formulation)
  | "process"       // Operational process improvement (e.g. installation method)
  | "platform"      // Software / portal / data platform work
  | "capability"    // Organisational capability (team skills, infrastructure)
  | "research";     // Pure research / horizon-scanning without immediate deliverable

export interface RndProjectFundingSource {
  sourceType: "self_funded" | "grant" | "partner" | "client";
  reference?: string;  // Grant application ID, partner name, client reference
  amount: number;
  notes?: string;
}

export interface RndProjectKpi {
  name: string;
  target: string;
  currentValue?: string;
  unit?: string;
}

export interface RndProjectRisk {
  risk: string;
  severity: "low" | "medium" | "high" | "critical";
  mitigation: string;
  owner?: string;
}

export interface RndProjectApproval {
  decision: "pending" | "approved" | "rejected";
  approver: "ATHENA" | "DIRECTOR";
  decidedAt?: Timestamp;
  decidedBy?: string;
  note?: string;
}

export interface RndProjectSourceRef {
  type:
    | "opportunity_log"
    | "grant_opportunity"
    | "director_mandate"
    | "management_meeting"
    | "reactive"
    | "gap_analysis";
  reference?: string;
  note?: string;
}

export interface RndProjectStatusLogEntry {
  phase?: RndProjectPhase;
  status?: RndProjectStatus;
  changedAt: Timestamp;
  changedBy: string;
  note?: string;
}

export interface RndProject {
  id: string;
  projectNumber: string;           // Auto-generated e.g. "RND-2026-0001"
  title: string;
  shortDescription: string;

  // Lifecycle
  phase: RndProjectPhase;
  status: RndProjectStatus;
  priority: RndProjectPriority;

  // Ownership & stakeholders
  leadAgent: string;               // Default "ARCHER"
  sponsorAgent?: string;
  stakeholders?: string[];

  // Classification
  domain: RndProjectDomain;
  relatedProducts?: string[];      // e.g. ["grafshield", "optishield"]
  modernisationPath?: string;

  // Budget & funding
  estimatedBudget?: number;
  actualSpendToDate?: number;
  fundingSources?: RndProjectFundingSource[];

  // Approval (Archer designs → ATHENA → Director)
  approvals?: {
    athena?: RndProjectApproval;
    director?: RndProjectApproval;
  };
  requiresDirectorApproval?: boolean; // True if budget > $50k or high-risk

  // Timeline
  startedAt?: Timestamp;
  targetCompletionDate?: string;   // ISO
  actualCompletionDate?: Timestamp;

  // IMS linkage (manual only — created via GUARDIAN's normal doc control flow)
  imsDocumentIds?: string[];
  imsComplianceStatus?: "compliant" | "non_conformance" | "pending_audit";
  lastGuardianAuditAt?: Timestamp;

  // Outputs
  deliverables?: string[];
  kpis?: RndProjectKpi[];
  risks?: RndProjectRisk[];

  // Source
  sourcedFrom?: RndProjectSourceRef;

  // Audit
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
  statusLog: RndProjectStatusLogEntry[];

  notes?: string;
}

// ─── Grants Pipeline ─────────────────────────────────────────────────────

export type GrantApplicationStage =
  | "monitoring"        // Aware of programme, watching for open rounds
  | "scoping"           // Assessing fit and requirements
  | "drafting"          // Writing the application
  | "internal_review"   // ATHENA / Director review pending
  | "submitted"         // Lodged with grantor
  | "under_review"      // Grantor is reviewing
  | "interview_stage"   // Grantor requested additional info/meeting
  | "approved"          // Awarded
  | "rejected"          // Declined
  | "withdrawn"         // We pulled it
  | "acquitted";        // All compliance obligations met, case closed

export type GrantFundingType =
  | "grant"
  | "tax_offset"
  | "rebate"
  | "loan"
  | "equity_match";

export interface GrantRequirement {
  requirement: string;
  status: "pending" | "in_progress" | "complete" | "blocked";
  dueDate?: string;
  notes?: string;
}

export interface GrantApproval {
  decision: "pending" | "approved" | "rejected";
  approver: "ATHENA" | "DIRECTOR";
  decidedAt?: Timestamp;
  decidedBy?: string;
  note?: string;
}

export interface GrantComplianceReport {
  reportType: string;
  dueDate: string;
  status: "pending" | "submitted" | "accepted" | "overdue";
  submittedAt?: Timestamp;
  notes?: string;
}

export interface GrantComplianceMilestone {
  milestone: string;
  dueDate: string;
  status: "pending" | "achieved" | "missed";
  achievedAt?: Timestamp;
  notes?: string;
}

export interface GrantStatusLogEntry {
  stage: GrantApplicationStage;
  changedAt: Timestamp;
  changedBy: string;
  note?: string;
}

export interface GrantApplication {
  id: string;
  grantNumber: string;              // Auto-generated e.g. "GRT-2026-0001"

  // Programme details
  programmeName: string;            // "R&D Tax Incentive (RDTI)"
  programmeBody: string;            // "AusIndustry", "Vic Gov", etc.
  programmeUrl?: string;
  roundName?: string;

  // Pipeline stage
  stage: GrantApplicationStage;

  // Financial
  fundingType: GrantFundingType;
  awardValue?: number;              // Potential or estimated
  awardedAmount?: number;           // Actual once approved

  // Linked R&D work
  linkedRndProjectIds?: string[];

  // Application workflow
  requirements?: GrantRequirement[];

  // Key dates
  roundOpensAt?: string;            // ISO
  submissionDeadline?: string;      // Hard deadline
  expectedDecisionDate?: string;
  submittedAt?: Timestamp;
  decisionReceivedAt?: Timestamp;
  acquittalDueDate?: string;

  // Internal approval (Archer proposes → ATHENA review → Director final)
  internalApprovals?: {
    athena?: GrantApproval;
    director?: GrantApproval;
  };

  // Documents (manual links into GUARDIAN's doc control)
  draftDocumentIds?: string[];
  submittedDocumentIds?: string[];

  // Post-award compliance obligations
  compliance?: {
    reportsRequired?: GrantComplianceReport[];
    milestonesRequired?: GrantComplianceMilestone[];
  };

  // Audit
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
  statusLog: GrantStatusLogEntry[];

  notes?: string;
}

// ─── R&D Opportunity Log ─────────────────────────────────────────────────

export type RndOpportunityType =
  | "client_pattern"      // SENTINEL signal: "seeing a pattern across clients"
  | "supplier_innovation" // VANGUARD signal: "supplier doing X we could leverage"
  | "market_gap"          // "competitors doing X, we're not"
  | "technology_signal"   // "emerging tech we should track"
  | "regulatory_change"   // "new regulation creates R&D opportunity"
  | "internal_gap";       // "capability gap we should close"

export type RndOpportunityStatus =
  | "new"
  | "under_review"
  | "accepted"   // Worth pursuing — typically graduates to converted
  | "parked"     // Interesting but not now
  | "rejected"   // Not a fit
  | "converted"; // Became an R&D project

export interface RndOpportunitySourceReference {
  type: "lead" | "osint_scan" | "meeting" | "audit_finding" | "external_report" | "other";
  id?: string;
  note?: string;
}

export interface RndOpportunityScore {
  strategicFit: number;         // 0-10
  technicalFeasibility: number; // 0-10
  fundingPotential: number;     // 0-10 (is there a grant that could fund this?)
  impactSize: number;           // 0-10
  overall: number;              // Computed or overridden
  reviewedAt: Timestamp;
  reviewedBy: string;
  reviewNotes?: string;
}

export interface RndOpportunity {
  id: string;
  opportunityNumber: string;    // Auto-generated e.g. "OPP-2026-0001"

  // What was spotted
  title: string;
  description: string;
  type: RndOpportunityType;

  // Origin
  sourcedBy: string;            // Agent codename: "SENTINEL", "VANGUARD" etc.
  sourceContext?: string;       // e.g. "Weekly management meeting 2026-04-16"
  sourceReferences?: RndOpportunitySourceReference[];

  // Archer's assessment
  status: RndOpportunityStatus;
  reviewScore?: RndOpportunityScore;

  // Outcome
  convertedToProjectId?: string;
  parkedUntil?: string;         // ISO date if status=parked
  rejectionReason?: string;

  // Audit
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
  notes?: string;
}

// ─── Grant Programme Watchlist ───────────────────────────────────────────
// Separate from grantApplications. This is Sophie's watchlist of grant
// programmes she's tracking for when rounds open — independent of
// actual applications pursued.

export type GrantProgrammeFrequency =
  | "continuous"      // Always open (e.g. RDTI)
  | "annual"          // One round per year
  | "biannual"        // Two rounds per year
  | "quarterly"       // Four rounds per year
  | "irregular"       // Ad-hoc rounds as announced
  | "one_off";        // Single round, not recurring

export type GrantProgrammeLevel =
  | "federal"         // Commonwealth programmes
  | "state"           // State / territory government
  | "local"           // Local council
  | "industry"        // Industry body
  | "private";        // Private foundations

export interface GrantProgramme {
  id: string;
  programmeName: string;        // e.g. "R&D Tax Incentive"
  programmeBody: string;        // e.g. "AusIndustry"
  level: GrantProgrammeLevel;
  jurisdiction?: string;        // "Australia", "Victoria", "NSW" etc.

  description: string;
  programmeUrl?: string;

  // Typical funding
  fundingType: GrantFundingType;
  typicalValueMin?: number;
  typicalValueMax?: number;

  // Timing
  frequency: GrantProgrammeFrequency;
  nextRoundOpensAt?: string;    // ISO date — when Sophie expects the next round
  typicalDeadlineLead?: string; // Free text: "~6 weeks between open and close"

  // Fit assessment
  fitScore?: number;            // 1-5 — how well this fits ASI's R&D profile
  eligibilityNotes?: string;
  applicabilityNotes?: string;  // Which ASI R&D areas this supports

  // Status
  isActive: boolean;            // Sophie still watching this?
  tags?: string[];              // e.g. ["export", "cleantech", "manufacturing"]

  // Audit
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
  lastCheckedAt?: Timestamp;    // When Sophie last verified programme status
  notes?: string;
}

// ─── R&D Project Nominations ─────────────────────────────────────────────
// Lightweight pre-project intake. Josh (or any admin) submits a
// nomination → Archer writes a pre-feasibility brief → Josh approves,
// which converts the nomination to a full RndProject (and optionally
// drafts GrantApplications against suggested programmes).

export type RndNominationStatus =
  | "submitted"           // Waiting for Archer to start pre-feas
  | "in_prefeas"          // Archer is working on it
  | "prefeas_complete"    // Pre-feas brief written, awaiting Director approval
  | "approved"            // Approved + converted to RndProject
  | "rejected"            // Director rejected
  | "withdrawn";          // Submitter withdrew

export type RndNominationVerdict = "pursue" | "park" | "reject";

export interface RndProjectPreFeas {
  strategicFitScore: number;       // 1-5
  technicalFeasibilityScore: number; // 1-5
  marketRegulatoryContext: string;
  grantMatch: string;              // Prose summary of the best-fit programme(s)
  costEnvelopeMin?: number;
  costEnvelopeMax?: number;
  flagsAndRisks: string[];
  verdict: RndNominationVerdict;
  writtenBy: string;               // "ARCHER" or a user id
  writtenAt: Timestamp | string;
}

export interface RndProjectNomination {
  id: string;
  title: string;
  rationale: string;                 // Why this, why now

  // Routing hints
  domain?: string;
  priority?: "low" | "medium" | "high" | "critical";
  targetCompletionDate?: string;

  // Grant programme tagging — both auto-suggested + admin-picked IDs.
  // Values reference rndGrantProgrammes doc IDs.
  suggestedProgrammeIds?: string[]; // auto-suggest at submission
  selectedProgrammeIds?: string[];  // admin's confirmed picks

  status: RndNominationStatus;
  preFeas?: RndProjectPreFeas;

  // Director decision
  directorDecision?: "approved" | "rejected";
  directorNote?: string;
  directorDecidedAt?: Timestamp | string;
  directorDecidedBy?: string;

  // Conversion outcome
  convertedProjectId?: string;
  convertedGrantIds?: string[];     // GrantApplications auto-drafted on approval

  // Audit
  submittedBy: string;              // user id
  submittedByName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
