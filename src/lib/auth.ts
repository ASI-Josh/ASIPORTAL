import { UserRole } from "./types";

// ============================================
// ROLE ASSIGNMENT LOGIC
// ============================================

export const ADMIN_EMAILS = [
  "joshua@asi-australia.com.au",
  "jaydan@asi-australia.com.au",
  "bobby@asi-australia.com.au",
];

// External auditors — read-only access to IMS collections for ISO certification audits.
// Add auditor emails here as they are provisioned for certification cycles.
export const AUDITOR_EMAILS: string[] = [];

const TECHNICIAN_DOMAIN = "@asi-australia.com.au";

export function determineUserRole(email: string, fallbackRole: UserRole = "client"): UserRole {
  const normalizedEmail = email.toLowerCase().trim();

  // Check if admin
  if (ADMIN_EMAILS.includes(normalizedEmail)) {
    return "admin";
  }

  // Check if external auditor (takes precedence over domain-based technician assignment)
  if (AUDITOR_EMAILS.includes(normalizedEmail)) {
    return "auditor";
  }

  // Check if technician (ASI domain but not admin)
  if (normalizedEmail.endsWith(TECHNICIAN_DOMAIN)) {
    return "technician";
  }

  // Default to client
  return fallbackRole;
}

// ============================================
// CUTTING WORKFLOW ACCESS (declared early so route helpers can use it)
// Standalone module — designed for clean extraction into its own app
// later. Roles allowed to access cutting are kept as a list so future
// roles (installer, plotter_renter, washd_admin) can be added without
// touching gate logic. Today: admin + technician + client.
// ============================================

export const CUTTING_ACCESS_ROLES: UserRole[] = ["admin", "technician", "client"];

export function canAccessCutting(role: UserRole | undefined | null): boolean {
  if (!role) return false;
  return CUTTING_ACCESS_ROLES.includes(role);
}

export function cuttingScopeForRole(role: UserRole): "all" | "own" | "none" {
  if (role === "admin" || role === "technician") return "all";
  if (role === "client") return "own";
  return "none";
}

// ============================================
// ROUTE HELPERS
// ============================================

export function getDefaultRouteForRole(role: UserRole): string {
  switch (role) {
    case "admin":
      return "/admin";
    case "technician":
      return "/technician";
    case "client":
      return "/client";
    case "contractor":
      return "/contractor";
    case "auditor":
      return "/dashboard/ims";
    default:
      return "/admin";
  }
}

export function isAuthorizedForRoute(role: UserRole, path: string): boolean {
  // Admin can access everything
  if (role === "admin") return true;

  // Cutting workflow is its own standalone module — admin/tech/client all allowed.
  // Designed to be liftable into its own app/program later.
  if (path.startsWith("/cutting")) {
    return CUTTING_ACCESS_ROLES.includes(role);
  }

  // Technicians can access technician routes and shared jobs/inspections
  if (role === "technician") {
    return (
      path.startsWith("/technician") ||
      path.startsWith("/dashboard/jobs") ||
      path.startsWith("/dashboard/calendar") ||
      path.startsWith("/dashboard/inspections") ||
      path.startsWith("/dashboard/daily-prestart") ||
      path.startsWith("/dashboard/ims/library") ||
      path.startsWith("/dashboard/ims/incidents")
    );
  }

  // External auditors — READ-ONLY access to IMS, audits, CAPAs, incidents, risk,
  // jobs, inspections, works register, meetings, meeting actions. Time-limited
  // access enforced via userDoc.auditorTokenExpiresAt (see isAuditorTokenValid).
  // No financial, sales, Xero, leads, or customer contact data.
  if (role === "auditor") {
    return (
      path.startsWith("/dashboard/ims") ||
      path.startsWith("/dashboard/jobs") ||
      path.startsWith("/dashboard/inspections") ||
      path.startsWith("/dashboard/works-register") ||
      path.startsWith("/dashboard/daily-prestart") ||
      path.startsWith("/dashboard/meetings") ||
      path === "/dashboard" ||
      path === "/dashboard/"
    );
  }

  // Clients can only access client routes
  if (role === "client") {
    return path.startsWith("/client");
  }

  // Contractors can access contractor routes
  if (role === "contractor") {
    return path.startsWith("/contractor");
  }

  return false;
}



// ============================================
// PERMISSION HELPERS
// ============================================

export function canEditJob(
  userId: string,
  role: UserRole,
  jobCreatorId: string,
  assignedTechnicianIds: string[]
): boolean {
  // Admin can edit anything
  if (role === "admin") return true;

  // Creator can edit their own job
  if (jobCreatorId === userId) return true;

  // Assigned technicians can edit
  if (assignedTechnicianIds.includes(userId)) return true;

  return false;
}

export function canViewJob(
  userId: string,
  role: UserRole,
  jobClientId: string,
  assignedTechnicianIds: string[]
): boolean {
  // Admin can view anything
  if (role === "admin") return true;

  // Client can view their own jobs
  if (role === "client" && jobClientId === userId) return true;

  // Assigned technicians can view
  if (assignedTechnicianIds.includes(userId)) return true;

  return false;
}

// ============================================
// AUDITOR TOKEN EXPIRY
// ============================================

/**
 * Default duration of an auditor access grant (14 days). Set via the MCP
 * provision_auditor_access tool or manually by admin. Stored on the user doc as
 * `auditorTokenExpiresAt` (ISO string). Use isAuditorTokenValid() on every auth
 * check for auditor-role users.
 */
export const DEFAULT_AUDITOR_TOKEN_DAYS = 14;

export function isAuditorTokenValid(expiresAt?: string | null): boolean {
  if (!expiresAt) return false;
  try {
    return new Date(expiresAt).getTime() > Date.now();
  } catch {
    return false;
  }
}

export function computeAuditorExpiry(days: number = DEFAULT_AUDITOR_TOKEN_DAYS): string {
  return new Date(Date.now() + days * 86400000).toISOString();
}
