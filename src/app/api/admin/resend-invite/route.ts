import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";

const DEFAULT_APP_URL = "https://asiportal.online";

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const userSnap = await admin.firestore().collection(COLLECTIONS.USERS).doc(userId).get();
    const role = userSnap.data()?.role;
    if (role !== "admin") {
      return NextResponse.json({ error: "Not authorised." }, { status: 403 });
    }

    const payload = (await req.json()) as { inviteId?: string };
    if (!payload.inviteId) {
      return NextResponse.json({ error: "Invite ID is required." }, { status: 400 });
    }

    const inviteRef = admin.firestore().collection(COLLECTIONS.USER_INVITES).doc(payload.inviteId);
    const inviteSnap = await inviteRef.get();
    if (!inviteSnap.exists) {
      return NextResponse.json({ error: "Invite not found." }, { status: 404 });
    }

    const invite = inviteSnap.data() as {
      email?: string;
      name?: string;
      status?: string;
      organizationName?: string;
    };
    if (invite.status !== "pending") {
      return NextResponse.json({ error: "Invite is not pending." }, { status: 400 });
    }
    if (!invite.email) {
      return NextResponse.json({ error: "Invite email missing." }, { status: 400 });
    }

    const displayName =
      invite.name?.trim() || invite.email.split("@")[0] || invite.organizationName || "User";
    const firstName = displayName.split(" ")[0] || "User";
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL;

    await admin.firestore().collection(COLLECTIONS.MAIL).add({
      to: [invite.email],
      message: {
        subject: "ASI Portal access invitation",
        text:
          `Hi ${firstName},\n\n` +
          `Your ASI Portal access is ready. Please sign in to access your portal:\n` +
          `${appUrl}\n\n` +
          `Use your email address (${invite.email}) and continue with Google to activate your access.\n` +
          `If you need an email/password login instead, contact support.\n` +
          `If you need help, email support@asi-australia.com.au.\n\n` +
          `Cheers,\nASI Team`,
      },
    });

    await inviteRef.set(
      {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to resend invite.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
