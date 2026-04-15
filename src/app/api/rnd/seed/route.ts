/**
 * POST /api/rnd/seed
 * Admin-only. Seeds Sophie Archer's R&D workspace with realistic
 * starter data: grant programmes (watchlist), opportunities, grant
 * applications, and R&D projects.
 *
 * Safe to call multiple times — skips records that already exist based
 * on a unique field (programmeName for programmes, title for projects,
 * programmeName+roundName for grant applications).
 */
import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";

// ─── Grant Programmes Watchlist (Australian federal + state major ones) ────

const SEED_PROGRAMMES = [
  {
    programmeName: "R&D Tax Incentive (RDTI)",
    programmeBody: "AusIndustry / ATO",
    level: "federal",
    jurisdiction: "Australia",
    description:
      "The flagship federal R&D support: refundable tax offset (43.5%) for companies with aggregated turnover under $20m, non-refundable offset otherwise. Covers eligible R&D activities conducted in Australia.",
    programmeUrl: "https://business.gov.au/grants-and-programs/research-and-development-tax-incentive",
    fundingType: "tax_offset",
    typicalValueMin: 10000,
    typicalValueMax: 1000000,
    frequency: "continuous",
    typicalDeadlineLead: "Registration due 10 months after end of financial year",
    fitScore: 5,
    eligibilityNotes:
      "Aggregated turnover under $20m for refundable offset. Must be incorporated in Australia. R&D activities must meet core/supporting activity definitions — experimental, outcome unknown, generating new knowledge.",
    applicabilityNotes:
      "Strong fit for all ASI R&D work: film science, installation processes, platform development, AI/automation. Annual claim cycle aligns with financial year close.",
    tags: ["r&d", "tax", "annual", "high-priority"],
  },
  {
    programmeName: "Export Market Development Grants (EMDG)",
    programmeBody: "Austrade",
    level: "federal",
    jurisdiction: "Australia",
    description:
      "Reimburses eligible export promotion expenses up to 50%. Three tiers: Tier 1 (new-to-export), Tier 2 (expanding), Tier 3 (strategic shift). Relevant for APEAX distribution expansion into non-AU markets.",
    programmeUrl: "https://www.austrade.gov.au/australian/how-austrade-can-help/financial-assistance/emdg",
    fundingType: "grant",
    typicalValueMin: 15000,
    typicalValueMax: 770000,
    frequency: "continuous",
    typicalDeadlineLead: "Applications open annually (typically Jul-Nov)",
    fitScore: 4,
    eligibilityNotes:
      "Australian SME with turnover under $20m. Minimum 2 years export promotion activity. Cannot receive Tier 1 and 2 in same year.",
    applicabilityNotes:
      "Relevant for SHIELD's APEAX distribution market expansion — trade shows, marketing collateral, market research, overseas marketing visits.",
    tags: ["export", "apeax", "annual"],
  },
  {
    programmeName: "Industry Growth Program",
    programmeBody: "Department of Industry, Science and Resources",
    level: "federal",
    jurisdiction: "Australia",
    description:
      "Supports SMEs in priority sectors (including cleantech, advanced manufacturing) with commercialisation and growth advisory plus matched grants $50k-$5m for commercialisation projects.",
    programmeUrl: "https://business.gov.au/grants-and-programs/industry-growth-program",
    fundingType: "grant",
    typicalValueMin: 50000,
    typicalValueMax: 5000000,
    frequency: "continuous",
    fitScore: 4,
    eligibilityNotes:
      "SMEs in National Reconstruction Fund priority areas: cleantech, renewables, advanced manufacturing, value-add agriculture. Must pass advisory stage first.",
    applicabilityNotes:
      "APEAX film products have cleantech + advanced manufacturing angles. Could fund commercialisation of next-gen film products or production capability.",
    tags: ["commercialisation", "cleantech", "matched-funding"],
  },
  {
    programmeName: "Victorian Innovation Network — Business Innovation Grants",
    programmeBody: "LaunchVic / Department of Jobs, Skills, Industry and Regions",
    level: "state",
    jurisdiction: "Victoria",
    description:
      "State-level innovation grants for Victorian SMEs undertaking R&D or commercialisation projects. Typically 50% matched funding.",
    fundingType: "grant",
    typicalValueMin: 25000,
    typicalValueMax: 250000,
    frequency: "annual",
    fitScore: 4,
    eligibilityNotes:
      "Victorian-registered SME. Project must be conducted primarily in Victoria. Matched funding required.",
    applicabilityNotes:
      "Good fit for Victorian-based R&D work. Compatible with federal RDTI (stacked).",
    tags: ["victoria", "state", "matched-funding"],
  },
  {
    programmeName: "Entrepreneurs' Programme — Accelerating Commercialisation",
    programmeBody: "AusIndustry",
    level: "federal",
    jurisdiction: "Australia",
    description:
      "Matched funding (50%) up to $1m for commercialising novel products, processes, or services. Targets the gap between prototype and market-ready.",
    programmeUrl: "https://business.gov.au/grants-and-programs/entrepreneurs-programme",
    fundingType: "grant",
    typicalValueMin: 100000,
    typicalValueMax: 1000000,
    frequency: "irregular",
    fitScore: 3,
    eligibilityNotes:
      "Must demonstrate novelty and commercialisation pathway. Matched funding required. Needs an Expert Programme advisor.",
    applicabilityNotes:
      "Could fit a next-gen APEAX product commercialisation. Requires clear novelty story.",
    tags: ["commercialisation", "matched-funding"],
  },
  {
    programmeName: "CSIRO Innovate to Grow",
    programmeBody: "CSIRO",
    level: "federal",
    jurisdiction: "Australia",
    description:
      "Free 10-week online programme for SMEs to define an R&D roadmap and connect with research capability. Not direct funding but pathway into CSIRO Kick-Start grants (up to $50k matched).",
    programmeUrl: "https://www.csiro.au/en/work-with-us/sme-engagement",
    fundingType: "grant",
    typicalValueMin: 10000,
    typicalValueMax: 50000,
    frequency: "biannual",
    fitScore: 3,
    eligibilityNotes:
      "Australian SME with R&D ambition. Must complete I2G programme to access Kick-Start grants.",
    applicabilityNotes:
      "Pathway to CSIRO research partnership. Good for horizon-scanning R&D work Sophie may want to validate.",
    tags: ["csiro", "r&d", "partnership"],
  },
];

// ─── R&D Opportunities (examples) ────────────────────────────────────────

const SEED_OPPORTUNITIES = [
  {
    title: "Lithium fleet integration — emerging regulatory requirement",
    description:
      "Three tier-1 clients (McKenzie's, Nuline, BusCo) have asked about lithium/EV battery handling protocols in the last month. Common thread: they're preparing EV readiness plans ahead of state regulator requirements. Opportunity for ASI to develop a capability stack around EV fleet surface protection + safety protocols.",
    type: "client_pattern",
    sourcedBy: "SENTINEL",
    sourceContext: "Weekly management meeting 2026-04-17 — SENTINEL pipeline review",
  },
  {
    title: "AI-vision defect detection from new APEAX partner supplier",
    description:
      "APEAX USA parent introduced a supplier offering AI-vision defect detection for film installation QA. Integrates with phone cameras. Could automate our QA step and feed into GUARDIAN's IMS audit trail automatically. Licensing model TBC.",
    type: "supplier_innovation",
    sourcedBy: "VANGUARD",
    sourceContext: "Supplier brief from APEAX USA parent office",
  },
  {
    title: "Regulatory gap: MMA mandated anti-graffiti window specs pending",
    description:
      "MMA (Metropolitan Melbourne Association of bus operators) flagged intent to introduce anti-graffiti specification requirements for all new fleet glass procurement by 2027. Creates R&D opportunity to develop ASI-branded spec sheets and pre-qualified product matrix. Could also drive a new GrafShield variant.",
    type: "regulatory_change",
    sourcedBy: "VANGUARD",
    sourceContext: "MMA member bulletin 2026-04-12",
  },
];

// ─── R&D Projects (examples) ─────────────────────────────────────────────

const SEED_PROJECTS = [
  {
    title: "GrafShield UV Degradation Study",
    shortDescription:
      "18-month accelerated UV exposure study of GrafShield samples vs competitor films to validate long-term performance claims and inform warranty terms.",
    phase: "feasibility",
    status: "active",
    priority: "high",
    domain: "product",
    leadAgent: "ARCHER",
    relatedProducts: ["grafshield"],
    modernisationPath:
      "Validate and extend APEAX film warranty claims with independent test data. Supports sales positioning and warranty underwriting.",
    estimatedBudget: 45000,
    targetCompletionDate: "2027-02-28",
    deliverables: [
      "Accelerated UV test report",
      "Field performance comparison dataset",
      "Updated warranty terms documentation",
      "Customer-facing test results summary",
    ],
    sourcedFrom: {
      type: "reactive",
      note: "Customer warranty question from McKenzie's prompted formal validation.",
    },
  },
  {
    title: "Fleet Telematics AI Pilot",
    shortDescription:
      "6-month pilot integrating Cipher's portal with fleet telematics to predict surface maintenance windows from vehicle usage patterns.",
    phase: "scoping",
    status: "active",
    priority: "medium",
    domain: "platform",
    leadAgent: "ARCHER",
    stakeholders: ["CIPHER", "VANGUARD"],
    modernisationPath:
      "Move from reactive service scheduling to predictive maintenance. First step in ASI becoming a data-driven fleet service partner rather than just a reactive supplier.",
    estimatedBudget: 80000,
    targetCompletionDate: "2026-11-30",
    deliverables: [
      "Telematics integration spec",
      "Prediction model prototype",
      "Pilot deployment at 2 client sites",
      "ROI assessment",
    ],
    sourcedFrom: {
      type: "gap_analysis",
      note: "Identified during Q1 2026 modernisation review as highest-leverage platform investment.",
    },
  },
  {
    title: "APEAX Installer Training Platform",
    shortDescription:
      "Build a digital training + certification platform for APEAX trade installers. Shifts installer onboarding from in-person to scalable digital delivery.",
    phase: "design",
    status: "active",
    priority: "high",
    domain: "capability",
    leadAgent: "ARCHER",
    stakeholders: ["SHIELD", "VESTA", "CIPHER"],
    relatedProducts: ["grafshield", "optishield", "paintshield"],
    modernisationPath:
      "Enables national trade channel scaling without linear staffing growth. Critical capability for distribution expansion.",
    estimatedBudget: 120000,
    targetCompletionDate: "2026-09-30",
    deliverables: [
      "Training module library (8 modules)",
      "Certification assessment system",
      "Installer progress tracking",
      "Integration with SHIELD's trade channel pipeline",
    ],
    sourcedFrom: {
      type: "management_meeting",
      note: "SHIELD's distribution strategy identified installer training as critical bottleneck.",
    },
  },
];

// ─── Grant Applications (examples, linked to projects after they're created) ─

const SEED_GRANT_APPLICATIONS = [
  {
    programmeName: "R&D Tax Incentive (RDTI)",
    programmeBody: "AusIndustry / ATO",
    roundName: "FY26 claim",
    stage: "scoping",
    fundingType: "tax_offset",
    awardValue: 55000,
    expectedDecisionDate: "2026-10-31",
    notes:
      "Annual RDTI claim covering GrafShield UV study + Fleet Telematics AI pilot. Draft preparation Q3 2026, registration by 31 October 2026.",
  },
  {
    programmeName: "Export Market Development Grants (EMDG)",
    programmeBody: "Austrade",
    roundName: "Tier 1 — FY26",
    stage: "scoping",
    fundingType: "grant",
    awardValue: 30000,
    notes:
      "Initial EMDG application to support APEAX distribution market development. First-time applicant — Tier 1. Needs ~6 weeks prep time.",
  },
];

// ─── POST handler ────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const db = admin.firestore();
    const userSnap = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    const user = userSnap.data() as { role?: string } | undefined;
    if (user?.role !== "admin") {
      return NextResponse.json({ error: "Admin only." }, { status: 403 });
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const nowIso = new Date().toISOString();
    const created = { programmes: 0, opportunities: 0, projects: 0, grants: 0 };
    const skipped = { programmes: 0, opportunities: 0, projects: 0, grants: 0 };

    // ── Programmes ─────────────────────────────────────────────────────
    for (const p of SEED_PROGRAMMES) {
      const existing = await db.collection(COLLECTIONS.RND_GRANT_PROGRAMMES)
        .where("programmeName", "==", p.programmeName)
        .limit(1)
        .get();
      if (!existing.empty) { skipped.programmes++; continue; }

      await db.collection(COLLECTIONS.RND_GRANT_PROGRAMMES).add({
        ...p,
        isActive: true,
        createdAt: now,
        createdBy: "ARCHER",
        updatedAt: now,
      });
      created.programmes++;
    }

    // ── Opportunities ──────────────────────────────────────────────────
    for (const o of SEED_OPPORTUNITIES) {
      const existing = await db.collection(COLLECTIONS.RND_OPPORTUNITY_LOG)
        .where("title", "==", o.title)
        .limit(1)
        .get();
      if (!existing.empty) { skipped.opportunities++; continue; }

      const opportunityNumber = await nextRndCounter(db, "OPP");
      await db.collection(COLLECTIONS.RND_OPPORTUNITY_LOG).add({
        opportunityNumber,
        ...o,
        status: "new",
        createdAt: now,
        createdBy: o.sourcedBy,
        updatedAt: now,
      });
      created.opportunities++;
    }

    // ── Projects ───────────────────────────────────────────────────────
    const createdProjectIds: Record<string, string> = {};
    for (const p of SEED_PROJECTS) {
      const existing = await db.collection(COLLECTIONS.RND_PROJECTS)
        .where("title", "==", p.title)
        .limit(1)
        .get();
      if (!existing.empty) {
        skipped.projects++;
        createdProjectIds[p.title] = existing.docs[0].id;
        continue;
      }

      const projectNumber = await nextRndCounter(db, "RND");
      const requiresDirectorApproval = p.estimatedBudget > 50000;

      const ref = await db.collection(COLLECTIONS.RND_PROJECTS).add({
        projectNumber,
        ...p,
        actualSpendToDate: 0,
        fundingSources: [],
        approvals: {
          athena: { decision: "pending", approver: "ATHENA" },
          director: { decision: "pending", approver: "DIRECTOR" },
        },
        requiresDirectorApproval,
        kpis: [],
        risks: [],
        imsDocumentIds: [],
        statusLog: [{
          phase: p.phase,
          status: p.status,
          changedAt: nowIso,
          changedBy: "ARCHER",
          note: "Project seeded",
        }],
        createdAt: now,
        createdBy: "ARCHER",
        updatedAt: now,
      });

      createdProjectIds[p.title] = ref.id;
      created.projects++;
    }

    // ── Grant Applications (linked to projects) ────────────────────────
    for (const g of SEED_GRANT_APPLICATIONS) {
      const existing = await db.collection(COLLECTIONS.GRANT_APPLICATIONS)
        .where("programmeName", "==", g.programmeName)
        .where("roundName", "==", g.roundName)
        .limit(1)
        .get();
      if (!existing.empty) { skipped.grants++; continue; }

      const grantNumber = await nextRndCounter(db, "GRT");

      // Link RDTI to both active R&D projects as an example
      const linkedRndProjectIds = g.programmeName.includes("RDTI")
        ? Object.values(createdProjectIds).filter(Boolean)
        : [];

      await db.collection(COLLECTIONS.GRANT_APPLICATIONS).add({
        grantNumber,
        ...g,
        linkedRndProjectIds,
        requirements: [],
        internalApprovals: {
          athena: { decision: "pending", approver: "ATHENA" },
          director: { decision: "pending", approver: "DIRECTOR" },
        },
        draftDocumentIds: [],
        submittedDocumentIds: [],
        compliance: { reportsRequired: [], milestonesRequired: [] },
        statusLog: [{
          stage: g.stage,
          changedAt: nowIso,
          changedBy: "ARCHER",
          note: "Grant application seeded",
        }],
        createdAt: now,
        createdBy: "ARCHER",
        updatedAt: now,
      });
      created.grants++;
    }

    return NextResponse.json({ ok: true, created, skipped });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Seed failed." },
      { status: 400 }
    );
  }
}

async function nextRndCounter(
  db: admin.firestore.Firestore,
  prefix: "RND" | "GRT" | "OPP"
): Promise<string> {
  const year = new Date().getFullYear();
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
