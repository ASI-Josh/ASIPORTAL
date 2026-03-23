/**
 * POST /api/leads/enrich
 *
 * Cross-references new OSINT findings against the existing CRM pipeline.
 * Returns leads that match company names in the findings, with new intelligence appended.
 * Used after each daily OSINT scan to surface leads that have new signals.
 */
import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";
import type { Lead } from "@/lib/types";

interface EnrichFinding {
  headline: string;
  companyMentions: string[];
  relevance: number;
  tags: string[];
  pillar?: string;
  url?: string;
}

interface MatchedLead {
  leadId: string;
  leadNumber: string;
  companyName: string;
  currentStage: string;
  currentGrade: string;
  newIntelligence: string;
  relevance: number;
  tags: string[];
  recommendedAction?: string;
  stageChangeRecommended?: boolean;
  urgencyFlag?: boolean;
}

function normalise(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function companiesMatch(leadName: string, mention: string): boolean {
  const ln = normalise(leadName);
  const mn = normalise(mention);
  if (ln === mn) return true;
  if (ln.includes(mn) || mn.includes(ln)) return true;
  // Strip common suffixes for fuzzy match
  const strip = (s: string) => s.replace(/ptyltd|pty|ltd|limited|group|holdings|australia|aust/g, "").trim();
  return strip(ln) === strip(mn) && strip(ln).length > 3;
}

export async function POST(req: NextRequest) {
  try {
    await requireUserId(req);
    const body = await req.json() as {
      osintScanDate: string;
      findings: EnrichFinding[];
    };

    const db = admin.firestore();
    const snap = await db.collection(COLLECTIONS.LEADS)
      .where("isDeleted", "!=", true)
      .orderBy("isDeleted")
      .orderBy("createdAt", "desc")
      .limit(200)
      .get();

    const leads = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Lead[];
    const matched: MatchedLead[] = [];
    const now = admin.firestore.FieldValue.serverTimestamp();

    for (const finding of body.findings) {
      for (const mention of finding.companyMentions) {
        const matchedLead = leads.find((l) => companiesMatch(l.companyName, mention));
        if (!matchedLead) continue;

        const isHighUrgency = finding.tags.includes("high-urgency");
        const intel = `[OSINT ${body.osintScanDate}] ${finding.headline} (relevance: ${finding.relevance}/5)`;

        // Append intelligence to lead notes
        const ref = db.collection(COLLECTIONS.LEADS).doc(matchedLead.id);
        const currentNotes = matchedLead.notes || "";
        await ref.set({
          notes: currentNotes ? `${currentNotes}\n\n${intel}` : intel,
          updatedAt: now,
        }, { merge: true });

        // Determine recommended action
        let recommendedAction: string | undefined;
        let stageChangeRecommended = false;

        if (matchedLead.stage === "nurture" && finding.relevance >= 4) {
          recommendedAction = "Reactivate — new high-relevance intelligence warrants re-engagement";
          stageChangeRecommended = true;
        } else if (matchedLead.stage === "identified" && isHighUrgency) {
          recommendedAction = "Escalate outreach — high-urgency signal detected, move to Researched/Contacted";
          stageChangeRecommended = true;
        } else if (isHighUrgency) {
          recommendedAction = `High-urgency signal — review and ensure follow-up is scheduled`;
        } else if (finding.relevance >= 4) {
          recommendedAction = "New supporting intelligence — review and update outreach context";
        }

        matched.push({
          leadId: matchedLead.id,
          leadNumber: matchedLead.leadNumber,
          companyName: matchedLead.companyName,
          currentStage: matchedLead.stage,
          currentGrade: matchedLead.leadGrade,
          newIntelligence: finding.headline,
          relevance: finding.relevance,
          tags: finding.tags,
          recommendedAction,
          stageChangeRecommended,
          urgencyFlag: isHighUrgency,
        });
      }
    }

    return NextResponse.json({
      matchedLeads: matched,
      total: matched.length,
      urgentCount: matched.filter((m) => m.urgencyFlag).length,
      reactivationCount: matched.filter((m) => m.stageChangeRecommended).length,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Enrich failed." }, { status: 400 });
  }
}
