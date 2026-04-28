import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";
import { requireCuttingUser, cuttingErrorStatus } from "@/lib/server/cuttingAuth";
import { svgToHpgl } from "@/lib/hpgl";
import type { CuttingJob, MaterialProfile } from "@/lib/types";

// POST /api/cutting/jobs/[id]/plt
// Body: { svg: string, materialProfileId?: string, mediaWidthMm?: number }
// Returns: HPGL .plt content + stats. Stats include estimated cut
// length so callers can pre-fill rollConsumedMetres.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireCuttingUser(req);

    const cuttingRef = admin.firestore().collection(COLLECTIONS.CUTTING_JOBS).doc(id);
    const cuttingSnap = await cuttingRef.get();
    if (!cuttingSnap.exists) throw new Error("Cutting job not found.");
    const job = cuttingSnap.data() as CuttingJob;
    if (ctx.role === "client" && job.clientId !== ctx.userId) {
      throw new Error("Not authorised for this cutting job.");
    }

    const body = await req.json();
    const svgText = body.svg as string | undefined;
    if (!svgText || svgText.length < 30) {
      throw new Error("SVG content required.");
    }

    const profileId = body.materialProfileId ?? job.materialProfileId;
    let profile: MaterialProfile | undefined;
    if (profileId) {
      const pSnap = await admin
        .firestore()
        .collection(COLLECTIONS.CUTTING_MATERIAL_PROFILES)
        .doc(profileId)
        .get();
      if (pSnap.exists) profile = pSnap.data() as MaterialProfile;
    }

    // Fall back to a sensible default profile if none configured —
    // operator will still see a warning client-side.
    const profileInput = profile ?? {
      name: "Default (no profile)",
      cuttingForceGrams: 100,
      speedMmPerSec: 400,
      bladeDepthMm: 0.25,
      passCount: 1,
      toolNumber: 1,
    };

    const result = svgToHpgl(svgText, {
      profile: {
        name: profileInput.name,
        cuttingForceGrams: profileInput.cuttingForceGrams,
        speedMmPerSec: profileInput.speedMmPerSec,
        bladeDepthMm: profileInput.bladeDepthMm,
        passCount: profileInput.passCount,
        toolNumber: profileInput.toolNumber,
      },
      mediaWidthMm: body.mediaWidthMm ?? 1600,
    });

    await cuttingRef.set(
      {
        lastPlotGeneratedAt: admin.firestore.FieldValue.serverTimestamp(),
        materialProfileId: profileId ?? job.materialProfileId ?? null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return NextResponse.json({
      ok: true,
      hpgl: result.hpgl,
      pathCount: result.pathCount,
      totalLengthMm: result.totalLengthMm,
      boundingBoxMm: result.boundingBoxMm,
      profileUsed: profileInput.name,
      filename: `${job.cuttingNumber || id}.plt`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ ok: false, error: msg }, { status: cuttingErrorStatus(msg) });
  }
}
