/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const COLLECTIONS = {
  CONTACT_ORGANIZATIONS: "contactOrganizations",
  ORGANIZATION_CONTACTS: "organizationContacts",
  USER_INVITES: "userInvites",
  MAIL: "mail",
};

const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "icloud.com",
  "bigpond.com",
]);

const DEFAULT_APP_URL = "https://asiportal.live";

function getEmailDomain(email) {
  const parts = String(email || "").toLowerCase().trim().split("@");
  return parts.length === 2 ? parts[1] : "";
}

function parseDelimited(content, delimiter) {
  const rows = content.split(/\r?\n/).filter(Boolean);
  if (rows.length === 0) return [];
  const headers = rows[0].split(delimiter).map((h) => h.trim());
  return rows.slice(1).map((line) => {
    const values = line.split(delimiter);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = (values[index] || "").trim();
    });
    return row;
  });
}

function resolvePrivateKey() {
  const raw = process.env.FIREBASE_PRIVATE_KEY;
  const base64 = process.env.FIREBASE_PRIVATE_KEY_B64;
  const resolved = raw || (base64 ? Buffer.from(base64, "base64").toString("utf8") : "");
  return resolved.replace(/\\n/g, "\n");
}

function initAdmin() {
  if (admin.apps && admin.apps.length) return admin.app();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const privateKey = resolvePrivateKey();
  if (!clientEmail || !projectId || !privateKey) {
    throw new Error("Missing FIREBASE_CLIENT_EMAIL, FIREBASE_PROJECT_ID or FIREBASE_PRIVATE_KEY.");
  }
  admin.initializeApp({
    credential: admin.credential.cert({
      clientEmail,
      projectId,
      privateKey,
    }),
    projectId,
  });
  return admin.app();
}

async function ensureOrg(orgsByName, row) {
  const name = row.ContactName.trim();
  const key = name.toLowerCase();
  if (orgsByName.has(key)) return orgsByName.get(key);

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

async function ensureContact(orgId, contact, isPrimary) {
  const contactsRef = admin.firestore().collection(COLLECTIONS.ORGANIZATION_CONTACTS);
  const existing = await contactsRef.where("email", "==", contact.email).get();
  const match = existing.docs.find((docSnap) => docSnap.data().organizationId === orgId);
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
    organizationId: orgId,
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: contact.email,
    phone: contact.phone || "",
    mobile: contact.phone || "",
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

async function ensureInvite(invite, sendEmails) {
  const invitesRef = admin.firestore().collection(COLLECTIONS.USER_INVITES);
  const existing = await invitesRef.where("email", "==", invite.email).get();
  const pending = existing.docs.find((docSnap) => docSnap.data().status === "pending");
  const inviteRef = pending ? pending.ref : invitesRef.doc();
  await inviteRef.set(
    {
      email: invite.email,
      name: invite.name,
      role: invite.role,
      organizationId: invite.organizationId,
      organizationName: invite.organizationName,
      contactId: invite.contactId,
      invitedBy: "bulk-import",
      status: "pending",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: pending ? pending.data().createdAt : admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  if (sendEmails) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL;
    await admin.firestore().collection(COLLECTIONS.MAIL).add({
      to: [invite.email],
      message: {
        subject: "ASI Portal access invitation",
        text:
          `Hi ${invite.name},\n\n` +
          `Your ASI Portal access is ready. Please sign in here:\n` +
          `${appUrl}\n\n` +
          `Use your email address (${invite.email}) and continue with Google to activate your access.\n` +
          `If you need an email/password login instead, contact support.\n` +
          `If you need help, email support@asi-australia.com.au.\n\n` +
          `Cheers,\nASI Team`,
      },
    });
  }
}

function collectContacts(row) {
  const contacts = [];
  if (row.EmailAddress) {
    contacts.push({
      firstName: row.FirstName || row.ContactName.split(" ")[0] || "Contact",
      lastName: row.LastName || "",
      email: row.EmailAddress.toLowerCase().trim(),
      phone: row.PhoneNumber || "",
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

async function run() {
  const fileArg = process.argv[2];
  const sendEmails = process.argv.includes("--send");
  if (!fileArg) {
    console.error("Usage: node scripts/import-invites.js <path-to-csv-or-tsv> [--send]");
    process.exit(1);
  }

  initAdmin();

  const filePath = path.resolve(process.cwd(), fileArg);
  const content = fs.readFileSync(filePath, "utf8");
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
    if (!row.ContactName) continue;
    const org = await ensureOrg(orgsByName, row);
    const contacts = collectContacts(row);
    let first = true;
    for (const contact of contacts) {
      const contactId = await ensureContact(org.id, contact, first);
      first = false;
      await ensureInvite(
        {
          email: contact.email,
          name: `${contact.firstName} ${contact.lastName}`.trim() || contact.email,
          role: "client",
          organizationId: org.id,
          organizationName: org.name,
          contactId,
        },
        sendEmails
      );
      console.log(`Invite queued for ${contact.email} (${org.name})`);
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
