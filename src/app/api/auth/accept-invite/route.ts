import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";
import { User } from "@/lib/types";

type InviteRecord = {
  email: string;
  name?: string;
  role: User["role"];
  organizationId?: string;
  organizationName?: string;
  contactId?: string;
  status?: string;
};

function splitName(fullName: string) {
  const trimmed = fullName.trim();
  if (!trimmed) return { firstName: "User", lastName: "" };
  const [firstName, ...rest] = trimmed.split(" ");
  return { firstName, lastName: rest.join(" ") };
}

async function ensureContact(params: {
  organizationId: string;
  email: string;
  name: string;
  role: "primary" | "billing" | "technical" | "management";
  contactId?: string;
}) {
  const { organizationId, email, name, role, contactId } = params;
  const contactsRef = admin.firestore().collection(COLLECTIONS.ORGANIZATION_CONTACTS);
  if (contactId) {
    await contactsRef.doc(contactId).set(
      {
        email,
        role,
        hasPortalAccess: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return contactId;
  }
  const existing = await contactsRef.where("email", "==", email).get();
  const match = existing.docs.find(
    (docSnap) => docSnap.data().organizationId === organizationId
  );
  if (match) {
    await match.ref.set(
      {
        role,
        hasPortalAccess: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return match.id;
  }
  const { firstName, lastName } = splitName(name);
  const created = await contactsRef.add({
    organizationId,
    firstName,
    lastName,
    email,
    phone: "",
    mobile: "",
    role,
    jobTitle: "",
    status: "active",
    isPrimary: role === "primary",
    hasPortalAccess: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return created.id;
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const authUser = await admin.auth().getUser(userId);
    const email = authUser.email?.toLowerCase().trim();
    if (!email) {
      return NextResponse.json({ error: "User email missing." }, { status: 400 });
    }

    const invitesRef = admin.firestore().collection(COLLECTIONS.USER_INVITES);
    const invitesSnap = await invitesRef.where("email", "==", email).get();
    const inviteDoc = invitesSnap.docs.find(
      (docSnap) => (docSnap.data() as InviteRecord).status === "pending"
    );
    if (!inviteDoc) {
      const mode = req.nextUrl.searchParams.get("mode");
      if (mode === "cleanup") {
        return NextResponse.json({ status: "no_invite" }, { status: 200 });
      }
      return NextResponse.json({ error: "Invite not found." }, { status: 403 });
    }

    const invite = inviteDoc.data() as InviteRecord;
    const organizationId = invite.organizationId;
    if (!organizationId) {
      return NextResponse.json({ error: "Invite missing organisation." }, { status: 400 });
    }

    const name = invite.name || authUser.displayName || email.split("@")[0] || "User";
    const contactRole =
      invite.role === "admin"
        ? "management"
        : invite.role === "technician"
          ? "technical"
          : "primary";

    const contactId = await ensureContact({
      organizationId,
      email,
      name,
      role: contactRole,
      contactId: invite.contactId,
    });

    const organizationName = invite.organizationName || "";

    const now = admin.firestore.Timestamp.now();
    const newUser: User = {
      uid: authUser.uid,
      email: authUser.email || email,
      role: invite.role,
      name,
      organizationId,
      organizationName,
      contactId,
      createdAt: now as unknown as User["createdAt"],
      updatedAt: now as unknown as User["updatedAt"],
    };

    await admin.firestore().collection(COLLECTIONS.USERS).doc(authUser.uid).set(newUser, {
      merge: true,
    });

    await inviteDoc.ref.set(
      {
        status: "accepted",
        userId: authUser.uid,
        acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json({ user: newUser });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to accept invite.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
