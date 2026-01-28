import admin from "firebase-admin";

// Initialize the default app for admin if not already initialized.
function initAdmin() {
  if (admin.apps && admin.apps.length) return admin.app();

  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKeyBase64 = process.env.FIREBASE_PRIVATE_KEY_B64;
  const resolvedPrivateKey =
    privateKeyBase64 ? Buffer.from(privateKeyBase64, "base64").toString("utf8") : undefined;
  const privateKey = resolvedPrivateKey?.replace(/\\n/g, "\n");
  const projectId = process.env.FIREBASE_PROJECT_ID;

  if (!clientEmail || !privateKey || !projectId) {
    // We intentionally do not throw here to allow admin-less local operations
    // when only client SDK is used. Callers that require admin should check.
    console.warn("firebase-admin not fully configured: missing FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY_B64 or FIREBASE_PROJECT_ID");
  }

  const credential = admin.credential.cert({
    clientEmail: clientEmail || "",
    privateKey: privateKey || "",
    projectId: projectId || "",
  });

  return admin.initializeApp({
    credential,
    projectId,
  });
}

const adminApp = initAdmin();

export { adminApp, admin };
