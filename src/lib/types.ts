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
  companyId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ============================================
// JOB LIFECYCLE MANAGEMENT (JLM)
// ============================================

export type JobStatus = "pending" | "scheduled" | "in_progress" | "completed" | "cancelled";

export interface Vehicle {
  registration: string;
  make: string;
  model: string;
  year: number;
  vin?: string;
  color?: string;
}

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

export interface Job {
  id: string;
  jobNumber: string;
  clientId: string;
  clientName: string;
  clientEmail: string;
  clientPhone?: string;
  vehicles: Vehicle[];
  damage: DamageItem[];
  status: JobStatus;
  assignedTechnicians: TechnicianAssignment[];
  booking?: BookingInfo;
  quoteDetails?: QuoteDetails;
  statusLog: StatusLogEntry[];
  scheduledDate?: Timestamp;
  completedDate?: Timestamp;
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
  notes?: string;
}

// ============================================
// INSPECTION SYSTEM
// ============================================

export type InspectionStatus = "draft" | "submitted" | "approved" | "converted";

export type RepairType = "bodywork" | "paint" | "glass" | "trim" | "mechanical" | "other";

export interface DamageReportItem {
  id: string;
  repairType: RepairType;
  description: string;
  location: string;
  severity: "minor" | "moderate" | "severe";
  photoUrls: string[];
  recommendedAction?: string;
  estimatedCost?: number;
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
  clientId?: string;
  clientName: string;
  clientEmail: string;
  clientPhone?: string;
  vehicleReports: VehicleReport[];
  status: InspectionStatus;
  submittedAt?: Timestamp;
  approvedAt?: Timestamp;
  convertedToJobId?: string;
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
  findings?: string;
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

export interface ContactOrganization {
  id: string;
  name: string;
  type: OrganizationType;
  status: OrganizationStatus;
  abn?: string;
  marketStream?: MarketStream;
  industry?: string;
  address?: Address;
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
  clientName: string;
  serviceType: string;
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

export type NotificationType = "job_assigned" | "job_status_changed" | "quote_approved" | "inspection_submitted" | "booking_received";

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  relatedEntityId?: string;
  relatedEntityType?: "job" | "inspection" | "lead" | "quote";
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
