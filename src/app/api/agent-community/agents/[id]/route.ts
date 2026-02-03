import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";

const formatTimestamp = (value?: admin.firestore.Timestamp | null) => {
  if (!value) return null;
  return value.toDate().toISOString();
};

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = await requireUserId(req);
    const userSnap = await admin.firestore().collection(COLLECTIONS.USERS).doc(userId).get();
    const role = userSnap.data()?.role;
    if (role !== "admin") {
      return NextResponse.json({ error: "Not authorised." }, { status: 403 });
    }

    const profileSnap = await admin
      .firestore()
      .collection(COLLECTIONS.AGENT_PROFILES)
      .doc(params.id)
      .get();

    if (!profileSnap.exists) {
      return NextResponse.json({ error: "Agent not found." }, { status: 404 });
    }

    const data = profileSnap.data() as Record<string, unknown>;

    return NextResponse.json({
      agent: {
        id: profileSnap.id,
        name: data.name,
        roleTitle: data.roleTitle,
        aboutWork: data.aboutWork || "",
        aboutPersonal: data.aboutPersonal || "",
        avatarUrl: data.avatarUrl || "",
        createdAt: formatTimestamp(data.createdAt as admin.firestore.Timestamp),
        updatedAt: formatTimestamp(data.updatedAt as admin.firestore.Timestamp),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load agent profile.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
