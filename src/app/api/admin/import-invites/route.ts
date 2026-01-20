import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";

const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "icloud.com",
  "bigpond.com",
]);

const DEFAULT_APP_URL = "https://asiportal.live";

function getEmailDomain(email: string) {
  const parts = email.toLowerCase().trim().split("@");
  return parts.length === 2 ? parts[1] : "";
}

function normalizeAppUrl(value: string) {
  return value.trim().replace(/\.+$/, "").replace(/\/+$/, "");
}

function parseDelimited(content: string, delimiter: string) {
  const rows = content.split(/\r?\n/).filter(Boolean);
  if (rows.length === 0) return [];
  const headers = rows[0].split(delimiter).map((header) => header.trim());
  return rows.slice(1).map((line) => {
    const values = line.split(delimiter);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = (values[index] || "").trim();
    });
    return row;
  });
}

function collectContacts(row: Record<string, string>) {
  const contacts: Array<{ firstName: string; lastName: string; email: string; role: string }> = [];
  if (row.EmailAddress) {
    contacts.push({
      firstName: row.FirstName || row.ContactName?.split(" ")[0] || "Contact",
      lastName: row.LastName || "",
      email: row.EmailAddress.toLowerCase().trim(),
      role: "primary",
    });
  }

  if (row.Person1Email) {
    contacts.push({
      firstName: row.Person1FirstName || "Contact",
      lastName: row.Person1LastName || "",
      email: row.Person1Email.toLowerCase().trim(),
      role: "primary",
    });
  }
  if (row.Person2Email) {
    contacts.push({
      firstName: row.Person2FirstName || "Contact",
      lastName: row.Person2LastName || "",
      email: row.Person2Email.toLowerCase().trim(),
      role: "primary",
    });
  }
  if (row.Person3Email) {
    const include = String(row.Person3IncludeInEmail || "").toLowerCase();
    if (!include || include === "yes" || include === "true") {
      contacts.push({
        firstName: row.Person3FirstName || "Contact",
        lastName: "",
        email: row.Person3Email.toLowerCase().trim(),
        role: "primary",
      });
    }
  }
  if (row.Person4Email) {
    contacts.push({
      firstName: row.Person4FirstName || "Contact",
      lastName: row.Person4LastName || "",
      email: row.Person4Email.toLowerCase().trim(),
      role: "primary",
    });
  }
  return contacts.filter((contact) => contact.email);
}

async function ensureOrg(
  orgsByName: Map<string, { id: string; name: string }>,
  row: Record<string, string>
) {
  const name = row.ContactName?.trim();
  if (!name) return null;
  const key = name.toLowerCase();
  if (orgsByName.has(key)) return orgsByName.get(key)!;

  const email = row.EmailAddress || "";
  const domain = getEmailDomain(email);
  const domains = domain && !PUBLIC_EMAIL_DOMAINS.has(domain) ? [domain] : [];
  const orgRef = await admin.firestore().collection(COLLECTIONS.CONTACT_ORGANIZATIONS).add({
    name,
    category: "trade_client",
    type: "customer",
    status: "active",
    abn: row.ABN || "",
    phone: row.PhoneNumber || "",
    email,
    website: row.Website || "",
    domains,
    portalRole: "client",
    address: row.AddressLine1
      ? {
          street: row.AddressLine1,
          suburb: row.City || "",
          state: row.Region || "",
          postcode: row.PostalCode || "",
          country: row.SACountry || "Australia",
        }
      : undefined,
    sites: row.AddressLine1
      ? [
          {
            id: `site-${Date.now()}`,
            name: "Main Location",
            address: {
              street: row.AddressLine1,
              suburb: row.City || "",
              state: row.Region || "",
              postcode: row.PostalCode || "",
              country: row.SACountry || "Australia",
            },
            isDefault: true,
          },
        ]
      : [],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const orgData = { id: orgRef.id, name };
  orgsByName.set(key, orgData);
  return orgData;
}

async function ensureContact(
  organizationId: string,
  contact: { firstName: string; lastName: string; email: string; role: string },
  isPrimary: boolean
) {
  const contactsRef = admin.firestore().collection(COLLECTIONS.ORGANIZATION_CONTACTS);
  const existing = await contactsRef.where("email", "==", contact.email).get();
  const match = existing.docs.find(
    (docSnap) => docSnap.data().organizationId === organizationId
  );
  if (match) {
    await match.ref.set(
      {
        firstName: contact.firstName,
        lastName: contact.lastName,
        isPrimary,
        hasPortalAccess: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return match.id;
  }

  const created = await contactsRef.add({
    organizationId,
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: contact.email,
    phone: "",
    mobile: "",
    role: contact.role || "primary",
    jobTitle: "",
    status: "active",
    isPrimary,
    hasPortalAccess: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return created.id;
}

async function ensureInvite(params: {
  email: string;
  name: string;
  organizationId: string;
  organizationName: string;
  contactId: string;
  invitedBy: string;
  sendEmails: boolean;
}) {
  const { email, name, organizationId, organizationName, contactId, invitedBy, sendEmails } =
    params;
  const invitesRef = admin.firestore().collection(COLLECTIONS.USER_INVITES);
  const existing = await invitesRef.where("email", "==", email).get();
  const pending = existing.docs.find((docSnap) => docSnap.data().status === "pending");
  const inviteRef = pending ? pending.ref : invitesRef.doc();

  await inviteRef.set(
    {
      email,
      name,
      role: "client",
      organizationId,
      organizationName,
      contactId,
      invitedBy,
      status: "pending",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: pending ? pending.data().createdAt : admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  if (sendEmails) {
    const appUrl = normalizeAppUrl(process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL);
    await admin.firestore().collection(COLLECTIONS.MAIL).add({
      to: [email],
      message: {
        subject: "ASI Portal access invitation",
        text:
          `Hi ${name},\n\n` +
          `Your ASI Portal access is ready. Please sign in here:\n` +
          `${appUrl}\n\n` +
          `Use your email address (${email}) and continue with Google to activate your access.\n` +
          `If you need an email/password login instead, contact support.\n` +
          `If you need help, email support@asi-australia.com.au.\n\n` +
          `Cheers,\nASI Team`,
      },
    });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const userSnap = await admin.firestore().collection(COLLECTIONS.USERS).doc(userId).get();
    const role = userSnap.data()?.role;
    if (role !== "admin") {
      return NextResponse.json({ error: "Not authorised." }, { status: 403 });
    }

    const form = await req.formData();
    const file = form.get("file");
    const sendEmails = String(form.get("sendEmails") || "true") === "true";
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "CSV/TSV file is required." }, { status: 400 });
    }

    const content = await file.text();
    const delimiter = content.includes("\t") ? "\t" : ",";
    const rows = parseDelimited(content, delimiter);

    const orgsSnap = await admin.firestore().collection(COLLECTIONS.CONTACT_ORGANIZATIONS).get();
    const orgsByName = new Map(
      orgsSnap.docs.map((docSnap) => {
        const data = docSnap.data();
        return [String(data.name || "").toLowerCase(), { id: docSnap.id, name: data.name }];
      })
    );

    for (const row of rows) {
      const org = await ensureOrg(orgsByName, row);
      if (!org) continue;
      const contacts = collectContacts(row);
      let isPrimary = true;
      for (const contact of contacts) {
        const contactId = await ensureContact(org.id, contact, isPrimary);
        isPrimary = false;
        await ensureInvite({
          email: contact.email,
          name: `${contact.firstName} ${contact.lastName}`.trim() || contact.email,
          organizationId: org.id,
          organizationName: org.name,
          contactId,
          invitedBy: userId,
          sendEmails,
        });
      }
    }

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to import invites.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
