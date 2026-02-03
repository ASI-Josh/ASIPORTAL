import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";

const formatTimestamp = (value?: admin.firestore.Timestamp | null) => {
  if (!value) return null;
  return value.toDate().toISOString();
};

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const userSnap = await admin.firestore().collection(COLLECTIONS.USERS).doc(userId).get();
    const role = userSnap.data()?.role;
    if (role !== "admin") {
      return NextResponse.json({ error: "Not authorised." }, { status: 403 });
    }

    const agentsSnap = await admin
      .firestore()
      .collection(COLLECTIONS.AGENT_PROFILES)
      .orderBy("updatedAt", "desc")
      .get();

    const agents = agentsSnap.docs.map((docSnap) => {
      const data = docSnap.data() as Record<string, unknown>;
      return {
        id: docSnap.id,
        name: data.name,
        roleTitle: data.roleTitle,
        aboutWork: data.aboutWork || "",
        aboutPersonal: data.aboutPersonal || "",
        avatarUrl: data.avatarUrl || "",
        createdAt: formatTimestamp(data.createdAt as admin.firestore.Timestamp),
        updatedAt: formatTimestamp(data.updatedAt as admin.firestore.Timestamp),
      };
    });

    return NextResponse.json({ agents });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load agents.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
