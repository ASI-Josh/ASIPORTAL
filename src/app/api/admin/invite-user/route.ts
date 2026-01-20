import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";

const DEFAULT_APP_URL = "https://asiportal.online";

type InvitePayload = {
  email: string;
  firstName?: string;
  lastName?: string;
  role: "admin" | "technician" | "client" | "contractor";
  organizationId?: string;
};

const ASI_DOMAIN = "asi-australia.com.au";

function normalizeAppUrl(value: string) {
  return value.trim().replace(/\.+$/, "").replace(/\/+$/, "");
}

const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "icloud.com",
  "bigpond.com",
]);

function getEmailDomain(email: string) {
  const parts = email.toLowerCase().trim().split("@");
  return parts.length === 2 ? parts[1] : "";
}

async function ensureAsiOrganization() {
  const orgsRef = admin.firestore().collection(COLLECTIONS.CONTACT_ORGANIZATIONS);
  const existing = await orgsRef.where("domains", "array-contains", ASI_DOMAIN).limit(1).get();
  if (!existing.empty) {
    const docSnap = existing.docs[0];
    return { id: docSnap.id, ...(docSnap.data() as { name?: string }) };
  }
  const created = await orgsRef.add({
    name: "ASI Australia",
    category: "asi_staff",
    type: "partner",
    status: "active",
    domains: [ASI_DOMAIN],
    portalRole: "technician",
    phone: "",
    email: `admin@${ASI_DOMAIN}`,
    sites: [],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { id: created.id, name: "ASI Australia" };
}

async function ensureContact(params: {
  organizationId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: "primary" | "billing" | "technical" | "management";
}) {
  const { organizationId, email, firstName, lastName, role } = params;
  const contactsRef = admin.firestore().collection(COLLECTIONS.ORGANIZATION_CONTACTS);
  const existing = await contactsRef.where("email", "==", email).get();
  const match = existing.docs.find(
    (docSnap) => docSnap.data().organizationId === organizationId
  );
  if (match) {
    await match.ref.set(
      {
        firstName,
        lastName,
        role,
        hasPortalAccess: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return match.id;
  }
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
    const userSnap = await admin.firestore().collection(COLLECTIONS.USERS).doc(userId).get();
    const role = userSnap.data()?.role;
    if (role !== "admin") {
      return NextResponse.json({ error: "Not authorised." }, { status: 403 });
    }

    const payload = (await req.json()) as InvitePayload;
    const email = payload.email?.toLowerCase().trim();
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Valid email is required." }, { status: 400 });
    }

    const inviteRole = payload.role;
    if (!inviteRole) {
      return NextResponse.json({ error: "Role is required." }, { status: 400 });
    }

    const displayName =
      `${payload.firstName || ""} ${payload.lastName || ""}`.trim() ||
      email.split("@")[0];
    const { firstName, lastName } = {
      firstName: payload.firstName?.trim() || displayName.split(" ")[0] || "User",
      lastName: payload.lastName?.trim() || displayName.split(" ").slice(1).join(" "),
    };

    let organizationId = payload.organizationId?.trim();
    let organizationName = "";
    if (inviteRole === "admin" || inviteRole === "technician") {
      const asiOrg = await ensureAsiOrganization();
      organizationId = asiOrg.id;
      organizationName = asiOrg.name || "ASI Australia";
    } else {
      if (!organizationId) {
        return NextResponse.json(
          { error: "Organisation is required for client/contractor invites." },
          { status: 400 }
        );
      }
      const orgSnap = await admin
        .firestore()
        .collection(COLLECTIONS.CONTACT_ORGANIZATIONS)
        .doc(organizationId)
        .get();
      if (!orgSnap.exists) {
        return NextResponse.json({ error: "Organisation not found." }, { status: 404 });
      }
      organizationName = (orgSnap.data()?.name as string) || "";
    }

    const contactRole =
      inviteRole === "admin"
        ? "management"
        : inviteRole === "technician"
          ? "technical"
          : "primary";
    const contactId = await ensureContact({
      organizationId,
      email,
      firstName,
      lastName,
      role: contactRole,
    });

    const invitesRef = admin.firestore().collection(COLLECTIONS.USER_INVITES);
    const existing = await invitesRef.where("email", "==", email).get();
    const existingPending = existing.docs.find(
      (docSnap) => docSnap.data().status === "pending"
    );
    const inviteRef = existingPending ? existingPending.ref : invitesRef.doc();
    await inviteRef.set(
      {
        email,
        name: displayName,
        role: inviteRole,
        organizationId,
        organizationName,
        contactId,
        invitedBy: userId,
        status: "pending",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: existingPending
          ? existingPending.data().createdAt
          : admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const appUrl = normalizeAppUrl(process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL);
    await admin.firestore().collection(COLLECTIONS.MAIL).add({
      to: [email],
      message: {
        subject: "ASI Portal access invitation",
        text:
          `Hi ${firstName},\n\n` +
          `Your ASI Portal access is ready. Please sign in to access your portal:\n` +
          `${appUrl}\n\n` +
          `Use your email address (${email}) and continue with Google to activate your access.\n` +
          `If you need an email/password login instead, contact support.\n` +
          `If you need help, email support@asi-australia.com.au.\n\n` +
          `Cheers,\nASI Team`,
      },
    });

    return NextResponse.json({ inviteId: inviteRef.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send invite.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
