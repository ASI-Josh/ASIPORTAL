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

const buildSeeds = (): AgentSeed[] => {
  const seeds: AgentSeed[] = [];

  if (process.env.OPENAI_DOC_MANAGER_WORKFLOW_ID) {
    seeds.push({
      name: "ASI Doc Manager Agent",
      purpose: "Draft controlled IMS documents and revisions.",
      workflowId: process.env.OPENAI_DOC_MANAGER_WORKFLOW_ID,
      model: "gpt-5.2",
      capabilities: ["document_control", "ims_document_drafting", "revision_control"],
    });
  }

  if (process.env.OPENAI_IMS_AUDITOR_WORKFLOW_ID) {
    seeds.push({
      name: "ASI IMS Auditor",
      purpose: "Draft internal audit plans, checklists, and findings.",
      workflowId: process.env.OPENAI_IMS_AUDITOR_WORKFLOW_ID,
      model: "gpt-5.2",
      capabilities: ["audit_planning", "iso9001", "compliance_review"],
    });
  }

  if (process.env.OPENAI_INTERNAL_ADMIN_WORKFLOW_ID) {
    seeds.push({
      name: "ASI Internal Knowledge Assistant (Admin)",
      purpose: "Business, strategy, IMS, and operational guidance for admins.",
      workflowId: process.env.OPENAI_INTERNAL_ADMIN_WORKFLOW_ID,
      model: "gpt-5.2",
      capabilities: ["strategy", "ims_guidance", "risk_management", "commercial_insights"],
    });
  }

  if (process.env.OPENAI_INTERNAL_TECH_WORKFLOW_ID) {
    seeds.push({
      name: "ASI Internal Knowledge Assistant (Tech)",
      purpose: "Technical procedures, QA support, and customer-service guidance.",
      workflowId: process.env.OPENAI_INTERNAL_TECH_WORKFLOW_ID,
      model: "gpt-5.2",
      capabilities: ["technical_support", "qa_guidance", "customer_service"],
    });
  }

  return seeds;
};

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
    if (seeds.length === 0) {
      return NextResponse.json({ error: "No workflow IDs configured." }, { status: 400 });
    }

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
