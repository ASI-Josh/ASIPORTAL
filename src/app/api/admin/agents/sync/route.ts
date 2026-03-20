import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";

type AgentSeed = {
  name: string;
  purpose: string;
  workflowId?: string;
  model?: string;
  capabilities: string[];
};

const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

const buildSeeds = (): AgentSeed[] => [
  {
    name: "ASI Doc Manager Agent",
    purpose: "Draft controlled IMS documents and revisions.",
    workflowId: "doc_manager",
    model: CLAUDE_MODEL,
    capabilities: ["document_control", "ims_document_drafting", "revision_control"],
  },
  {
    name: "ASI IMS Auditor",
    purpose: "Draft internal audit plans, checklists, and findings.",
    workflowId: "auditor",
    model: CLAUDE_MODEL,
    capabilities: ["audit_planning", "iso9001", "compliance_review"],
  },
  {
    name: "ASI Internal Knowledge Assistant (Admin)",
    purpose: "Business, strategy, IMS, and operational guidance for admins.",
    workflowId: "admin",
    model: CLAUDE_MODEL,
    capabilities: ["strategy", "ims_guidance", "risk_management", "commercial_insights"],
  },
  {
    name: "ASI Internal Knowledge Assistant (Tech)",
    purpose: "Technical procedures, QA support, and customer-service guidance.",
    workflowId: "tech",
    model: CLAUDE_MODEL,
    capabilities: ["technical_support", "qa_guidance", "customer_service"],
  },
];

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const userSnap = await admin.firestore().collection(COLLECTIONS.USERS).doc(userId).get();
    if (!userSnap.exists) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }
    const user = userSnap.data() as { role?: string; name?: string; email?: string };
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Access denied." }, { status: 403 });
    }

    const seeds = buildSeeds();
    const now = admin.firestore.Timestamp.now();
    const agentsRef = admin.firestore().collection(COLLECTIONS.AUTOMATION_AGENTS);
    let created = 0;
    let updated = 0;

    await Promise.all(
      seeds.map(async (seed) => {
        const existingSnap = await agentsRef.where("name", "==", seed.name).limit(1).get();
        const payload = {
          name: seed.name,
          type: "workflow",
          status: "active",
          purpose: seed.purpose,
          model: seed.model,
          workflowId: seed.workflowId,
          capabilities: seed.capabilities,
          updatedAt: now,
          owner: {
            id: userId,
            name: user.name || user.email || "Admin",
            email: user.email || undefined,
          },
        };

        if (existingSnap.empty) {
          await agentsRef.add({
            ...payload,
            createdAt: now,
            createdById: userId,
            createdByName: user.name || user.email || "Admin",
            createdByEmail: user.email || undefined,
          });
          created += 1;
        } else {
          await existingSnap.docs[0].ref.set(payload, { merge: true });
          updated += 1;
        }
      })
    );

    return NextResponse.json({ created, updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sync agents.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
