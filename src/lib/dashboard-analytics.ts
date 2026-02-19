import {
  CLIENT_CONTACT_CATEGORIES,
  type BookingType,
  type ContactOrganization,
  type Job,
  type WorksRegisterEntry,
  type Inspection,
} from "@/lib/types";

export type RevenueBucket = {
  total: number;
  count: number;
};

export type DashboardMetrics = {
  dateKey: string;
  revenue: {
    quoted: RevenueBucket;
    confirmed: RevenueBucket;
    completed: RevenueBucket;
  };
  glassSavedKg: number;
  replacementValueSaved: number;
  downtimeSavedHours: number;
  topClients: { name: string; revenue: number; jobs: number }[];
  inactiveClients: { name: string; daysInactive: number; lastActivity?: string }[];
  operations: {
    jobsCompleted: number;
    jobsInProgress: number;
    jobsScheduled: number;
    avgCompletionHours: number;
    complianceRate: number;
    overdueJobs: number;
    onHoldJobs: number;
    unassignedJobs: number;
    jobsCompletedToday: number;
  };
};

type TimestampLike = {
  toDate?: () => Date;
  toMillis?: () => number;
};

type PanelType = "windscreen_low_floor" | "windscreen_coach" | "side_low_floor" | "side_coach" | "rear";

const GLASS_WEIGHT_KG: Record<PanelType, number> = {
  windscreen_low_floor: 58.7,
  windscreen_coach: 83.5,
  side_low_floor: 27.1,
  side_coach: 21.2,
  rear: 37.8,
};

const REPLACEMENT_COST_AUD: Record<PanelType, number> = {
  windscreen_low_floor: 2100,
  windscreen_coach: 2450,
  side_low_floor: 900,
  side_coach: 900,
  rear: 1200,
};

const DOWNTIME_HOURS: Record<PanelType, number> = {
  windscreen_low_floor: 3.5,
  windscreen_coach: 3.5,
  side_low_floor: 1.5,
  side_coach: 1.5,
  rear: 1.8,
};

const GLASS_JOB_TYPES: BookingType[] = [
  "windscreen_crack_chip_repair",
  "windscreen_replacement",
  "scratch_graffiti_removal",
  "film_installation",
];

const NON_GLASS_JOB_TYPES: BookingType[] = [
  "trim_restoration_interior",
  "trim_restoration_exterior",
  "polymer_lens_restoration",
];

const MILLISECONDS_IN_DAY = 1000 * 60 * 60 * 24;

function toDate(value?: TimestampLike | Date | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value.toDate) return value.toDate();
  if (value.toMillis) return new Date(value.toMillis());
  return null;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function daysBetween(now: Date, past?: Date | null) {
  if (!past) return null;
  return Math.floor((now.getTime() - past.getTime()) / MILLISECONDS_IN_DAY);
}

function clampNumber(value: number) {
  if (!Number.isFinite(value)) return 0;
  return value;
}

function getJobRevenue(job: Job) {
  if (job.totalJobCost && job.totalJobCost > 0) return job.totalJobCost;
  if (job.quoteDetails?.total) return job.quoteDetails.total;
  if (job.jobVehicles?.length) {
    return job.jobVehicles.reduce((sum, vehicle) => sum + (vehicle.totalCost || 0), 0);
  }
  return 0;
}

function getServiceLabel(job: Job) {
  const firstLine = job.notes?.split("\n")[0] || "";
  const match = firstLine.match(/Service:\s*(.+)$/i);
  return match ? match[1] : "";
}

function buildSearchText(job: Job) {
  const notes = job.notes || "";
  const description = job.jobDescription || "";
  const vehicleLocations =
    job.jobVehicles?.flatMap((vehicle) =>
      vehicle.repairSites.map((site) => `${site.location} ${site.description || ""}`)
    ) || [];
  return [notes, description, ...vehicleLocations].join(" ").toLowerCase();
}

function detectPanelType(job: Job): PanelType | null {
  const serviceLabel = getServiceLabel(job).toLowerCase();
  const searchText = buildSearchText(job);
  const isLowFloor = searchText.includes("low floor") || searchText.includes("lf");

  const bookingType = job.notes?.toLowerCase().includes("windscreen")
    ? "windscreen_crack_chip_repair"
    : undefined;

  if (serviceLabel.includes("windscreen") || bookingType === "windscreen_crack_chip_repair") {
    return isLowFloor ? "windscreen_low_floor" : "windscreen_coach";
  }

  if (searchText.includes("rear")) {
    return "rear";
  }

  if (searchText.includes("side") || searchText.includes("window")) {
    return isLowFloor ? "side_low_floor" : "side_coach";
  }

  if (GLASS_JOB_TYPES.some((type) => serviceLabel.includes(type.replace(/_/g, " ")))) {
    return isLowFloor ? "side_low_floor" : "side_coach";
  }

  if (NON_GLASS_JOB_TYPES.some((type) => serviceLabel.includes(type.replace(/_/g, " ")))) {
    return null;
  }

  return null;
}

function hasOnHoldWork(job: Job) {
  if (!job.jobVehicles?.length) return false;
  return job.jobVehicles.some((vehicle) => {
    if (vehicle.status === "on_hold") return true;
    return vehicle.repairSites?.some((site) => site.workStatus === "on_hold");
  });
}

function calculateRevenueBucket(bucket: RevenueBucket, value: number) {
  bucket.count += 1;
  bucket.total += value;
}

function getDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function calculateDashboardMetrics(params: {
  jobs: Job[];
  inspections: Inspection[];
  worksRegister: WorksRegisterEntry[];
  organizations?: ContactOrganization[];
  now?: Date;
}): DashboardMetrics {
  const now = params.now || new Date();
  const dateKey = getDateKey(now);

  const revenue = {
    quoted: { total: 0, count: 0 },
    confirmed: { total: 0, count: 0 },
    completed: { total: 0, count: 0 },
  };

  let glassSavedKg = 0;
  let replacementValueSaved = 0;
  let downtimeSavedHours = 0;

  let totalCompletionHours = 0;
  let completionCount = 0;

  let overdueJobs = 0;
  let onHoldJobs = 0;
  let unassignedJobs = 0;
  let jobsCompletedToday = 0;

  const clientRevenue = new Map<string, { name: string; revenue: number; jobs: number }>();
  const lastActivityByOrg = new Map<string, Date>();

  params.jobs.forEach((job) => {
    if (job.isDeleted) return;
    const isActive = !["completed", "closed", "cancelled"].includes(job.status);
    const jobValue = getJobRevenue(job);

    if (job.status === "pending") {
      calculateRevenueBucket(revenue.quoted, jobValue);
    } else if (job.status === "scheduled" || job.status === "in_progress") {
      calculateRevenueBucket(revenue.confirmed, jobValue);
    } else if (job.status === "completed" || job.status === "closed") {
      calculateRevenueBucket(revenue.completed, jobValue);
    }

    if (job.status === "completed" || job.status === "closed") {
      const panelType = detectPanelType(job);
      if (panelType) {
        const weight = GLASS_WEIGHT_KG[panelType];
        const replacementCost = REPLACEMENT_COST_AUD[panelType];
        const downtime = DOWNTIME_HOURS[panelType];
        glassSavedKg += weight;
        downtimeSavedHours += downtime;
        const savedValue = Math.max(replacementCost - jobValue, 0);
        replacementValueSaved += savedValue;
      }
    }

    const scheduledDate = toDate(job.scheduledDate);
    const completedDate = toDate(job.completedDate);
    if (scheduledDate && completedDate) {
      const durationHours = (completedDate.getTime() - scheduledDate.getTime()) / (1000 * 60 * 60);
      if (durationHours >= 0) {
        totalCompletionHours += durationHours;
        completionCount += 1;
      }
      if (isSameDay(completedDate, now)) {
        jobsCompletedToday += 1;
      }
    }

    if (isActive && scheduledDate && scheduledDate < now) {
      overdueJobs += 1;
    }

    if (isActive && hasOnHoldWork(job)) {
      onHoldJobs += 1;
    }

    if (isActive && !job.assignedTechnicians?.length) {
      unassignedJobs += 1;
    }

    const orgKey = job.organizationId || job.clientName;
    if (orgKey) {
      const existing = clientRevenue.get(orgKey) || {
        name: job.clientName || orgKey,
        revenue: 0,
        jobs: 0,
      };
      existing.revenue += jobValue;
      existing.jobs += 1;
      clientRevenue.set(orgKey, existing);
    }

    const lastActivity = toDate(job.updatedAt) || toDate(job.createdAt);
    if (orgKey && lastActivity) {
      const currentLast = lastActivityByOrg.get(orgKey);
      if (!currentLast || lastActivity > currentLast) {
        lastActivityByOrg.set(orgKey, lastActivity);
      }
    }
  });

  params.inspections.forEach((inspection) => {
    const orgKey = inspection.organizationId || inspection.clientName || inspection.id;
    const updated = toDate(inspection.updatedAt) || toDate(inspection.createdAt);
    if (orgKey && updated) {
      const currentLast = lastActivityByOrg.get(orgKey);
      if (!currentLast || updated > currentLast) {
        lastActivityByOrg.set(orgKey, updated);
      }
    }
  });

  const topClients = Array.from(clientRevenue.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 3);

  const inactiveClients: { name: string; daysInactive: number; lastActivity?: string }[] = [];
  const orgSources = params.organizations || [];
  orgSources
    .filter((org) => CLIENT_CONTACT_CATEGORIES.includes(org.category))
    .forEach((org) => {
    const lastActivity = lastActivityByOrg.get(org.id) || toDate(org.updatedAt);
    const days = daysBetween(now, lastActivity);
    if (days !== null && days >= 28) {
      inactiveClients.push({
        name: org.name,
        daysInactive: days,
        lastActivity: lastActivity ? lastActivity.toISOString() : undefined,
      });
    }
  });

  const complianceEligible = params.worksRegister.filter(
    (entry) => entry.recordType !== "inspection"
  );
  const complianceRate = complianceEligible.length
    ? (complianceEligible.filter((entry) => entry.approvedAt).length / complianceEligible.length) * 100
    : 0;

  const activeJobs = params.jobs.filter((job) => !job.isDeleted);
  const jobsCompleted = activeJobs.filter(
    (job) => job.status === "completed" || job.status === "closed"
  ).length;
  const jobsInProgress = activeJobs.filter((job) => job.status === "in_progress").length;
  const jobsScheduled = activeJobs.filter((job) => job.status === "scheduled").length;

  return {
    dateKey,
    revenue: {
      quoted: { total: clampNumber(revenue.quoted.total), count: revenue.quoted.count },
      confirmed: { total: clampNumber(revenue.confirmed.total), count: revenue.confirmed.count },
      completed: { total: clampNumber(revenue.completed.total), count: revenue.completed.count },
    },
    glassSavedKg: clampNumber(glassSavedKg),
    replacementValueSaved: clampNumber(replacementValueSaved),
    downtimeSavedHours: clampNumber(downtimeSavedHours),
    topClients,
    inactiveClients: inactiveClients.sort((a, b) => b.daysInactive - a.daysInactive).slice(0, 3),
    operations: {
      jobsCompleted,
      jobsInProgress,
      jobsScheduled,
      avgCompletionHours: completionCount ? clampNumber(totalCompletionHours / completionCount) : 0,
      complianceRate: clampNumber(complianceRate),
      overdueJobs,
      onHoldJobs,
      unassignedJobs,
      jobsCompletedToday,
    },
  };
}

export function buildInsightPrompt(metrics: DashboardMetrics) {
  return JSON.stringify(
    {
      dateKey: metrics.dateKey,
      revenue: metrics.revenue,
      glassSavedKg: metrics.glassSavedKg,
      replacementValueSaved: metrics.replacementValueSaved,
      downtimeSavedHours: metrics.downtimeSavedHours,
      topClients: metrics.topClients,
      inactiveClients: metrics.inactiveClients,
      operations: metrics.operations,
    },
    null,
    2
  );
}
