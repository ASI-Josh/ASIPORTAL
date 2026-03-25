/**
 * POST /api/leads/migrate
 * One-time migration: classify existing leads into sales | supply_chain streams.
 * Also remaps old stage names to new stage names.
 * Safe to run multiple times — skips leads that already have streamType set.
 */
import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";
import type { StreamType, PipelineStage } from "@/lib/types";

// Keywords that indicate supply_chain (technology/partner/vendor leads)
const SUPPLY_CHAIN_KEYWORDS = [
  "evaluate", "r&d", "integration", "partnership", "distribution",
  "api", "platform", "technology", "supplier", "supply", "license",
  "licensing", "research", "prototype", "smart glass", "electrochromic",
  "nanoceramic", "self-healing", "patent", "grant", "crc-p",
  "predictive maintenance", "ai-powered", "machine learning",
];

const SUPPLY_CHAIN_TAG_KEYWORDS = [
  "strategic-partnership", "technology", "r&d", "supply-chain",
  "distribution", "integration", "platform",
];

function classifyLead(lead: Record<string, unknown>): StreamType {
  const tags = (lead.tags as string[]) || [];
  const solutionFit = (lead.asiSolutionFit as string[]) || [];
  const services = (lead.estimatedServices as string[]) || [];
  const painPoints = (lead.painPoints as string[]) || [];
  const notes = String(lead.notes || "").toLowerCase();
  const sector = String(lead.sector || "").toLowerCase();

  // Check tags first
  if (tags.some((t) => SUPPLY_CHAIN_TAG_KEYWORDS.some((k) => t.toLowerCase().includes(k)))) {
    return "supply_chain";
  }

  // Check solution fit and services for supply chain language
  const allText = [...solutionFit, ...services, ...painPoints, notes].join(" ").toLowerCase();
  const supplyChainHits = SUPPLY_CHAIN_KEYWORDS.filter((kw) => allText.includes(kw)).length;
  if (supplyChainHits >= 2) return "supply_chain";

  // Glass & coating sector leads that are technology/platform providers
  if (sector.includes("glass") && (allText.includes("platform") || allText.includes("integration") || allText.includes("distribution"))) {
    return "supply_chain";
  }

  // Default: sales (customer opportunity)
  return "sales";
}

// Remap old stages to new stages
const OLD_TO_SALES: Record<string, PipelineStage> = {
  identified: "identified",
  researched: "researched",
  contacted: "outreach",
  engaged: "engaged",
  qualified: "qualified",
  proposal_sent: "proposal",
  negotiation: "negotiation",
  won: "won",
  lost: "lost",
  nurture: "nurture",
};

const OLD_TO_SUPPLY_CHAIN: Record<string, PipelineStage> = {
  identified: "identified",
  researched: "researched",
  contacted: "outreach",
  engaged: "engaged",
  qualified: "qualified",
  proposal_sent: "negotiation",
  negotiation: "negotiation",
  won: "onboarded",
  lost: "inactive",
  nurture: "watchlist",
};

export async function POST(req: NextRequest) {
  try {
    await requireAdminUser(req);
    const db = admin.firestore();
    const snap = await db.collection(COLLECTIONS.LEADS).get();
    const now = admin.firestore.FieldValue.serverTimestamp();

    let salesCount = 0;
    let supplyCount = 0;
    let skippedCount = 0;
    let stageRemapped = 0;
    const details: Array<{ id: string; company: string; stream: string; oldStage?: string; newStage?: string }> = [];

    const batch = db.batch();

    for (const doc of snap.docs) {
      const data = doc.data();

      // Skip already-migrated leads
      if (data.streamType) {
        skippedCount++;
        continue;
      }

      const stream = classifyLead(data);
      const updates: Record<string, admin.firestore.FieldValue | string> = {
        streamType: stream,
        updatedAt: now,
      };

      // Remap old stages to new stages
      const currentStage = String(data.stage || "identified");
      const stageMap = stream === "sales" ? OLD_TO_SALES : OLD_TO_SUPPLY_CHAIN;
      const newStage = stageMap[currentStage];
      if (newStage && newStage !== currentStage) {
        updates.stage = newStage;
        stageRemapped++;
      }

      batch.update(doc.ref, updates);

      if (stream === "sales") salesCount++;
      else supplyCount++;

      details.push({
        id: doc.id,
        company: String(data.companyName || ""),
        stream,
        ...(newStage && newStage !== currentStage ? { oldStage: currentStage, newStage } : {}),
      });
    }

    await batch.commit();

    return NextResponse.json({
      migrated: salesCount + supplyCount,
      sales: salesCount,
      supply_chain: supplyCount,
      skipped: skippedCount,
      stageRemapped,
      details,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Migration failed." }, { status: 400 });
  }
}
