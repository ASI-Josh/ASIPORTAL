/* eslint-disable no-console */
// One-shot rename: fix two MCP-created jobs that were assigned the global
// JOB-26-XXXX format. Renumber to the per-client NUL-26-XXXX series so they
// continue the historical Nuline Charter sequence.
//
// Usage: node scripts/rename-jobs-2026-04-29.js
//
// Safe to re-run: each rename is guarded by a from→to check; if the job
// already has the target jobNumber the script logs and skips.

const admin = require("firebase-admin");

const RENAMES = [
  { id: "iJdDTyVDjH1ZJCjK5voD", from: "JOB-26-0001", to: "NUL-26-0018" },
  { id: "md9gx59LcHvThb1dzz7R", from: "JOB-26-0002", to: "NUL-26-0019" },
];

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
    throw new Error("Missing FIREBASE_CLIENT_EMAIL, FIREBASE_PROJECT_ID or FIREBASE_PRIVATE_KEY(_B64).");
  }
  admin.initializeApp({
    credential: admin.credential.cert({ clientEmail, projectId, privateKey }),
    projectId,
  });
  return admin.app();
}

async function main() {
  initAdmin();
  const db = admin.firestore();
  const jobsCol = db.collection("jobs");
  const nowIso = new Date().toISOString();

  for (const rn of RENAMES) {
    const ref = jobsCol.doc(rn.id);
    const snap = await ref.get();
    if (!snap.exists) {
      console.error(`✗ Job '${rn.id}' not found — skipping.`);
      continue;
    }
    const data = snap.data();
    const current = data.jobNumber;

    if (current === rn.to) {
      console.log(`= Job ${rn.id} already at ${rn.to} — skipping.`);
      continue;
    }
    if (current !== rn.from) {
      console.error(`✗ Job ${rn.id} has unexpected jobNumber '${current}' (expected '${rn.from}'). Skipping for safety.`);
      continue;
    }

    const statusLog = Array.isArray(data.statusLog) ? [...data.statusLog] : [];
    statusLog.push({
      status: data.status || "scheduled",
      changedAt: nowIso,
      changedBy: "admin-rename-script",
      note: `Renumbered from ${rn.from} to ${rn.to} — restoring per-client NUL-26-XXXX convention (MCP create_job initial release used global format).`,
    });

    await ref.update({
      jobNumber: rn.to,
      statusLog,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`✓ ${rn.id}: ${rn.from} → ${rn.to}`);
  }

  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Rename failed:", err);
  process.exit(1);
});
