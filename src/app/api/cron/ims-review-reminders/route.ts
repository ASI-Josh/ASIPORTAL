/**
 * Daily cron — IMS document review reminder system.
 *
 * Runs every morning at 06:00 AEST (20:00 UTC). Scans all active IMS documents
 * with a reviewDueDate, and:
 *   - Sends reminders at T-30, T-14, T-0 days before the review due date
 *   - Marks documents as reviewOverdue: true when reviewDueDate < today
 *   - Writes in-app notifications to the Director
 *   - Writes to Firestore 'mail' collection (firestore-send-email extension)
 *     if ENABLE_EXTERNAL_EMAIL is truthy in env
 *
 * Triggered by netlify/functions/ims-review-reminders.js scheduled function.
 * Auth: requires Bearer token matching CRON_SECRET env var.
 */

import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";
import { ADMIN_EMAILS } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REMINDER_WINDOWS_DAYS = [30, 14, 0];
const DIRECTOR_EMAIL = ADMIN_EMAILS[0]; // joshua@asi-australia.com.au

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  return Math.floor((to - from) / 86400000);
}

async function resolveDirectorUserId(): Promise<string | null> {
  const snap = await admin.firestore()
    .collection(COLLECTIONS.USERS)
    .where("email", "==", DIRECTOR_EMAIL)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].id;
}

export async function GET(req: NextRequest) {
  // Auth — Bearer CRON_SECRET required (set in Netlify env vars)
  const authHeader = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET || "";
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const today = new Date().toISOString().split("T")[0];
  const directorUserId = await resolveDirectorUserId();

  // Fetch all active documents (small-to-medium volume; no composite index needed)
  const docsSnap = await db.collection(COLLECTIONS.IMS_DOCUMENTS)
    .where("approvalStatus", "==", "active")
    .get();

  const processed = {
    total: docsSnap.size,
    notified: 0,
    markedOverdue: 0,
    errors: [] as string[],
  };

  for (const doc of docsSnap.docs) {
    try {
      const data = doc.data();
      const reviewDueDate = data.reviewDueDate || data.nextReviewDate;
      if (typeof reviewDueDate !== "string" || !reviewDueDate) continue;

      const daysUntilReview = daysBetween(today, reviewDueDate);
      const reminderLog = (data.reviewReminderLog as Array<{ days: number; sentAt: string }>) || [];

      // Mark overdue
      if (daysUntilReview < 0 && !data.reviewOverdue) {
        await doc.ref.set({ reviewOverdue: true, updatedAt: now }, { merge: true });
        processed.markedOverdue++;
      }

      // Check if any reminder window is due
      let windowToSend: number | null = null;
      for (const window of REMINDER_WINDOWS_DAYS) {
        if (daysUntilReview <= window && daysUntilReview >= window - 1) {
          const alreadySent = reminderLog.some((r) => r.days === window);
          if (!alreadySent) {
            windowToSend = window;
            break;
          }
        }
      }
      // Also send on overdue (daysUntilReview < 0) once
      if (windowToSend === null && daysUntilReview < 0) {
        const alreadySentOverdue = reminderLog.some((r) => r.days === -1);
        if (!alreadySentOverdue) windowToSend = -1;
      }

      if (windowToSend === null) continue;

      // Build notification content
      const docId = String(data.docId || "IMS-???");
      const title = String(data.title || "Untitled");
      const windowLabel = windowToSend === 0 ? "due today"
        : windowToSend < 0 ? `overdue by ${Math.abs(daysUntilReview)} day${Math.abs(daysUntilReview) === 1 ? "" : "s"}`
        : `due in ${windowToSend} days`;

      const notificationTitle = `IMS document review ${windowLabel}`;
      const notificationMessage = `${docId} — ${title}. Review ${windowLabel}. Please review or reassign.`;

      // Write in-app notification
      if (directorUserId) {
        await db.collection(COLLECTIONS.NOTIFICATIONS).add({
          userId: directorUserId,
          type: "ims_review_reminder",
          title: notificationTitle,
          message: notificationMessage,
          read: false,
          relatedEntityId: doc.id,
          relatedEntityType: "ims_document",
          priority: windowToSend <= 0 ? "high" : "normal",
          createdAt: now,
        });
      }

      // Write to mail collection for firestore-send-email extension (if enabled)
      if (process.env.ENABLE_EXTERNAL_EMAIL === "true") {
        await db.collection(COLLECTIONS.MAIL).add({
          to: DIRECTOR_EMAIL,
          message: {
            subject: `[IMS] ${notificationTitle}`,
            text: `${notificationMessage}\n\nView at: https://asiportal.live/dashboard/ims/documents/${doc.id}`,
            html: `<p>${notificationMessage}</p><p><a href="https://asiportal.live/dashboard/ims/documents/${doc.id}">Open document in portal</a></p>`,
          },
          createdAt: now,
        });
      }

      // Append reminder log entry
      await doc.ref.set({
        reviewReminderLog: admin.firestore.FieldValue.arrayUnion({
          days: windowToSend,
          sentAt: new Date().toISOString(),
          window: windowLabel,
        }),
        updatedAt: now,
      }, { merge: true });

      processed.notified++;
    } catch (e) {
      processed.errors.push(`${doc.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    runAt: new Date().toISOString(),
    ...processed,
  });
}
