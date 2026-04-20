import { NextRequest, NextResponse } from "next/server";

import { ADMIN_EMAILS } from "@/lib/auth";
import { COLLECTIONS } from "@/lib/collections";
import { admin } from "@/lib/firebaseAdmin";
import { buildJobCompletionReport } from "@/lib/server/job-report-pdf";

export const runtime = "nodejs";

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function requireInternalUser(req: NextRequest): Promise<{
  userId: string;
  name: string;
  role: "admin" | "technician";
}> {
  const header = req.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) {
    throw new Error("Missing authorization token.");
  }
  const token = header.slice("Bearer ".length);
  const decoded = await admin.auth().verifyIdToken(token);
  const userId = decoded.uid;
  const email = decoded.email ? decoded.email.toLowerCase() : "";

  const userSnap = await admin.firestore().collection(COLLECTIONS.USERS).doc(userId).get();
  const user = (userSnap.data() as { role?: string; name?: string; email?: string } | undefined) || {};
  const role = safeString(user.role);
  const isAdmin = role === "admin" || (!!email && ADMIN_EMAILS.includes(email));
  const isTechnician = role === "technician";

  if (!isAdmin && !isTechnician) {
    throw new Error("Not authorised.");
  }

  return {
    userId,
    name: safeString(user.name) || safeString(user.email) || email || "ASI User",
    role: isAdmin ? "admin" : "technician",
  };
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireInternalUser(req);
    const payload = (await req.json().catch(() => ({}))) as { jobId?: string };
    const jobId = safeString(payload.jobId);
    if (!jobId) {
      return NextResponse.json({ error: "jobId is required." }, { status: 400 });
    }

    const { pdfBytes, fileName } = await buildJobCompletionReport(jobId, actor.name);

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to generate completion report.";
    console.error("Job completion report API failed:", error);
    const normalized = message.toLowerCase();
    if (normalized.includes("missing authorization token")) {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    if (normalized.includes("not authorised")) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    if (normalized.includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (normalized.includes("only available")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
