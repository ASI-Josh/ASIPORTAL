import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";

// One-shot seed for the Cutting Workflow Phase 0:
//   - Manu (Wash'd) JV partner invite
//   - Default APEAX PPF and APEAX WPF material profiles
// Idempotent: re-running won't create duplicates. Admin-only.
// POST /api/admin/seed-cutting
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAdminUser(req);

    const results: Record<string, unknown> = {};

    // ---- Manu's JV invite ----
    const manuEmail = "monu@washd.com.au";
    const invitesRef = admin.firestore().collection(COLLECTIONS.USER_INVITES);
    const existing = await invitesRef.where("email", "==", manuEmail).get();
    const existingPending = existing.docs.find((d) => d.data().status === "pending");
    const existingAccepted = existing.docs.find((d) => d.data().status === "accepted");

    if (existingAccepted) {
      results.manu = { status: "already_accepted", inviteId: existingAccepted.id };
    } else if (existingPending) {
      // Make sure JV flag is set even if the invite predates the migration.
      await existingPending.ref.set(
        {
          jvPartner: true,
          jvPartnerOrg: "Wash'd",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      results.manu = { status: "already_pending", inviteId: existingPending.id };
    } else {
      const ref = await invitesRef.add({
        email: manuEmail,
        name: "Manu (Wash'd)",
        role: "admin",
        jvPartner: true,
        jvPartnerOrg: "Wash'd",
        invitedBy: ctx.userId,
        status: "pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      results.manu = { status: "created", inviteId: ref.id };
    }

    // ---- Default material profiles ----
    const profilesRef = admin.firestore().collection(COLLECTIONS.CUTTING_MATERIAL_PROFILES);
    const seed = [
      { name: "APEAX PPF Standard", filmType: "APEAX PPF", cuttingForceGrams: 120, speedMmPerSec: 400, bladeDepthMm: 0.25, passCount: 1, toolNumber: 1 },
      { name: "APEAX WPF Standard", filmType: "APEAX WPF", cuttingForceGrams: 100, speedMmPerSec: 500, bladeDepthMm: 0.20, passCount: 1, toolNumber: 1 },
    ];
    const profileResults: any[] = [];
    for (const p of seed) {
      const dup = await profilesRef
        .where("tenantId", "==", "asi")
        .where("name", "==", p.name)
        .limit(1)
        .get();
      if (!dup.empty) {
        profileResults.push({ name: p.name, status: "exists", id: dup.docs[0].id });
        continue;
      }
      const created = await profilesRef.add({
        ...p,
        tenantId: "asi",
        isActive: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      profileResults.push({ name: p.name, status: "created", id: created.id });
    }
    results.profiles = profileResults;

    return NextResponse.json({ ok: true, ...results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
