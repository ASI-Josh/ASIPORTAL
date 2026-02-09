import { UserRole } from "./types";

// ============================================
// ROLE ASSIGNMENT LOGIC
// ============================================

export const ADMIN_EMAILS = [
  "joshua@asi-australia.com.au",
  "jaydan@asi-australia.com.au",
  "bobby@asi-australia.com.au",
];

const TECHNICIAN_DOMAIN = "@asi-australia.com.au";

export function determineUserRole(email: string, fallbackRole: UserRole = "client"): UserRole {
  const normalizedEmail = email.toLowerCase().trim();

  // Check if admin
  if (ADMIN_EMAILS.includes(normalizedEmail)) {
    return "admin";
  }

  // Check if technician (ASI domain but not admin)
  if (normalizedEmail.endsWith(TECHNICIAN_DOMAIN)) {
    return "technician";
  }

  // Default to client
  return fallbackRole;
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
    default:
      return "/admin";
  }
}

export function isAuthorizedForRoute(role: UserRole, path: string): boolean {
  // Admin can access everything
  if (role === "admin") return true;

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
