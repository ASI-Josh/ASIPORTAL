import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";
import { getAnthropicClient, DEFAULT_MODEL } from "@/lib/anthropic";

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const userSnap = await admin.firestore().collection(COLLECTIONS.USERS).doc(userId).get();
    const userData = userSnap.data();
    const role = userData?.role;
    const organizationId = userData?.organizationId as string | undefined;
    const userName = userData?.name || "Client";

    if (role !== "client" && role !== "contractor") {
      return NextResponse.json({ error: "Not authorised." }, { status: 403 });
    }
    if (!organizationId) {
      return NextResponse.json({ error: "Organisation not found." }, { status: 400 });
    }

    const body = await req.json();
    const { message, satisfactionScore } = body;

    // Handle satisfaction rating submission
    if (message === "__satisfaction_rating__" && typeof satisfactionScore === "number") {
      const orgSnap = await admin.firestore().collection(COLLECTIONS.CONTACT_ORGANIZATIONS).doc(organizationId).get();
      const orgName = orgSnap.data()?.name || "";

      await admin.firestore().collection(COLLECTIONS.SATISFACTION_SURVEYS).add({
        organizationId,
        organizationName: orgName,
        submittedBy: userId,
        submittedByName: userName,
        submittedAt: admin.firestore.FieldValue.serverTimestamp(),
        overallSatisfaction: satisfactionScore,
        serviceQuality: satisfactionScore,
        communication: satisfactionScore,
        timeliness: satisfactionScore,
        valueForMoney: satisfactionScore,
        wouldRecommend: satisfactionScore >= 4,
        athenaGenerated: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return NextResponse.json({ response: "Rating recorded. Thank you." });
    }

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    // Fetch client context
    const [orgSnap, jobsSnap, fuelSnap, emissionsSnap, maintenanceSnap] = await Promise.all([
      admin.firestore().collection(COLLECTIONS.CONTACT_ORGANIZATIONS).doc(organizationId).get(),
      admin.firestore().collection(COLLECTIONS.JOBS).where("organizationId", "==", organizationId).get(),
      admin.firestore().collection(COLLECTIONS.FUEL_RECORDS).where("organizationId", "==", organizationId).get(),
      admin.firestore().collection(COLLECTIONS.EMISSIONS_REPORTS).where("organizationId", "==", organizationId).get(),
      admin.firestore().collection(COLLECTIONS.MAINTENANCE_EVENTS).where("organizationId", "==", organizationId).get(),
    ]);

    const orgName = orgSnap.data()?.name || "your organisation";

    // Build context summary (client-safe only)
    const jobs = jobsSnap.docs.map((d) => d.data());
    const completedJobs = jobs.filter((j) => j.status === "completed" || j.status === "closed");
    const activeJobs = jobs.filter((j) => j.status === "in_progress" || j.status === "scheduled" || j.status === "pending");
    const fuelRecords = fuelSnap.docs.map((d) => d.data());
    const emissionsReports = emissionsSnap.docs.map((d) => d.data());
    const maintenanceEvents = maintenanceSnap.docs.map((d) => d.data());

    const totalFuelSaved = fuelRecords.reduce((s, r: any) => {
      if (r.fuelDeltaLPer100km && r.annualDistanceKm) return s + (r.fuelDeltaLPer100km * r.annualDistanceKm) / 100;
      return s;
    }, 0);
    const totalCostSaved = fuelRecords.reduce((s, r: any) => s + (r.estimatedCostSavingsPerYear || 0), 0);
    const totalCo2 = emissionsReports.reduce((s, r: any) => s + (r.scope1?.co2AvoidedTonnes || 0), 0) || (totalFuelSaved * 2.68 / 1000);
    const totalMaintenanceAvoided = maintenanceEvents.reduce((s, e: any) => s + (e.replacementCostAvoided || 0), 0);

    const contextSummary = [
      `Organisation: ${orgName}`,
      `Completed service events: ${completedJobs.length}`,
      `Active/scheduled services: ${activeJobs.length}`,
      `Fleet vehicles with fuel tracking: ${fuelRecords.length}`,
      `Annual fuel savings: ${Math.round(totalFuelSaved).toLocaleString()} litres ($${Math.round(totalCostSaved).toLocaleString()})`,
      `CO2 emissions avoided: ${totalCo2.toFixed(2)} tonnes per year`,
      `Maintenance cost avoided: $${Math.round(totalMaintenanceAvoided).toLocaleString()}`,
      `Emissions reports filed: ${emissionsReports.length}`,
    ].join("\n");

    const systemPrompt = [
      `You are Athena, the AI assistant for ${orgName}'s fleet protection portal.`,
      "",
      "CRITICAL RULES — you MUST follow these at ALL times:",
      "1. You serve the CLIENT. Use client-facing language only.",
      "2. NEVER reveal ASI internal data: margins, costs, pricing strategy, internal KPIs, agent names, org structure, or competitive intelligence.",
      "3. NEVER mention ASI's internal systems, procurement costs, or supplier details.",
      "4. Refer to ASI Australia as 'your service provider' or 'ASI' — never expose internal team structures.",
      "5. Focus on: fleet performance, service outcomes, environmental impact, sustainability benefits, upcoming services.",
      "6. Use Australian English. Be warm, professional, and helpful.",
      "7. If asked about pricing, costs, or commercial terms, say: 'Please contact your ASI representative for commercial enquiries.'",
      "8. When you identify a risk (e.g. overdue service, declining metrics), flag it clearly but constructively.",
      "9. When you identify an opportunity (e.g. fleet expansion, new product fit), mention it as a suggestion.",
      "10. If the client expresses dissatisfaction, acknowledge it empathetically and suggest they contact their ASI representative.",
      "",
      `LIVE DATA FOR ${orgName.toUpperCase()}:`,
      contextSummary,
      "",
      "Answer questions using this data. If data is not available, say so honestly.",
      "Keep responses concise (2-4 paragraphs max). Use bullet points for lists.",
    ].join("\n");

    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: message }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    return NextResponse.json({ response: text });
  } catch (err: any) {
    console.error("Client Athena error:", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}
