/* eslint-disable no-console */
/**
 * One-time script: load the Google service account JSON key from a local
 * file and store it in Firestore at secureCredentials/gmailServiceAccount.
 *
 * We store the key in Firestore rather than as a Netlify env var because
 * base64-encoding the full key (~3.2KB) pushes Lambda env vars past the
 * 4KB ceiling.
 *
 * Usage:
 *   node scripts/seed-gmail-service-account.js <path-to-key.json>
 *
 * The script:
 *   1. Reads the file
 *   2. Validates it's a service account JSON (has client_email + private_key)
 *   3. Base64-encodes the raw file contents
 *   4. Writes to Firestore at secureCredentials/gmailServiceAccount
 *
 * Firebase Admin credentials come from the usual env vars
 * (FIREBASE_CLIENT_EMAIL, FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY_B64),
 * loaded from .env.local via dotenv.
 */

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

// Load .env.local so FIREBASE_* vars are available when running locally
try {
  require("dotenv").config({ path: path.resolve(__dirname, "../.env.local") });
} catch {
  // dotenv optional — fall through if it's not installed
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
    throw new Error(
      "Missing FIREBASE_CLIENT_EMAIL, FIREBASE_PROJECT_ID or FIREBASE_PRIVATE_KEY(_B64). " +
      "Ensure .env.local is present and complete."
    );
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

async function main() {
  const keyPath = process.argv[2];
  if (!keyPath) {
    console.error("Usage: node scripts/seed-gmail-service-account.js <path-to-key.json>");
    process.exit(1);
  }

  const absolute = path.resolve(keyPath);
  if (!fs.existsSync(absolute)) {
    console.error(`File not found: ${absolute}`);
    process.exit(1);
  }

  const rawBytes = fs.readFileSync(absolute);
  const rawString = rawBytes.toString("utf-8");

  // Validate it looks like a service account key
  let parsed;
  try {
    parsed = JSON.parse(rawString);
  } catch (err) {
    console.error("Failed to parse JSON:", err.message);
    process.exit(1);
  }

  if (parsed.type !== "service_account") {
    console.error(`File does not look like a service account key (type=${parsed.type}).`);
    process.exit(1);
  }
  if (!parsed.client_email || !parsed.private_key) {
    console.error("Key missing client_email or private_key.");
    process.exit(1);
  }
  if (!parsed.client_email.endsWith(".iam.gserviceaccount.com")) {
    console.error(`Unexpected client_email: ${parsed.client_email}`);
    process.exit(1);
  }

  console.log("Service account key validated:");
  console.log(`  client_email  : ${parsed.client_email}`);
  console.log(`  project_id    : ${parsed.project_id}`);
  console.log(`  private_key_id: ${parsed.private_key_id}`);

  const keyB64 = rawBytes.toString("base64");
  console.log(`  size (base64) : ${keyB64.length} chars`);

  initAdmin();
  const db = admin.firestore();
  const docRef = db.collection("secureCredentials").doc("gmailServiceAccount");

  await docRef.set({
    keyB64,
    clientEmail: parsed.client_email,
    projectId: parsed.project_id,
    privateKeyId: parsed.private_key_id,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    note: "Google service account for agent mailbox domain-wide delegation. See docs/gmail-service-account.md.",
  });

  console.log("\nSuccessfully wrote secureCredentials/gmailServiceAccount.");
  console.log("The Gmail MCP tools will now load the key from Firestore.");
  console.log("\nNext steps:");
  console.log("  1. Verify test with: gmail_status { from_account: 'accountmanager' }");
  console.log("  2. Once confirmed, remove GOOGLE_SERVICE_ACCOUNT_B64 from Netlify env vars");
  console.log("  3. Securely delete the local key file after verification");

  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
