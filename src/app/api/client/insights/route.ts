import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";
import { buildInsightPrompt, calculateDashboardMetrics } from "@/lib/dashboard-analytics";
import { generateDashboardInsights } from "@/ai/flows/generate-dashboard-insights";

const INSIGHTS_COLLECTION = COLLECTIONS.CLIENT_INSIGHTS;

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const userSnap = await admin.firestore().collection(COLLECTIONS.USERS).doc(userId).get();
    const role = userSnap.data()?.role;
    const organizationId = userSnap.data()?.organizationId as string | undefined;

    if (role !== "client" && role !== "contractor") {
      return NextResponse.json({ error: "Not authorised." }, { status: 403 });
    }
    if (!organizationId) {
      return NextResponse.json({ error: "Organisation not found." }, { status: 400 });
    }

    const [jobsSnap, inspectionsSnap, worksSnap, orgSnap] = await Promise.all([
      admin
        .firestore()
        .collection(COLLECTIONS.JOBS)
        .where("organizationId", "==", organizationId)
        .get(),
      admin
        .firestore()
        .collection(COLLECTIONS.INSPECTIONS)
        .where("organizationId", "==", organizationId)
        .get(),
      admin
        .firestore()
        .collection(COLLECTIONS.WORKS_REGISTER)
        .where("organizationId", "==", organizationId)
        .get(),
      admin.firestore().collection(COLLECTIONS.CONTACT_ORGANIZATIONS).doc(organizationId).get(),
    ]);

    const jobs = jobsSnap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() as Record<string, unknown>),
    })) as unknown as Parameters<typeof calculateDashboardMetrics>[0]["jobs"];
    const inspections = inspectionsSnap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() as Record<string, unknown>),
    })) as unknown as Parameters<typeof calculateDashboardMetrics>[0]["inspections"];
    const worksRegister = worksSnap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() as Record<string, unknown>),
    })) as unknown as Parameters<typeof calculateDashboardMetrics>[0]["worksRegister"];
    const organizations = orgSnap.exists
      ? ([
          {
            id: orgSnap.id,
            ...(orgSnap.data() as Record<string, unknown>),
          },
        ] as Parameters<typeof calculateDashboardMetrics>[0]["organizations"])
      : [];

    const metrics = calculateDashboardMetrics({
      jobs,
      inspections,
      worksRegister,
      organizations,
    });

    const insights = await generateDashboardInsights({
      metrics: buildInsightPrompt(metrics),
      audience: "client",
    });

    const now = admin.firestore.FieldValue.serverTimestamp();
    const docId = `${organizationId}-${metrics.dateKey}`;
    await admin
      .firestore()
      .collection(INSIGHTS_COLLECTION)
      .doc(docId)
      .set(
        {
          ...insights,
          dateKey: metrics.dateKey,
          organizationId,
          generatedAt: now,
        },
        { merge: true }
      );

    return NextResponse.json({ metrics, insights, docId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to generate insights.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
