import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";
import { buildInsightPrompt, calculateDashboardMetrics } from "@/lib/dashboard-analytics";
import { generateDashboardInsights } from "@/ai/flows/generate-dashboard-insights";

const ANALYTICS_COLLECTION = "analyticsDaily";
const INSIGHTS_COLLECTION = "aiInsights";

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const userSnap = await admin.firestore().collection(COLLECTIONS.USERS).doc(userId).get();
    const role = userSnap.data()?.role;
    if (role !== "admin" && role !== "technician") {
      return NextResponse.json({ error: "Not authorised." }, { status: 403 });
    }

    const [jobsSnap, inspectionsSnap, worksSnap, orgSnap] = await Promise.all([
      admin.firestore().collection(COLLECTIONS.JOBS).get(),
      admin.firestore().collection(COLLECTIONS.INSPECTIONS).get(),
      admin.firestore().collection(COLLECTIONS.WORKS_REGISTER).get(),
      admin.firestore().collection(COLLECTIONS.CONTACT_ORGANIZATIONS).get(),
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
    const organizations = orgSnap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() as Record<string, unknown>),
    })) as unknown as Parameters<typeof calculateDashboardMetrics>[0]["organizations"];

    const metrics = calculateDashboardMetrics({
      jobs,
      inspections,
      worksRegister,
      organizations,
    });

    const insights = await generateDashboardInsights({
      metrics: buildInsightPrompt(metrics),
    });

    const now = admin.firestore.FieldValue.serverTimestamp();
    await admin
      .firestore()
      .collection(ANALYTICS_COLLECTION)
      .doc(metrics.dateKey)
      .set({ ...metrics, generatedAt: now }, { merge: true });

    await admin
      .firestore()
      .collection(INSIGHTS_COLLECTION)
      .doc(metrics.dateKey)
      .set(
        {
          ...insights,
          dateKey: metrics.dateKey,
          generatedAt: now,
        },
        { merge: true }
      );

    return NextResponse.json({ metrics, insights });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to generate insights.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
