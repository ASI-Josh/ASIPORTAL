import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const userSnap = await admin.firestore().collection(COLLECTIONS.USERS).doc(userId).get();
    const role = userSnap.data()?.role;
    const organizationId = userSnap.data()?.organizationId as string | undefined;
    if (role !== "client" && role !== "contractor") {
      return NextResponse.json({ error: "Not authorised." }, { status: 403 });
    }
    if (!organizationId) {
      return NextResponse.json({ error: "Organisation not found." }, { status: 400 });
    }

    const payload = (await req.json()) as {
      inspectionId?: string;
      approvalStatus?: string;
      clientSchedulingNote?: string;
      clientVehicleJobRefs?: Record<string, string>;
    };
    if (!payload.inspectionId) {
      return NextResponse.json({ error: "Inspection ID is required." }, { status: 400 });
    }

    const inspectionRef = admin
      .firestore()
      .collection(COLLECTIONS.INSPECTIONS)
      .doc(payload.inspectionId);
    const inspectionSnap = await inspectionRef.get();
    if (!inspectionSnap.exists) {
      return NextResponse.json({ error: "Inspection not found." }, { status: 404 });
    }

    const inspection = inspectionSnap.data() as {
      organizationId?: string;
      convertedToJobId?: string;
      scheduledDate?: FirebaseFirestore.Timestamp;
    };
    if (inspection.organizationId !== organizationId) {
      return NextResponse.json({ error: "Not authorised." }, { status: 403 });
    }
    if (!inspection.convertedToJobId) {
      return NextResponse.json(
        { error: "RFQ job has not been generated yet." },
        { status: 400 }
      );
    }

    const now = admin.firestore.Timestamp.now();
    await inspectionRef.set(
      {
        status: "approved",
        approvedAt: now,
        clientApprovalStatus: payload.approvalStatus || "approved",
        clientApprovalUpdatedAt: now,
        updatedAt: now,
        clientSchedulingNote: payload.clientSchedulingNote || "",
        clientVehicleJobRefs: payload.clientVehicleJobRefs || {},
      },
      { merge: true }
    );

    const jobRef = admin.firestore().collection(COLLECTIONS.JOBS).doc(inspection.convertedToJobId);
    const jobSnap = await jobRef.get();
    if (jobSnap.exists) {
      const jobData = jobSnap.data() || {};
      const statusLog = Array.isArray(jobData.statusLog) ? jobData.statusLog : [];
      await jobRef.set(
        {
          status: "scheduled",
          statusLog: [
            ...statusLog,
            {
              status: "scheduled",
              changedAt: now,
              changedBy: userId,
              notes: "RFQ approved by client",
            },
          ],
          scheduledDate: inspection.scheduledDate || jobData.scheduledDate || now,
          updatedAt: now,
          clientSchedulingNote: payload.clientSchedulingNote || "",
          clientVehicleJobRefs: payload.clientVehicleJobRefs || {},
        },
        { merge: true }
      );
    }

    const worksQuery = await admin
      .firestore()
      .collection(COLLECTIONS.WORKS_REGISTER)
      .where("jobId", "==", inspection.convertedToJobId)
      .limit(1)
      .get();
    if (!worksQuery.empty) {
      const entryRef = worksQuery.docs[0].ref;
      await entryRef.set(
        {
          recordType: "job",
          startDate: inspection.scheduledDate || now,
        },
        { merge: true }
      );
    }

    const adminsSnap = await admin
      .firestore()
      .collection(COLLECTIONS.USERS)
      .where("role", "==", "admin")
      .get();
    const batch = admin.firestore().batch();
    adminsSnap.docs.forEach((adminDoc) => {
      const notificationRef = admin
        .firestore()
        .collection(COLLECTIONS.NOTIFICATIONS)
        .doc();
      batch.set(notificationRef, {
        userId: adminDoc.id,
        type: "quote_approved",
        title: "Inspection approved by client",
        message: payload.clientSchedulingNote
          ? `Client approval received. Scheduling note: ${payload.clientSchedulingNote}`
          : "Client approval received. Review and schedule the RFQ job.",
        read: false,
        relatedEntityId: payload.inspectionId,
        relatedEntityType: "inspection",
        createdAt: now,
      });
    });
    await batch.commit();

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to approve inspection.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
