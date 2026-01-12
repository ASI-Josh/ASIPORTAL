import { Timestamp } from "firebase/firestore";
import type {
  Job,
  Booking,
  WorksRegisterEntry,
  JobLifecycleStage,
  JobStatus,
  BookingType,
  BOOKING_TYPE_LABELS,
  QualityCheck,
} from "./types";

// Create a single timestamp for all initial data
const INITIAL_TIMESTAMP = Timestamp.fromDate(new Date("2025-01-01T00:00:00Z"));

// ============================================
// JOB NUMBER GENERATION
// ============================================

let jobCounter = 0;

export function generateJobNumber(clientCode = "JOB"): string {
  const yearSuffix = String(new Date().getFullYear()).slice(-2);
  jobCounter++;
  return `${clientCode}-${yearSuffix}-${String(jobCounter).padStart(4, "0")}`;
}

export function generateBookingNumber(): string {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 10000);
  return `BK-${year}-${String(random).padStart(4, "0")}`;
}

export function generateWorksRegisterNumber(): string {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 10000);
  return `WR-${year}-${String(random).padStart(4, "0")}`;
}

// ============================================
// INITIAL JOBS DATA
// ============================================

const unsortedJobs: Job[] = [];

export const initialJobs = unsortedJobs;

// ============================================
// INITIAL BOOKINGS DATA
// ============================================

const unsortedBookings: Booking[] = [];

export const initialBookings = unsortedBookings;

// ============================================
// INITIAL WORKS REGISTER DATA
// ============================================

const unsortedWorksRegister: WorksRegisterEntry[] = [];

export const initialWorksRegister = unsortedWorksRegister;

// ============================================
// JOB LIFECYCLE STAGE MAPPING
// ============================================

export function getLifecycleStageFromStatus(status: JobStatus): JobLifecycleStage {
  switch (status) {
    case "pending":
      return "rfq";
    case "scheduled":
      return "job_scheduled";
    case "in_progress":
      return "job_live";
    case "completed":
      return "job_completed";
    case "cancelled":
      return "management_closeoff";
    default:
      return "rfq";
  }
}

export function getStatusFromLifecycleStage(stage: JobLifecycleStage): JobStatus {
  switch (stage) {
    case "rfq":
      return "pending";
    case "job_scheduled":
      return "scheduled";
    case "job_live":
      return "in_progress";
    case "job_completed":
      return "completed";
    case "management_closeoff":
      return "completed";
    default:
      return "pending";
  }
}

// ============================================
// BOOKING TO JOB CONVERSION
// ============================================

export interface CreateJobFromBookingParams {
  booking: Booking;
  bookingTypeLabelMap: Record<BookingType, string>;
  jobId?: string;
  jobNumber?: string;
}

export function createJobFromBooking(params: CreateJobFromBookingParams): Job {
  const { booking, bookingTypeLabelMap, jobId, jobNumber } = params;
  const now = Timestamp.now();
  const resolvedJobNumber = jobNumber || generateJobNumber();

  const siteAddress = `${booking.siteLocation.address.street}, ${booking.siteLocation.address.suburb} ${booking.siteLocation.address.state} ${booking.siteLocation.address.postcode}`;

  const job: Job = {
    id: jobId || `job-${Date.now()}`,
    jobNumber: resolvedJobNumber,
    clientId: booking.organizationId,
    clientName: booking.organizationName,
    clientEmail: booking.contactEmail,
    clientPhone: booking.contactPhone,
    organizationId: booking.organizationId,
    vehicles: [],
    jobVehicles: [], // Initialize empty - to be populated on job card
    damage: [],
    status: "scheduled",
    assignedTechnicians: booking.allocatedStaff.map((staff, index) => ({
      technicianId: staff.id,
      technicianName: staff.name,
      role: index === 0 ? "primary" : "secondary",
      assignedAt: now,
      assignedBy: booking.createdBy,
    })),
    assignedTechnicianIds: booking.allocatedStaff.map((staff) => staff.id),
    booking: {
      preferredDate: booking.scheduledDate,
      preferredTime: booking.scheduledTime,
      urgency: "medium",
      specialInstructions: booking.notes,
    },
    statusLog: [
      {
        status: "pending",
        changedAt: booking.createdAt,
        changedBy: "System",
        notes: `Job created from booking ${booking.bookingNumber}`,
      },
      {
        status: "scheduled",
        changedAt: now,
        changedBy: booking.createdBy,
        notes: `Booking confirmed and converted to job`,
      },
    ],
    scheduledDate: booking.scheduledDate,
    createdAt: now,
    createdBy: booking.createdBy,
    updatedAt: now,
    notes: `Service: ${bookingTypeLabelMap[booking.bookingType]}\nLocation: ${booking.siteLocation.name}\n${siteAddress}`,
    siteLocation: {
      name: booking.siteLocation.name,
      address: siteAddress,
    },
    totalJobCost: 0,
    totalLabourCost: 0,
    totalMaterialsCost: 0,
  };

  return job;
}

// ============================================
// WORKS REGISTER ENTRY CREATION
// ============================================

export interface CreateWorksRegisterEntryParams {
  job: Job;
  serviceType: string;
  technicianName: string;
  entryId?: string;
}

export function createWorksRegisterEntry(params: CreateWorksRegisterEntryParams): WorksRegisterEntry {
  const { job, serviceType, technicianName, entryId } = params;
  const now = Timestamp.now();

  const primaryTech = job.assignedTechnicians.find((t) => t.role === "primary");

  const entry: WorksRegisterEntry = {
    id: entryId || `wr-${Date.now()}`,
    jobId: job.id,
    jobNumber: job.jobNumber,
    organizationId: job.organizationId || job.clientId,
    clientName: job.clientName,
    serviceType,
    technicianId: primaryTech?.technicianId || "unassigned",
    technicianName,
    startDate: job.scheduledDate || now,
    qualityChecks: [],
    complianceStandards: ["ISO9001"],
    createdAt: now,
  };

  return entry;
}

// ============================================
// JOB LIFECYCLE CARD TYPE
// ============================================

export interface JobLifecycleCard {
  id: string;
  jobNumber: string;
  clientName: string;
  serviceType: string;
  technician: string;
  scheduledDate: string;
  stage: JobLifecycleStage;
}

export function jobToLifecycleCard(job: Job, serviceType: string): JobLifecycleCard {
  const technicianNames = job.assignedTechnicians
    .map((t) => t.technicianId)
    .join(", ");

  return {
    id: job.id,
    jobNumber: job.jobNumber,
    clientName: job.clientName,
    serviceType,
    technician: technicianNames || "Unassigned",
    scheduledDate: job.scheduledDate
      ? job.scheduledDate.toDate().toISOString().split("T")[0]
      : "TBD",
    stage: getLifecycleStageFromStatus(job.status),
  };
}

// ============================================
// WORKS REGISTER DISPLAY TYPE
// ============================================

export interface WorksRegisterDisplay {
  jobNumber: string;
  client: string;
  serviceType: string;
  technician: string;
  startDate: string;
  completionDate: string;
  status: "Completed" | "In Progress" | "Scheduled";
  compliance: "Compliant" | "Non-Conformance" | "Pending";
}

export function worksEntryToDisplay(entry: WorksRegisterEntry): WorksRegisterDisplay {
  const status = entry.completionDate
    ? "Completed"
    : entry.startDate.toDate() <= new Date()
    ? "In Progress"
    : "Scheduled";

  const allChecksPassed = entry.qualityChecks.every((qc) => qc.passed);
  const compliance = entry.approvedAt
    ? allChecksPassed
      ? "Compliant"
      : "Non-Conformance"
    : "Pending";

  return {
    jobNumber: entry.jobNumber,
    client: entry.clientName,
    serviceType: entry.serviceType,
    technician: entry.technicianName,
    startDate: entry.startDate.toDate().toISOString().split("T")[0],
    completionDate: entry.completionDate
      ? entry.completionDate.toDate().toISOString().split("T")[0]
      : "-",
    status,
    compliance,
  };
}
