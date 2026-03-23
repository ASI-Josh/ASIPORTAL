/**
 * POST /api/leads/seed
 * Admin-only. Seeds the 8 initial OSINT leads from the 2026-03-23 opportunity matrix.
 * Safe to call multiple times — skips existing leads by company name.
 */
import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";

const SEED_LEADS = [
  {
    company: "Transdev Victoria",
    sector: "mass-transit",
    pipeline_stage: 1,
    bant_score: 85,
    bant_breakdown: { budget: 15, authority: 10, need: 25, timing: 20, fit: 15 },
    lead_grade: "A",
    existingOrganizationId: null,
    isExistingClient: false,
    source: { type: "osint", osint_scan_date: "2026-03-23", finding: "Victoria Mandates All New Buses Zero-Emission from July 2025", pillar: "bus-coach", relevance_score: 5 },
    pain_points: ["4,500 bus fleet transition to ZEB", "New buses need surface protection from Day 1", "Existing diesel fleet needs maintenance during transition"],
    asi_solution_fit: ["HydroGuard coating for new ZEB fleet", "GrafShield anti-graffiti for depot-based buses", "Glass remediation for ageing diesel fleet during transition"],
    estimated_services: ["HydroGuard", "GrafShield"],
    recommended_sequence: "A",
    next_action: "Research Fleet Maintenance Manager contact via LinkedIn and Transdev website",
    follow_up_date: "2026-03-24",
    notes: "VIC mandate active since Jul 2025. Transdev operates ~1,200 buses across Melbourne. Significant HydroGuard opportunity at depot level. Contact title: Fleet Maintenance Manager / Operations Director.",
    tags: ["osint", "zeb", "urgent", "vic-mandate"],
    market_mode: "growth",
  },
  {
    company: "Kinetic Group Australia",
    sector: "mass-transit",
    pipeline_stage: 1,
    bant_score: 80,
    bant_breakdown: { budget: 15, authority: 10, need: 20, timing: 20, fit: 15 },
    lead_grade: "A",
    existingOrganizationId: null,
    isExistingClient: false,
    source: { type: "osint", osint_scan_date: "2026-03-23", finding: "Victoria Mandates All New Buses Zero-Emission from July 2025", pillar: "bus-coach", relevance_score: 5 },
    pain_points: ["Large fleet transition to ZEB across multiple states", "Depot-level surface maintenance scaling challenge", "Cost pressure from fleet transition capex"],
    asi_solution_fit: ["HydroGuard nano-coating programme at depot scale", "GrafShield anti-graffiti for high-traffic routes", "ASIPortal digital QA reporting for fleet compliance"],
    estimated_services: ["HydroGuard", "GrafShield", "ASIPortal QA"],
    recommended_sequence: "A",
    next_action: "Research Kinetic Group Fleet/Operations leadership via LinkedIn",
    follow_up_date: "2026-03-25",
    notes: "Formerly Ventura Bus Lines, now Kinetic. One of Australia's largest private bus operators. Multi-state presence. High-volume HydroGuard opportunity. Target: National Fleet Manager or Head of Maintenance.",
    tags: ["osint", "zeb", "urgent"],
    market_mode: "growth",
  },
  {
    company: "Volgren Australia",
    sector: "manufacturing",
    pipeline_stage: 1,
    bant_score: 75,
    bant_breakdown: { budget: 15, authority: 15, need: 20, timing: 15, fit: 10 },
    lead_grade: "B",
    existingOrganizationId: null,
    isExistingClient: false,
    source: { type: "osint", osint_scan_date: "2026-03-23", finding: "Volgren delivering 630 ZEBs by end of 2026", pillar: "bus-coach", relevance_score: 4 },
    pain_points: ["630 ZEB build programme — glass protection at build stage", "Customer warranty pressure for surface quality", "Increasing OEM specification requirements"],
    asi_solution_fit: ["OEM glass protection integration at Volgren factory", "HydroGuard applied pre-delivery to all ZEBs", "APEAX film for surface protection during delivery logistics"],
    estimated_services: ["HydroGuard OEM", "APEAX"],
    recommended_sequence: "A",
    next_action: "Research Volgren production/quality management team — approach with OEM partnership proposal",
    follow_up_date: "2026-03-27",
    notes: "Australia's largest bus body builder. 630 ZEB delivery target by end 2026 creates OEM integration opportunity. Target: Production Manager, Quality Assurance Manager, or MD. HQ: Dandenong, VIC.",
    tags: ["osint", "oem", "manufacturing", "zeb"],
    market_mode: "growth",
  },
  {
    company: "Foton Mobility Australia",
    sector: "manufacturing",
    pipeline_stage: 1,
    bant_score: 70,
    bant_breakdown: { budget: 10, authority: 15, need: 20, timing: 15, fit: 10 },
    lead_grade: "B",
    existingOrganizationId: null,
    isExistingClient: false,
    source: { type: "osint", osint_scan_date: "2026-03-23", finding: "NSW zero-emission bus strategy targets 8,000+ fleet by 2035", pillar: "bus-coach", relevance_score: 5 },
    pain_points: ["Rapid Australian market expansion for ZEB range", "Glass quality and protection standards to meet Australian spec", "Building local service relationships for warranty support"],
    asi_solution_fit: ["Pre-delivery glass protection for Australian ZEB deliveries", "Surface remediation partnership for warranty returns", "ASIPortal QA documentation for compliance"],
    estimated_services: ["HydroGuard", "APEAX", "Glass Remediation"],
    recommended_sequence: "A",
    next_action: "Research Foton Mobility Australia leadership — approach as preferred glass services partner",
    follow_up_date: "2026-03-28",
    notes: "Chinese ZEB manufacturer expanding rapidly in Australian market. Competing with Volgren locally. Local office in NSW. Need glass protection embedded in Australian delivery process.",
    tags: ["osint", "zeb", "manufacturing"],
    market_mode: "growth",
  },
  {
    company: "Transport for NSW (Region 6)",
    sector: "mass-transit",
    pipeline_stage: 1,
    bant_score: 65,
    bant_breakdown: { budget: 15, authority: 5, need: 20, timing: 15, fit: 10 },
    lead_grade: "B",
    existingOrganizationId: null,
    isExistingClient: false,
    source: { type: "osint", osint_scan_date: "2026-03-23", finding: "NSW Region 6 bus contract renewal process opens June 2026", pillar: "bus-coach", relevance_score: 4 },
    pain_points: ["Region 6 contract renewal creates fleet refresh opportunity", "Tender requirements increasingly include sustainability criteria", "Operator transition requires new surface protection specs"],
    asi_solution_fit: ["Glass life-extension services embedded in Region 6 tender spec", "ASIPortal QA compliance reporting for tender documentation", "HydroGuard and GrafShield as standard fleet protection"],
    estimated_services: ["HydroGuard", "GrafShield", "ASIPortal QA"],
    recommended_sequence: "A",
    next_action: "Monitor TfNSW procurement portal — register as supplier. Identify which operators are bidding for Region 6.",
    follow_up_date: "2026-04-01",
    notes: "Region 6 covers Hunter and Newcastle. Contract renewal process opens June 2026. Strategy: approach operators bidding for the contract, not TfNSW directly. Key operators to watch: CDC, Busways.",
    tags: ["osint", "tender", "nsw"],
    market_mode: "growth",
  },
  {
    company: "McKenzie's Tourist Services Pty Ltd",
    sector: "mass-transit",
    pipeline_stage: 2,
    bant_score: 85,
    bant_breakdown: { budget: 20, authority: 20, need: 20, timing: 15, fit: 10 },
    lead_grade: "A",
    existingOrganizationId: "org-mckenzies",
    isExistingClient: true,
    source: { type: "osint", osint_scan_date: "2026-03-23", finding: "Victoria ZEB mandate and Volgren ZEB deliveries create fleet protection upsell", pillar: "bus-coach", relevance_score: 5 },
    pain_points: ["Existing fleet may lack HydroGuard protection", "ZEB transition creates new glass protection requirements", "Need to document glass maintenance for ESG/sustainability reporting"],
    asi_solution_fit: ["HydroGuard upsell across existing McKenzie's fleet", "APEAX windscreen film for tourist coaches", "OptiShield for premium passenger experience"],
    estimated_services: ["HydroGuard", "APEAX", "OptiShield"],
    recommended_sequence: "A",
    next_action: "Review existing McKenzie's jobs in portal — identify which vehicles haven't received HydroGuard. Reach out to Adrian for upsell conversation.",
    follow_up_date: "2026-03-24",
    notes: "EXISTING CLIENT. Currently receiving scratch/graffiti removal and film installation services. Upsell opportunity: HydroGuard fleet-wide coating programme. High BANT score due to existing relationship and known budget. Revenue currently $31,618.",
    tags: ["existing-client", "upsell", "osint"],
    market_mode: "growth",
  },
  {
    company: "Budget Bus Charters Melbourne Pty Ltd",
    sector: "mass-transit",
    pipeline_stage: 2,
    bant_score: 80,
    bant_breakdown: { budget: 15, authority: 20, need: 20, timing: 15, fit: 10 },
    lead_grade: "A",
    existingOrganizationId: "HxWV45fh0r16Y1iY1Uwb",
    isExistingClient: true,
    source: { type: "osint", osint_scan_date: "2026-03-23", finding: "Victoria ZEB mandate creates fleet protection upsell for existing clients", pillar: "bus-coach", relevance_score: 5 },
    pain_points: ["Smaller operator with limited maintenance budget — needs cost-effective fleet protection", "VIC ZEB mandate affecting fleet planning", "Glass maintenance costs increasing with older diesel fleet"],
    asi_solution_fit: ["HydroGuard to reduce glass maintenance costs", "GrafShield for anti-graffiti protection", "Remediation over replacement to extend diesel fleet life during ZEB transition"],
    estimated_services: ["HydroGuard", "GrafShield", "Glass Remediation"],
    recommended_sequence: "B",
    next_action: "Review Budget Bus job history — identify last service date and upsell opportunity. Schedule follow-up call.",
    follow_up_date: "2026-03-26",
    notes: "EXISTING CLIENT. Revenue currently $1,308. Small operator — use Sequence B (Direct) with clear ROI focus. HydroGuard ROI message: 22% maintenance cost reduction over 24 months.",
    tags: ["existing-client", "upsell", "osint"],
    market_mode: "neutral",
  },
  {
    company: "CRL / Pro Installer Network (HydroGuard Validation)",
    sector: "wholesale-trade",
    pipeline_stage: 1,
    bant_score: 50,
    bant_breakdown: { budget: 10, authority: 10, need: 15, timing: 10, fit: 5 },
    lead_grade: "C",
    existingOrganizationId: null,
    isExistingClient: false,
    source: { type: "osint", osint_scan_date: "2026-03-23", finding: "Hydrophobic coatings confirmed at 22% maintenance cost reduction", pillar: "fleet-maintenance", relevance_score: 5 },
    pain_points: ["Validation data for HydroGuard ROI claims needed", "Partner installer network needs to demonstrate measurable outcomes", "Competitive differentiation in crowded installer market"],
    asi_solution_fit: ["HydroGuard dealer/installer partner programme", "APEAX film distribution partnership", "Training and QA support for partner installers"],
    estimated_services: ["HydroGuard Partner", "APEAX Partner"],
    recommended_sequence: "C",
    next_action: "Identify top 3-5 installer businesses in Melbourne and Sydney for partner programme outreach",
    follow_up_date: "2026-04-01",
    notes: "Nurture-class lead. Use HydroGuard 22% maintenance cost data as lead magnet for installer partner outreach. Sequence C (Partnership model) — offer margin opportunity and training support.",
    tags: ["osint", "wholesale", "partner-programme"],
    market_mode: "growth",
  },
];

function calcGrade(s: number): string {
  if (s >= 80) return "A"; if (s >= 65) return "B"; if (s >= 50) return "C"; if (s >= 35) return "D"; return "E";
}

async function nextLeadNumber(db: FirebaseFirestore.Firestore): Promise<string> {
  const year = new Date().getFullYear();
  const counterRef = db.collection("counters").doc("leads");
  let num = 1;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const data = snap.data() as { seq?: number; year?: number } | undefined;
    if (!snap.exists || data?.year !== year) { tx.set(counterRef, { seq: 1, year }); num = 1; }
    else { num = (data?.seq || 0) + 1; tx.update(counterRef, { seq: num }); }
  });
  return `LD-${year}-${String(num).padStart(4, "0")}`;
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const db = admin.firestore();
    const userSnap = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    const user = userSnap.data() as { role?: string } | undefined;
    if (user?.role !== "admin") return NextResponse.json({ error: "Admin only." }, { status: 403 });

    const now = admin.firestore.FieldValue.serverTimestamp();
    let created = 0, skipped = 0;

    for (const seed of SEED_LEADS) {
      const existing = await db.collection(COLLECTIONS.LEADS)
        .where("companyName", "==", seed.company)
        .limit(5).get();
      const activeExisting = existing.docs.filter((d) => !d.data().isDeleted);
      if (activeExisting.length > 0) { skipped++; continue; }

      const leadNumber = await nextLeadNumber(db);
      const stageMap: Record<number, string> = { 1:"identified",2:"researched",3:"contacted",4:"engaged",5:"qualified",6:"proposal_sent",7:"negotiation",8:"won",9:"lost",10:"nurture" };
      const stage = stageMap[seed.pipeline_stage] || "identified";
      const bantBreakdown = seed.bant_breakdown;
      const bantScore = seed.bant_score;
      const leadGrade = seed.lead_grade || calcGrade(bantScore);

      await db.collection(COLLECTIONS.LEADS).add({
        leadNumber, companyName: seed.company, sector: seed.sector,
        existingOrganizationId: seed.existingOrganizationId || null,
        isExistingClient: seed.isExistingClient || false,
        contacts: [], bantScore, bantBreakdown, leadGrade, stage,
        stageHistory: [], stageEnteredAt: new Date().toISOString(),
        source: { type: seed.source.type, osintScanDate: seed.source.osint_scan_date,
          osintFinding: seed.source.finding, osintPillar: seed.source.pillar,
          osintRelevanceScore: seed.source.relevance_score },
        estimatedServices: seed.estimated_services || [],
        painPoints: seed.pain_points || [],
        asiSolutionFit: seed.asi_solution_fit || [],
        outreachSequence: seed.recommended_sequence || null,
        outreachStatus: { linkedInConnected:false, linkedInMessageSent:false, emailsSent:0, responseReceived:false, meetingScheduled:false },
        outreachHistory: [], marketMode: seed.market_mode,
        nextAction: seed.next_action, nextActionDate: seed.follow_up_date,
        notes: seed.notes, tags: seed.tags,
        createdAt: now, updatedAt: now, createdBy: userId, isDeleted: false,
      });
      created++;
    }

    return NextResponse.json({ created, skipped, total: SEED_LEADS.length });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Seed failed." }, { status: 400 });
  }
}
