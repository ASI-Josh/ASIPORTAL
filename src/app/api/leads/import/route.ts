import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";
import type { Lead, LeadSector, PipelineStage } from "@/lib/types";

function calcGrade(s: number): Lead["leadGrade"] {
  if (s >= 80) return "A";
  if (s >= 65) return "B";
  if (s >= 50) return "C";
  if (s >= 35) return "D";
  return "E";
}

const STAGE_MAP: Record<number, PipelineStage> = {
  1: "identified", 2: "researched", 3: "qualified", 4: "outreach",
  5: "engaged", 6: "discovery", 7: "proposal", 8: "negotiation", 9: "won", 10: "lost", 11: "nurture",
};

async function nextLeadNumber(year: number): Promise<string> {
  const db = admin.firestore();
  const counterRef = db.collection("counters").doc("leads");
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
  return `LD-${year}-${String(num).padStart(4, "0")}`;
}

interface ImportLead {
  company: string;
  sector?: string;
  companyWebsite?: string;
  companySize?: string;
  existingOrganizationId?: string;
  isExistingClient?: boolean;
  contact?: {
    name?: string;
    title?: string;
    email?: string;
    phone?: string;
    linkedin?: string;
  };
  contacts?: Lead["contacts"];
  pipeline_stage?: number;
  stage?: PipelineStage;
  bant_score?: number;
  stream_type?: "sales" | "supply_chain";
  bant_breakdown?: Partial<Lead["bantBreakdown"]>;
  lead_grade?: Lead["leadGrade"];
  source?: {
    osint_scan_date?: string;
    finding?: string;
    pillar?: string;
    relevance_score?: number;
    type?: string;
  };
  pain_points?: string[];
  asi_solution_fit?: string[];
  estimated_services?: string[];
  estimated_value?: number;
  recommended_sequence?: "A" | "B" | "C";
  next_action?: string;
  follow_up_date?: string;
  notes?: string;
  tags?: string[];
  market_mode?: "growth" | "downturn" | "neutral";
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const db = admin.firestore();

    const body = await req.json() as {
      osintScanDate?: string;
      leads: ImportLead[];
    };

    const leads = body.leads || [];
    if (!Array.isArray(leads) || leads.length === 0) {
      return NextResponse.json({ error: "No leads provided." }, { status: 400 });
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const year = new Date().getFullYear();
    let created = 0, updated = 0, skipped = 0;
    const resultLeads: Array<{ id: string; leadNumber: string; companyName: string; action: string }> = [];

    for (const item of leads) {
      if (!item.company?.trim()) { skipped++; continue; }

      // Check if lead already exists for this company
      const existing = await db.collection(COLLECTIONS.LEADS)
        .where("companyName", "==", item.company.trim())
        .limit(5)
        .get();
      const existingActive = existing.docs.filter((d) => !d.data().isDeleted);

      const bantBreakdown: Lead["bantBreakdown"] = {
        budget: item.bant_breakdown?.budget ?? 0,
        authority: item.bant_breakdown?.authority ?? 0,
        need: item.bant_breakdown?.need ?? 0,
        timing: item.bant_breakdown?.timing ?? 0,
        fit: item.bant_breakdown?.fit ?? 0,
      };
      const bantScore = item.bant_score ??
        Object.values(bantBreakdown).reduce((a, b) => a + b, 0);
      const leadGrade = item.lead_grade ?? calcGrade(bantScore);
      const stage = item.stage ?? (item.pipeline_stage ? STAGE_MAP[item.pipeline_stage] : "identified") ?? "identified";

      // Build contacts array
      const contacts: Lead["contacts"] = item.contacts || [];
      if (contacts.length === 0 && item.contact?.name) {
        contacts.push({
          id: crypto.randomUUID(),
          name: item.contact.name,
          title: item.contact.title,
          email: item.contact.email,
          phone: item.contact.phone,
          linkedInUrl: item.contact.linkedin,
          isPrimary: true,
        });
      }

      if (existingActive.length > 0) {
        // Update existing lead with new intelligence if stage is earlier
        const existingDoc = existingActive[0];
        const existingData = existingDoc.data() as Lead;
        const stageOrder = Object.keys(STAGE_MAP);
        const existingStageIdx = stageOrder.indexOf(existingData.stage);
        const newStageIdx = stageOrder.indexOf(stage);

        // Only upgrade BANT/grade, add to notes — don't regress stage
        const updates: Record<string, unknown> = {
          updatedAt: now,
          bantScore: Math.max(existingData.bantScore || 0, bantScore),
          leadGrade: calcGrade(Math.max(existingData.bantScore || 0, bantScore)),
        };

        if (newStageIdx > existingStageIdx) {
          updates.stage = stage;
          updates.stageEnteredAt = new Date().toISOString();
        }

        if (item.notes) {
          updates.notes = existingData.notes
            ? `${existingData.notes}\n\n[OSINT ${body.osintScanDate || "update"}] ${item.notes}`
            : item.notes;
        }

        await existingDoc.ref.set(updates, { merge: true });
        updated++;
        resultLeads.push({ id: existingDoc.id, leadNumber: existingData.leadNumber, companyName: item.company, action: "updated" });
      } else if (existingActive.length === 0) {
        // Create new lead
        const leadNumber = await nextLeadNumber(year);
        const payload: Omit<Lead, "id"> = {
          leadNumber,
          streamType: item.stream_type || "sales",
          companyName: item.company.trim(),
          companyWebsite: item.companyWebsite,
          sector: (item.sector?.toLowerCase().replace(/\s+/g, "-") || "other") as LeadSector,
          companySize: item.companySize as Lead["companySize"],
          existingOrganizationId: item.existingOrganizationId,
          isExistingClient: item.isExistingClient ?? false,
          contacts,
          bantScore,
          bantBreakdown,
          leadGrade,
          stage,
          stageHistory: [],
          stageEnteredAt: new Date().toISOString(),
          source: {
            type: (item.source?.type || "osint") as Lead["source"]["type"],
            osintScanDate: item.source?.osint_scan_date || body.osintScanDate,
            osintFinding: item.source?.finding,
            osintPillar: item.source?.pillar,
            osintRelevanceScore: item.source?.relevance_score,
          },
          estimatedValue: item.estimated_value,
          estimatedServices: item.estimated_services || [],
          painPoints: item.pain_points || [],
          asiSolutionFit: item.asi_solution_fit || [],
          outreachSequence: item.recommended_sequence || null,
          outreachStatus: {
            linkedInConnected: false, linkedInMessageSent: false, emailsSent: 0,
            responseReceived: false, meetingScheduled: false,
          },
          outreachHistory: [],
          marketMode: item.market_mode || "growth",
          nextAction: item.next_action,
          nextActionDate: item.follow_up_date,
          notes: item.notes || "",
          tags: item.tags || (item.source?.osint_scan_date ? ["osint"] : []),
          createdAt: now as unknown as import("firebase/firestore").Timestamp,
          updatedAt: now as unknown as import("firebase/firestore").Timestamp,
          createdBy: userId,
          isDeleted: false,
        };

        const ref = await db.collection(COLLECTIONS.LEADS).add(payload);
        created++;
        resultLeads.push({ id: ref.id, leadNumber, companyName: item.company, action: "created" });
      }
    }

    return NextResponse.json({ created, updated, skipped, leads: resultLeads });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Import failed." }, { status: 400 });
  }
}
