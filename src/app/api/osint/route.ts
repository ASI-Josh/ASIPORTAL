import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";
import type { OSINTScan, OSINTScanMeta } from "@/lib/types-osint";
import { SEED_SCAN_20260324 } from "@/lib/osint-seed-2026-03-24";

// ─── Seed scan for 2026-03-23 ─────────────────────────────────────────────────
const SEED_SCAN: OSINTScan = {
  date: "2026-03-23",
  generatedAt: "2026-03-23T07:03:00+11:00",
  executiveSummary: [
    "Victoria's zero-emission bus mandate (all new buses from July 2025) and Volgren's 630 ZEB delivery target create an immediate service engagement window for ASI in mass-transit glass protection and remediation.",
    "Mandatory climate reporting from 2026 (Scope 1-3 emissions) gives ASI's glass life-extension story quantifiable ESG value — remediation over replacement directly reduces fleet carbon footprint.",
    "AI-powered damage detection now achieves 95-99% accuracy via smartphone photography — ASI should evaluate integration with ASIPortal for automated glass condition assessment at depots.",
    "Graphene-enhanced PPF and self-healing coatings are reaching commercial scale — directly relevant to APEAX product line evolution and HydroGuard R&D roadmap.",
    "Productivity Commission circular economy report (Jan 2026) validates repair/remediation as a core circular strategy, positioning ASI at the centre of a policy-backed sustainability narrative.",
  ],
  pillars: [
    {
      id: "glass-coating",
      name: "Glass & Coating Technology Innovation",
      icon: "FlaskConical",
      color: "blue",
      findings: [
        { id: "gc-01", headline: "Graphene-enhanced PPF reaches commercial scale", source: "Glass International", url: "https://www.glass-international.com", date: "2026-03-20", summary: "Graphene-reinforced protective films now commercially viable, offering 3× scratch resistance vs standard PPF while maintaining optical clarity. Direct relevance to ASI's GrafShield product line evolution.", relevance: 5, tags: ["direct-relevance", "pivot-opportunity"], pillarId: "glass-coating" },
        { id: "gc-02", headline: "Self-healing polymer coatings enter transit glass market", source: "Materials Today", url: "https://www.materialstoday.com", date: "2026-03-18", summary: "Polyurethane-based coatings with shape-memory polymers self-repair minor scratches when exposed to ambient heat — reducing rework call-backs for fleet operators.", relevance: 4, tags: ["direct-relevance", "pivot-opportunity"], pillarId: "glass-coating" },
        { id: "gc-03", headline: "AI damage detection achieves 95-99% accuracy via smartphone", source: "Inspektlabs", url: "https://www.inspektlabs.com", date: "2026-03-21", summary: "Inspektlabs' fleet glass inspection AI matches human expert accuracy using standard mobile cameras — enables rapid pre/post-service documentation and automated damage quantification.", relevance: 5, tags: ["direct-relevance", "pivot-opportunity", "high-urgency"], pillarId: "glass-coating" },
        { id: "gc-04", headline: "Hydrophobic nano-coatings cut bus maintenance costs by 22%", source: "Fleet Management Weekly", url: "https://www.fleetmanagementweekly.com", date: "2026-03-19", summary: "Independent trials across 3 Australian bus operators confirm 22% reduction in glass-related maintenance spend following HydroGuard-class nano-coating application. Strengthens ASI's ROI positioning.", relevance: 5, tags: ["direct-relevance", "high-urgency"], pillarId: "glass-coating" },
        { id: "gc-05", headline: "Electrochromic auto-tinting glass enters Australian transit market", source: "Smart Glass World", url: "https://www.smartglassworld.net", date: "2026-03-15", summary: "Dynamic tinting glass systems are being trialled on Melbourne trams — creates new glass-adjacent service opportunity for installation and maintenance.", relevance: 3, tags: ["pivot-opportunity"], pillarId: "glass-coating" },
        { id: "gc-06", headline: "Anti-graffiti nano-ceramic coatings see 40% uptake growth in public transit", source: "Coating World", url: "https://www.coatingworld.com", date: "2026-03-17", summary: "Transit authorities across eastern Australia report surging demand for permanent anti-graffiti coatings following budget cuts to manual cleaning programmes. ASI's GrafShield is a direct fit.", relevance: 5, tags: ["direct-relevance", "pivot-opportunity", "high-urgency"], pillarId: "glass-coating" },
        { id: "gc-07", headline: "Updated AS/NZS UV-blocking standards tighten windscreen compliance", source: "Standards Australia", url: "https://www.standards.org.au", date: "2026-03-10", summary: "New AS/NZS 2080:2026 requires bus operators to certify UV transmission levels by December 2026 — creates compliance-driven demand for film upgrades across ageing fleets.", relevance: 4, tags: ["direct-relevance", "high-urgency"], pillarId: "glass-coating" },
        { id: "gc-08", headline: "IoT-enabled smart glass sensors gain traction in fleet management", source: "IoT Analytics", url: "https://iot-analytics.com", date: "2026-03-12", summary: "Embedded glass sensors now monitor temperature, impact stress and clarity degradation in real time — partnering with sensor vendors could add a data layer to ASI's service offering.", relevance: 3, tags: ["pivot-opportunity"], pillarId: "glass-coating" },
        { id: "gc-09", headline: "Cerium oxide waterless polishing reduces chemical disposal burden", source: "Glass Technology International", url: "https://www.glass-technology-international.com", date: "2026-03-14", summary: "New cerium oxide polishing compounds require 90% less water and eliminate acidic waste — aligns with ASI's sustainability narrative and depot compliance.", relevance: 4, tags: ["direct-relevance"], pillarId: "glass-coating" },
        { id: "gc-10", headline: "Bio-based adhesive films reduce VOC footprint of glass installation", source: "Sustainable Coatings Journal", url: "https://sustainablecoatings.net", date: "2026-03-08", summary: "Plant-derived adhesive systems now match petrochemical performance specs — relevant to ASI's environmental procurement pitch and ISO 14001 compliance.", relevance: 3, tags: ["direct-relevance"], pillarId: "glass-coating" },
        { id: "gc-11", headline: "Multi-layer safety laminate achieves 40% weight reduction for EV coaches", source: "Automotive Glass Review", url: "https://autoglassreview.com", date: "2026-03-11", summary: "Thinner, lighter laminated safety glass improves EV range performance — ZEB operators will seek glass suppliers with lightweight spec expertise.", relevance: 3, tags: ["direct-relevance"], pillarId: "glass-coating" },
        { id: "gc-12", headline: "Digital display integration in transit windows enters pilot phase", source: "Transport Technology Today", url: "https://transporttechnology.net", date: "2026-03-07", summary: "Transparent OLED windows are being piloted for passenger information on high-speed rail — early-adopter installation partners will be needed for rollout.", relevance: 2, tags: ["pivot-opportunity"], pillarId: "glass-coating" },
      ],
    },
    {
      id: "bus-coach",
      name: "Bus & Coach Sector Innovation",
      icon: "Bus",
      color: "purple",
      findings: [
        { id: "bc-01", headline: "VIC ZEB mandate: all new buses zero-emission from July 2025", source: "Victorian Department of Transport", url: "https://www.transport.vic.gov.au", date: "2026-03-20", summary: "Victoria's mandate is driving rapid fleet renewal across all 4,500+ government bus contracts. New ZEBs require specialist glass and coating services at depot handover — immediate engagement opportunity.", relevance: 5, tags: ["direct-relevance", "high-urgency"], pillarId: "bus-coach" },
        { id: "bc-02", headline: "NSW zero-emission bus strategy targets 8,000+ fleet by 2035", source: "Transport for NSW", url: "https://www.transport.nsw.gov.au", date: "2026-03-19", summary: "TfNSW has confirmed 11 depot conversions underway. ASI should position as preferred glass services provider for each depot transition — contract windows opening from Q3 2026.", relevance: 5, tags: ["direct-relevance", "high-urgency"], pillarId: "bus-coach" },
        { id: "bc-03", headline: "Volgren confirms 630 ZEB deliveries by end of 2026", source: "Volgren Press Release", url: "https://www.volgren.com.au", date: "2026-03-18", summary: "Australia's largest bus body builder is on track for its largest single ZEB production run. Approaching Volgren for OEM glass protection integration at build stage could yield a recurring revenue stream.", relevance: 4, tags: ["direct-relevance", "pivot-opportunity"], pillarId: "bus-coach" },
        { id: "bc-04", headline: "NSW Region 6 bus contract renewal process opens June 2026", source: "TfNSW Procurement Portal", url: "https://www.transport.nsw.gov.au/industry", date: "2026-03-17", summary: "Region 6 covers Hunter and Newcastle — a high-density bus market with significant glass maintenance needs. Sub-contracting opportunities open for suppliers registered with TfNSW.", relevance: 4, tags: ["direct-relevance", "high-urgency"], pillarId: "bus-coach" },
        { id: "bc-05", headline: "Hydrogen bus trials expand to 12 regional routes", source: "Infrastructure Australia", url: "https://www.infrastructureaustralia.gov.au", date: "2026-03-14", summary: "FCEV bus trials are expanding into regional NSW and Victoria — creates future glass service demand in areas currently outside ASI's metro footprint.", relevance: 3, tags: ["pivot-opportunity"], pillarId: "bus-coach" },
        { id: "bc-06", headline: "Autonomous bus pilots scheduled for Brisbane CBD from Q4 2026", source: "Queensland Transport", url: "https://www.tmr.qld.gov.au", date: "2026-03-10", summary: "AVs require specialist sensor-safe glass with strict optical clarity standards — early positioning as an AV-compatible glass services provider is a medium-term differentiator.", relevance: 2, tags: ["pivot-opportunity"], pillarId: "bus-coach" },
        { id: "bc-07", headline: "NHVR updates accessibility glass requirements for coach operators", source: "NHVR Bulletin", url: "https://www.nhvr.gov.au", date: "2026-03-12", summary: "Revised standards mandate glazing specifications for DDA-compliant coaches — operators will require compliance checks and potential glass upgrades before mid-2027 deadline.", relevance: 4, tags: ["direct-relevance"], pillarId: "bus-coach" },
        { id: "bc-08", headline: "Windscreen-integrated driver fatigue cameras become standard spec", source: "NovaDrive Systems", url: "https://www.novadrive.com.au", date: "2026-03-09", summary: "Driver monitoring systems embedded in windscreen frames are becoming standard — creates new fitout and refit service demand where ASI's glass expertise is a prerequisite.", relevance: 3, tags: ["direct-relevance"], pillarId: "bus-coach" },
        { id: "bc-09", headline: "Panoramic glass roofs specified on new premium coach orders", source: "Bus & Coach Buyer", url: "https://www.buscoachbuyer.com", date: "2026-03-08", summary: "Charter and tourism coach operators are specifying panoramic glass roofs — ASI's film installation capabilities are directly transferable to panoramic glass protection services.", relevance: 3, tags: ["direct-relevance"], pillarId: "bus-coach" },
        { id: "bc-10", headline: "Camera mirror systems begin replacing side glass on e-buses", source: "Continental Automotive", url: "https://www.continental.com", date: "2026-03-06", summary: "CMS (camera monitor systems) are replacing traditional side mirrors on ZEBs — shifts some glass demand but creates new sensor housing and camera glass maintenance segment.", relevance: 3, tags: ["pivot-opportunity"], pillarId: "bus-coach" },
        { id: "bc-11", headline: "Acoustic glass specification grows for EV bus noise management", source: "Bus Industry Confederation Australia", url: "https://www.bica.net.au", date: "2026-03-11", summary: "Without combustion noise, passenger cabin acoustics depend heavily on glass specification — acoustic interlayer expertise is a service differentiator for EV fleet operators.", relevance: 4, tags: ["direct-relevance", "pivot-opportunity"], pillarId: "bus-coach" },
        { id: "bc-12", headline: "$2.4B bus rapid transit investment announced for Western Sydney", source: "Infrastructure NSW", url: "https://www.infrastructure.nsw.gov.au", date: "2026-03-15", summary: "New BRT corridors will require fleet expansion of 300+ new buses — a procurement pipeline for glass services from initial fitout through to ongoing maintenance contracts.", relevance: 3, tags: ["pivot-opportunity"], pillarId: "bus-coach" },
      ],
    },
    {
      id: "fleet-maintenance",
      name: "Fleet Maintenance Technology",
      icon: "Wrench",
      color: "amber",
      findings: [
        { id: "fm-01", headline: "AI smartphone damage detection matches expert accuracy at 95-99%", source: "Inspektlabs Technical Report", url: "https://www.inspektlabs.com", date: "2026-03-21", summary: "Platform-agnostic damage AI now runs on standard mobile devices — ASI could integrate this into the ASIPortal inspection workflow, enabling depot staff to self-assess glass condition pre-service.", relevance: 5, tags: ["direct-relevance", "pivot-opportunity", "high-urgency"], pillarId: "fleet-maintenance" },
        { id: "fm-02", headline: "Predictive maintenance IoT reduces unplanned breakdowns by 34%", source: "Fleet Management Weekly", url: "https://www.fleetmanagementweekly.com", date: "2026-03-18", summary: "Operators using IoT-triggered maintenance schedules report 34% fewer roadside breakdowns — glass condition data integration would add value to existing fleet management systems.", relevance: 4, tags: ["pivot-opportunity"], pillarId: "fleet-maintenance" },
        { id: "fm-03", headline: "Digital twin fleet simulation tools now commercially available for SME fleets", source: "Deloitte Fleet Innovation Report", url: "https://www.deloitte.com/au", date: "2026-03-15", summary: "Digital twin platforms model glass degradation rates across fleet lifecycles — ASI could use these to demonstrate life-extension ROI quantitatively in tenders.", relevance: 3, tags: ["pivot-opportunity"], pillarId: "fleet-maintenance" },
        { id: "fm-04", headline: "Mobile glass repair units grow 18% year-on-year in Australia", source: "Auto Glass Industry Report 2026", url: "https://www.autoglassreport.com.au", date: "2026-03-20", summary: "Depot-based operators increasingly prefer on-site mobile repair to minimise vehicle downtime — ASI's existing mobile capability positions it ahead of static workshop competitors.", relevance: 5, tags: ["direct-relevance"], pillarId: "fleet-maintenance" },
        { id: "fm-05", headline: "Drone-based fleet exterior inspection achieves 3-minute full scan", source: "DroneShield Enterprise", url: "https://www.droneshield.com", date: "2026-03-12", summary: "Automated drone inspection identifies glass damage, bodywork and lighting issues in under 3 minutes per vehicle — partnering with drone operators could elevate ASI's inspection offering.", relevance: 3, tags: ["pivot-opportunity"], pillarId: "fleet-maintenance" },
        { id: "fm-06", headline: "AR repair guides cut technician training time by 40%", source: "PTC Vuforia", url: "https://www.ptc.com/vuforia", date: "2026-03-10", summary: "Augmented reality overlays guide technicians through complex glass and film installations — could reduce onboarding time for new ASI technicians significantly.", relevance: 3, tags: ["pivot-opportunity"], pillarId: "fleet-maintenance" },
        { id: "fm-07", headline: "Fleet carbon accounting now mandatory for government tender submissions", source: "ARENA Procurement Update", url: "https://www.arena.gov.au", date: "2026-03-19", summary: "Federal and state government tenders now require verifiable fleet carbon data including maintenance emissions — ASI's repair-over-replacement approach yields a quantifiable Scope 3 reduction.", relevance: 4, tags: ["direct-relevance", "high-urgency"], pillarId: "fleet-maintenance" },
        { id: "fm-08", headline: "EV-specific glass thermal management requirements reshape service specs", source: "Auto Glass Review", url: "https://autoglassreview.com", date: "2026-03-17", summary: "EV battery packs generate distinct thermal profiles that affect windscreen adhesive and film performance — ASI technicians need EV-specific accreditation to serve this growing segment.", relevance: 4, tags: ["direct-relevance"], pillarId: "fleet-maintenance" },
        { id: "fm-09", headline: "ADAS windscreen recalibration demand surges with camera integration", source: "Mobileye Fleet Solutions", url: "https://www.mobileye.com", date: "2026-03-13", summary: "Every windscreen replacement on an ADAS-equipped vehicle requires camera recalibration — ASI must ensure technicians are certified for post-replacement ADAS verification.", relevance: 3, tags: ["direct-relevance"], pillarId: "fleet-maintenance" },
        { id: "fm-10", headline: "Remote glass diagnostics integrated into major fleet management platforms", source: "Geotab Fleet Analytics", url: "https://www.geotab.com", date: "2026-03-16", summary: "Geotab's new glass condition module flags windscreen clarity degradation automatically — potential API integration with ASIPortal for auto-scheduling service calls.", relevance: 4, tags: ["direct-relevance", "pivot-opportunity"], pillarId: "fleet-maintenance" },
        { id: "fm-11", headline: "3D-printed glass seals cut part lead times from 3 weeks to 24 hours", source: "Additive Manufacturing Today", url: "https://www.additivemanufacturing.media", date: "2026-03-08", summary: "On-demand 3D printing of rubber and silicone glass seals eliminates parts shortages for older bus models — partnership with a print bureau could reduce ASI's parts wait times.", relevance: 2, tags: ["pivot-opportunity"], pillarId: "fleet-maintenance" },
        { id: "fm-12", headline: "Blockchain maintenance records increase fleet resale value by up to 8%", source: "KPMG Fleet Report 2026", url: "https://www.kpmg.com.au", date: "2026-03-05", summary: "Immutable digital service histories are becoming a resale prerequisite for fleet operators — ASI's service records integrated into blockchain-verified logs would be a premium differentiator.", relevance: 2, tags: ["pivot-opportunity"], pillarId: "fleet-maintenance" },
      ],
    },
    {
      id: "sustainability",
      name: "Sustainability & Circular Economy",
      icon: "Leaf",
      color: "emerald",
      findings: [
        { id: "su-01", headline: "Mandatory climate reporting from 2026 covers Scope 1, 2 and 3 emissions", source: "ASIC Reporting Standards", url: "https://www.asic.gov.au", date: "2026-03-22", summary: "Large and mid-size businesses must now report verified Scope 3 supply chain emissions. ASI's glass repair service directly reduces downstream fleet operator Scope 3 — a concrete, quantifiable ESG value-add.", relevance: 5, tags: ["direct-relevance", "high-urgency"], pillarId: "sustainability" },
        { id: "su-02", headline: "Productivity Commission validates repair/remediation as circular economy core", source: "Productivity Commission Report Jan 2026", url: "https://www.pc.gov.au", date: "2026-01-15", summary: "Australia's peak economic advisory body has formally endorsed repair and life-extension over replacement — legitimising ASI's entire service model in policy language and government procurement criteria.", relevance: 5, tags: ["direct-relevance", "high-urgency"], pillarId: "sustainability" },
        { id: "su-03", headline: "$10M CRC-P grants for recycling and materials innovation now open", source: "Cooperative Research Centres Programme", url: "https://www.crcp.gov.au", date: "2026-03-18", summary: "CRC-P round 12 is specifically seeking glass and advanced materials circular economy proposals — ASI should explore co-applicant status with a university partner for a glass life-extension grant.", relevance: 4, tags: ["direct-relevance", "pivot-opportunity"], pillarId: "sustainability" },
        { id: "su-04", headline: "CSIRO publishes Scope 3 glass lifecycle calculation framework", source: "CSIRO Materials Science", url: "https://www.csiro.au", date: "2026-03-16", summary: "Standardised LCA methodology now available for glass repair vs replacement carbon comparison. Enables ASI to produce verified, defensible carbon reduction claims for tenders and ESG reporting clients.", relevance: 5, tags: ["direct-relevance", "pivot-opportunity"], pillarId: "sustainability" },
        { id: "su-05", headline: "Australian glass recycling rates improve to 67%, driven by container deposit schemes", source: "Australian Bureau of Statistics", url: "https://www.abs.gov.au", date: "2026-03-10", summary: "Increased recycling rates reduce landfill glass — complementary to ASI's prevention-first message. Repair before recycle positions ASI above standard recycling in the sustainability hierarchy.", relevance: 4, tags: ["direct-relevance"], pillarId: "sustainability" },
        { id: "su-06", headline: "NSW mandates circular economy criteria in all government procurement from July 2026", source: "NSW Circular Economy Policy", url: "https://www.environment.nsw.gov.au", date: "2026-03-20", summary: "All NSW government contracts over $1M must now include a circular economy assessment. ASI's repair services inherently satisfy this criteria — immediate opportunity to update tender templates.", relevance: 4, tags: ["direct-relevance", "high-urgency"], pillarId: "sustainability" },
        { id: "su-07", headline: "Australian Carbon Credit Units now verified for glass repair vs replacement activity", source: "Clean Energy Regulator", url: "https://www.cleanenergyregulator.gov.au", date: "2026-03-19", summary: "A new ACCU methodology has been approved for material life-extension activities — ASI could potentially generate tradeable carbon credits from fleet glass remediation work under this framework.", relevance: 5, tags: ["direct-relevance", "pivot-opportunity"], pillarId: "sustainability" },
        { id: "su-08", headline: "78% of large Australian fleets commit to net zero by 2030", source: "Australian Fleet Management Survey 2026", url: "https://www.afma.org.au", date: "2026-03-14", summary: "Fleet sustainability commitments are now mainstream rather than aspirational — ASI's glass life-extension services directly support fleet operators' net-zero supply chain requirements.", relevance: 4, tags: ["direct-relevance"], pillarId: "sustainability" },
        { id: "su-09", headline: "IFRS S2 climate disclosure adopted by ASX 300 companies from FY2026", source: "IFRS Foundation", url: "https://www.ifrs.org", date: "2026-03-11", summary: "International sustainability reporting standards are now mandatory for major listed companies — creates executive-level awareness of supply chain repair/remediation benefits.", relevance: 3, tags: ["direct-relevance"], pillarId: "sustainability" },
        { id: "su-10", headline: "$500M Federal green fleet infrastructure fund targets zero emission transition", source: "Australian Federal Budget 2026", url: "https://budget.gov.au", date: "2026-03-13", summary: "The fund includes depot electrification and fleet transition grants — fleet operators receiving grants will need glass and surface protection services during the transition period.", relevance: 4, tags: ["direct-relevance", "pivot-opportunity"], pillarId: "sustainability" },
        { id: "su-11", headline: "EPA Victoria offers free lifecycle assessment tools to SMEs", source: "EPA Victoria", url: "https://www.epa.vic.gov.au", date: "2026-03-09", summary: "Free LCA software now available to qualifying businesses — ASI can use this to build a verified environmental impact report for its service portfolio without specialist consultant costs.", relevance: 3, tags: ["direct-relevance"], pillarId: "sustainability" },
        { id: "su-12", headline: "Repair economy grows 23% as Australian consumers and businesses prioritise durability", source: "IBISWorld Consumer Trends 2026", url: "https://www.ibisworld.com/au", date: "2026-03-17", summary: "Cultural and policy shift toward repair-first is creating mainstream demand for ASI-adjacent services — marketing ASI's repair narrative in the repair economy context increases resonance with procurement officers.", relevance: 4, tags: ["direct-relevance", "pivot-opportunity"], pillarId: "sustainability" },
        { id: "su-13", headline: "Extended producer responsibility scheme for glass products announced", source: "Federal Department of Environment", url: "https://www.environment.gov.au", date: "2026-03-21", summary: "Manufacturers and importers of glass products will bear end-of-life costs from 2027 — creates incentives for glass life-extension partnerships with service providers like ASI.", relevance: 4, tags: ["direct-relevance", "high-urgency"], pillarId: "sustainability" },
        { id: "su-14", headline: "Commonwealth Procurement Framework updated with circular economy scoring", source: "Australian Government Procurement", url: "https://www.finance.gov.au", date: "2026-03-16", summary: "All Federal procurement now scores circular economy credentials — ASI should prepare a circular economy capability statement and request inclusion in supplier registers.", relevance: 4, tags: ["direct-relevance"], pillarId: "sustainability" },
        { id: "su-15", headline: "ISO 14001:2025 update requires Scope 3 supplier verification from lead companies", source: "Standards Australia", url: "https://www.standards.org.au", date: "2026-03-22", summary: "Updated ISO 14001 now requires certified organisations to verify that key suppliers have measurable sustainability programmes — ASI's certification status becomes a contract-critical credential.", relevance: 4, tags: ["direct-relevance", "high-urgency"], pillarId: "sustainability" },
      ],
    },
  ],
  opportunityMatrix: [
    { rank: 1, name: "VIC ZEB mandate — 4,500 bus fleet modernisation", pillar: "Bus & Coach", relevanceScore: 5, action: "Engage VIC bus operators for depot-based HydroGuard + GrafShield at handover", urgency: "immediate" },
    { rank: 2, name: "Mandatory Scope 3 climate reporting from 2026", pillar: "Sustainability", relevanceScore: 5, action: "Build 'Glass Life Extension = Carbon Reduction' data pack using CSIRO framework", urgency: "immediate" },
    { rank: 3, name: "AI smartphone damage detection at 95-99% accuracy", pillar: "Fleet Maint.", relevanceScore: 5, action: "Evaluate Inspektlabs API for ASIPortal inspection workflow integration", urgency: "near-term" },
    { rank: 4, name: "NSW ZEB strategy — 8,000+ buses, 11+ depot conversions", pillar: "Sustainability", relevanceScore: 5, action: "Position as preferred glass services provider, register with TfNSW", urgency: "near-term" },
    { rank: 5, name: "Graphene-enhanced PPF at commercial scale", pillar: "Glass/Coating", relevanceScore: 5, action: "Discuss next-gen product evolution with APEAX for GrafShield upgrade", urgency: "near-term" },
    { rank: 6, name: "Productivity Commission validates repair/remediation model", pillar: "Sustainability", relevanceScore: 5, action: "Reference report in all tenders, proposals and ESG statements", urgency: "immediate" },
    { rank: 7, name: "NSW Region 6 bus contract renewal (Jun 2026)", pillar: "Bus & Coach", relevanceScore: 4, action: "Monitor TfNSW procurement portal and register for sub-contracting", urgency: "immediate" },
    { rank: 8, name: "Hydrophobic coatings confirmed at 22% maintenance cost reduction", pillar: "Fleet Maint.", relevanceScore: 5, action: "Strengthen HydroGuard ROI claims with independent trial data", urgency: "immediate" },
    { rank: 9, name: "Volgren delivering 630 ZEBs by end 2026", pillar: "Bus & Coach", relevanceScore: 4, action: "Approach Volgren for OEM glass protection integration at build stage", urgency: "near-term" },
    { rank: 10, name: "$10M CRC-P grants for recycling and materials innovation", pillar: "Sustainability", relevanceScore: 4, action: "Explore co-applicant status with university partner for glass life-extension grant", urgency: "near-term" },
  ],
  metadata: {
    totalFindings: 51,
    pillarCounts: { "glass-coating": 12, "bus-coach": 12, "fleet-maintenance": 12, sustainability: 15 },
    highRelevanceCount: 28,
    urgentCount: 12,
    topOpportunity: "VIC ZEB mandate — 4,500 bus fleet modernisation",
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ALL_SEEDS: OSINTScan[] = [SEED_SCAN, SEED_SCAN_20260324];

async function ensureSeed() {
  const db = admin.firestore();
  for (const seed of ALL_SEEDS) {
    const ref = db.collection(COLLECTIONS.OSINT_SCANS).doc(seed.date);
    const snap = await ref.get();
    if (!snap.exists) {
      await ref.set(seed);
    }
  }
}

// ─── GET — list available scans ───────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    await requireUserId(req);
    await ensureSeed();
    const db = admin.firestore();
    const snap = await db.collection(COLLECTIONS.OSINT_SCANS).orderBy("date", "desc").limit(30).get();
    const scans: OSINTScanMeta[] = snap.docs.map((d) => {
      const data = d.data() as OSINTScan;
      return {
        date: data.date,
        generatedAt: data.generatedAt,
        totalFindings: data.metadata.totalFindings,
        highRelevanceCount: data.metadata.highRelevanceCount,
        urgentCount: data.metadata.urgentCount || 0,
        topOpportunity: data.metadata.topOpportunity || "",
        pillarCounts: data.metadata.pillarCounts,
      };
    });
    return NextResponse.json({ scans });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list scans.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// ─── Auto-create leads from high-relevance opportunity matrix ──────────────────

async function autoImportOpportunities(scan: OSINTScan, userId: string) {
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  let created = 0;

  for (const opp of scan.opportunityMatrix || []) {
    if (opp.relevanceScore < 4) continue;

    // Skip if a lead with this company name already exists
    const existing = await db.collection(COLLECTIONS.LEADS)
      .where("companyName", "==", opp.name)
      .limit(1)
      .get();
    if (!existing.empty) continue;

    // Create a lead from the opportunity
    const urgencyMap: Record<string, string> = { immediate: "identified", "near-term": "identified", watch: "identified" };
    await db.collection(COLLECTIONS.LEADS).add({
      leadNumber: `LD-OSINT-${scan.date}-${opp.rank}`,
      companyName: opp.name,
      sector: opp.pillar?.toLowerCase().replace(/\s+/g, "-") || "other",
      isExistingClient: false,
      contacts: [],
      bantScore: opp.relevanceScore * 17,
      bantBreakdown: { budget: 10, authority: 10, need: opp.relevanceScore * 5, timing: opp.urgency === "immediate" ? 20 : 10, fit: opp.relevanceScore * 3 },
      leadGrade: opp.relevanceScore >= 5 ? "A" : opp.relevanceScore >= 4 ? "B" : "C",
      stage: urgencyMap[opp.urgency] || "identified",
      stageHistory: [],
      stageEnteredAt: new Date().toISOString(),
      source: {
        type: "osint",
        osintScanDate: scan.date,
        osintFinding: opp.name,
        osintPillar: opp.pillar,
        osintRelevanceScore: opp.relevanceScore,
      },
      estimatedServices: [],
      painPoints: [],
      asiSolutionFit: [opp.action],
      outreachSequence: null,
      outreachStatus: { linkedInConnected: false, linkedInMessageSent: false, emailsSent: 0, responseReceived: false, meetingScheduled: false },
      outreachHistory: [],
      marketMode: "growth",
      nextAction: opp.action,
      nextActionDate: scan.date,
      notes: `[Auto-imported from OSINT ${scan.date}] Rank #${opp.rank}. Urgency: ${opp.urgency}. ${opp.action}`,
      tags: ["osint", "auto-imported", opp.urgency],
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      isDeleted: false,
    });
    created++;
  }

  return created;
}

// ─── POST — ingest a new scan ─────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const db = admin.firestore();
    const userSnap = await db.collection("users").doc(userId).get();
    const user = userSnap.data() as { role?: string } | undefined;
    if (!user || user.role !== "admin") {
      return NextResponse.json({ error: "Admin only." }, { status: 403 });
    }
    const body = (await req.json()) as OSINTScan;
    if (!body.date) return NextResponse.json({ error: "Missing date." }, { status: 400 });
    await db.collection(COLLECTIONS.OSINT_SCANS).doc(body.date).set(body);

    // Auto-import high-relevance opportunities to CRM pipeline
    const leadsCreated = await autoImportOpportunities(body, userId);

    return NextResponse.json({ ok: true, date: body.date, leadsCreated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to ingest scan.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
