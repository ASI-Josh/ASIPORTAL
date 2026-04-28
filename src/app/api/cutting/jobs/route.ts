import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";
import { requireCuttingUser, cuttingErrorStatus } from "@/lib/server/cuttingAuth";
import type { CuttingJob } from "@/lib/types";

const DEFAULT_TENANT = "asi";

async function nextCuttingNumber(tenantId: string): Promise<string> {
  const counterRef = admin
    .firestore()
    .collection(COLLECTIONS.CUTTING_COUNTERS)
    .doc(tenantId);
  const year = new Date().getFullYear();
  const counterField = `year_${year}`;
  const next = await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const data = (snap.data() as Record<string, number> | undefined) ?? {};
    const current = data[counterField] ?? 0;
    const updated = current + 1;
    tx.set(counterRef, { [counterField]: updated }, { merge: true });
    return updated;
  });
  return `CUT-${year}-${String(next).padStart(4, "0")}`;
}

// GET — list cutting jobs (admin/tech: all in tenant; client: own only)
export async function GET(req: NextRequest) {
  try {
    const { user, role, userId } = await requireCuttingUser(req);
    const tenantId = (user.jvPartnerOrg as string) || DEFAULT_TENANT;
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);

    let q = admin
      .firestore()
      .collection(COLLECTIONS.CUTTING_JOBS)
      .where("tenantId", "==", tenantId)
      .orderBy("createdAt", "desc")
      .limit(limit);

    if (role === "client") {
      q = admin
        .firestore()
        .collection(COLLECTIONS.CUTTING_JOBS)
        .where("tenantId", "==", tenantId)
        .where("clientId", "==", userId)
        .orderBy("createdAt", "desc")
        .limit(limit);
    }

    const snap = await q.get();
    const jobs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ ok: true, jobs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ ok: false, error: msg }, { status: cuttingErrorStatus(msg) });
  }
}

// POST — create a new cutting job
export async function POST(req: NextRequest) {
  try {
    const { user, userId, role } = await requireCuttingUser(req);
    const tenantId = (user.jvPartnerOrg as string) || DEFAULT_TENANT;
    const body = await req.json();

    const cuttingNumber = await nextCuttingNumber(tenantId);
    const now = admin.firestore.Timestamp.now() as unknown as CuttingJob["createdAt"];

    // Clients can only create cutting jobs against themselves.
    const clientId = role === "client" ? userId : (body.clientId ?? null);
    const clientName = role === "client" ? user.name : (body.clientName ?? null);
    const clientEmail = role === "client" ? user.email : (body.clientEmail ?? null);

    const doc: Partial<CuttingJob> = {
      tenantId,
      cuttingNumber,
      jobId: body.jobId ?? undefined,
      jobNumber: body.jobNumber ?? undefined,
      clientId: clientId ?? undefined,
      clientName: clientName ?? undefined,
      clientEmail: clientEmail ?? undefined,
      vehicle: body.vehicle ?? { make: "", model: "" },
      photos: [],
      patternSource: body.patternSource ?? "3m_marketplace",
      patternReference: body.patternReference ?? undefined,
      patternUrl: body.patternUrl ?? undefined,
      patternFileUrl: body.patternFileUrl ?? undefined,
      filmStockItemId: body.filmStockItemId ?? undefined,
      filmStockDescription: body.filmStockDescription ?? undefined,
      rollConsumedMetres: body.rollConsumedMetres ?? undefined,
      operatorId: body.operatorId ?? undefined,
      operatorName: body.operatorName ?? undefined,
      qcStatus: "not_yet_checked",
      issueTags: [],
      notes: body.notes ?? undefined,
      materialProfileId: body.materialProfileId ?? undefined,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      createdByName: user.name,
    };

    // Strip undefined to keep Firestore happy
    const clean = Object.fromEntries(
      Object.entries(doc).filter(([, v]) => v !== undefined),
    );

    const ref = await admin.firestore().collection(COLLECTIONS.CUTTING_JOBS).add(clean);
    const snap = await ref.get();
    return NextResponse.json({ ok: true, job: { id: snap.id, ...snap.data() } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ ok: false, error: msg }, { status: cuttingErrorStatus(msg) });
  }
}
