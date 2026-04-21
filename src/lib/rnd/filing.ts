/**
 * R&D filing — helpers for the R&D Projects filing structure.
 *
 * R&D project documents live in the existing imsDocuments collection
 * (one source of truth for documentation — keeps ISO 9001 clause 7.5
 * clean, keeps GUARDIAN auditing in one place, keeps R&D Tax Incentive
 * substantiation pointing at one repo). They're identified by four
 * optional fields added to the raw Firestore doc:
 *
 *   rndProjectId:     string   // links to rndProjects doc ID
 *   rndNominationId:  string   // links to rndProjectNominations doc ID
 *   rndFolder:        RndFolder
 *   rndFinancialYear: string   // "FY2025-26" format
 *
 * Docs with rndProjectId set show up inside the R&D Projects tree on
 * the IMS page and inside the Archer Project Register tab.
 */

export const RND_FOLDERS = [
  "pm_planning",
  "engineering_design",
  "administration",
  "finance",
  "legal",
  "project_filing",
] as const;

export type RndFolder = (typeof RND_FOLDERS)[number];

export const RND_FOLDER_LABELS: Record<RndFolder, string> = {
  pm_planning: "Project Management Planning",
  engineering_design: "Engineering & Design",
  administration: "Administration",
  finance: "Finance",
  legal: "Legal",
  project_filing: "Project Filing",
};

export const RND_FOLDER_DESCRIPTIONS: Record<RndFolder, string> = {
  pm_planning: "Project plans, gantt, risk log, stakeholder register, status reports.",
  engineering_design: "Specs, CAD, test plans, test results, design reviews.",
  administration: "Meeting minutes, approval records, correspondence.",
  finance: "Budget, spend log, procurement, grant-spend substantiation, R&DTI eligible expenses.",
  legal: "Contracts, IP assignments, NDAs, collaboration agreements.",
  project_filing:
    "Completed IMS docs, project deliverables, evidence, media, meeting minutes, logistics, procurement records.",
};

/**
 * Compute the Australian financial year string for a given date.
 * ASI runs Australian FY (1 Jul – 30 Jun). A date in March 2026 is in
 * FY2025-26; a date in August 2026 is in FY2026-27.
 *
 * Returns "FY2025-26" format — the year labels are 4-digit + 2-digit
 * short form, matching how ATO documentation refers to tax years.
 */
export function getAustralianFinancialYear(input: Date | string | null | undefined): string {
  const d = input instanceof Date ? input : input ? new Date(input) : new Date();
  if (Number.isNaN(d.getTime())) return "FY-unknown";
  const y = d.getFullYear();
  const m = d.getMonth(); // 0 = Jan … 6 = July
  // From July onwards the FY rolls over — July 2026 is FY2026-27.
  const startYear = m >= 6 ? y : y - 1;
  const endYearShort = String((startYear + 1) % 100).padStart(2, "0");
  return `FY${startYear}-${endYearShort}`;
}

/**
 * Returns the list of recent FYs (current + past N) as strings, newest
 * first. Used for grouping project lists in the Register tab when
 * there aren't many projects yet.
 */
export function recentFinancialYears(count = 3, now: Date = new Date()): string[] {
  const out: string[] = [];
  const currentY = now.getFullYear();
  const currentM = now.getMonth();
  const startYear = currentM >= 6 ? currentY : currentY - 1;
  for (let i = 0; i < count; i++) {
    const y = startYear - i;
    const endShort = String((y + 1) % 100).padStart(2, "0");
    out.push(`FY${y}-${endShort}`);
  }
  return out;
}

/**
 * Sort two FY strings newest first ("FY2026-27" before "FY2025-26").
 */
export function compareFinancialYearsDesc(a: string, b: string): number {
  return b.localeCompare(a);
}
