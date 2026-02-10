import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";

type TimestampMap = { seconds: number; nanoseconds: number };

function isTimestampMap(value: unknown): value is TimestampMap {
  if (!value || typeof value !== "object") return false;
  const maybe = value as Partial<TimestampMap>;
  return typeof maybe.seconds === "number" && typeof maybe.nanoseconds === "number";
}

function isTraversableObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (value instanceof admin.firestore.Timestamp) return false;
  if (value instanceof Date) return false;
  if (Array.isArray(value)) return false;
  return true;
}

function pruneUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((item) => pruneUndefined(item))
      .filter((item) => item !== undefined) as unknown as T;
  }

  if (isTraversableObject(value)) {
    const cleaned: Record<string, unknown> = {};
    Object.entries(value).forEach(([key, val]) => {
      if (val === undefined) return;
      const nextVal = pruneUndefined(val);
      if (nextVal !== undefined) {
        cleaned[key] = nextVal;
      }
    });
    return cleaned as T;
  }

  return value;
}

function coerceTimestamp(value: unknown): FirebaseFirestore.Timestamp | null {
  if (!value) return null;
  if (value instanceof admin.firestore.Timestamp) return value;
  if (value instanceof Date) return admin.firestore.Timestamp.fromDate(value);
  if (isTimestampMap(value)) return new admin.firestore.Timestamp(value.seconds, value.nanoseconds);
  const hasToDate = (value as { toDate?: () => Date }).toDate;
  if (typeof hasToDate === "function") {
    const date = hasToDate.call(value);
    if (date instanceof Date && !Number.isNaN(date.getTime())) {
      return admin.firestore.Timestamp.fromDate(date);
    }
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return admin.firestore.Timestamp.fromDate(date);
    }
  }
  return null;
}

async function generateBookingNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const snapshot = await admin
    .firestore()
    .collection(COLLECTIONS.BOOKINGS)
    .where("bookingNumber", ">=", `BK-${year}-`)
    .where("bookingNumber", "<", `BK-${year + 1}-`)
    .orderBy("bookingNumber", "desc")
    .limit(1)
    .get();

  if (snapshot.empty) {
    return `BK-${year}-0001`;
  }

  const last = String(snapshot.docs[0].data()?.bookingNumber || "");
  const lastNumber = Number.parseInt(last.split("-")[2] || "0", 10);
  const nextNumber = (lastNumber + 1).toString().padStart(4, "0");
  return `BK-${year}-${nextNumber}`;
}

function deriveBookingType(inspectionData: Record<string, unknown>) {
  const reports = Array.isArray(inspectionData.vehicleReports) ? inspectionData.vehicleReports : [];
  const weights = new Map<string, number>();

  reports.forEach((report) => {
    if (!report || typeof report !== "object") return;
    const damages = Array.isArray((report as Record<string, unknown>).damages)
      ? ((report as Record<string, unknown>).damages as unknown[])
      : [];
    damages.forEach((damage) => {
      if (!damage || typeof damage !== "object") return;
      const record = damage as Record<string, unknown>;
      const repairType = typeof record.repairType === "string" ? record.repairType : null;
      if (!repairType) return;
      const totalCost = typeof record.totalCost === "number" ? record.totalCost : null;
      const estimatedCost = typeof record.estimatedCost === "number" ? record.estimatedCost : null;
      const weight = totalCost ?? estimatedCost ?? 1;
      weights.set(repairType, (weights.get(repairType) ?? 0) + weight);
    });
  });

  if (weights.size === 0) return "scratch_graffiti_removal";

  let bestType = "scratch_graffiti_removal";
  let bestWeight = -1;
  weights.forEach((weight, type) => {
    if (weight > bestWeight) {
      bestWeight = weight;
      bestType = type;
    }
  });

  return bestType;
}

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

    const inspectionData = (inspectionSnap.data() || {}) as Record<string, unknown>;

    const inspection = inspectionData as {
      organizationId?: string;
      convertedToJobId?: string;
      scheduledDate?: unknown;
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
        status: "converted",
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
      const resolvedScheduledDate =
        coerceTimestamp(inspectionData.scheduledDate) || coerceTimestamp(jobData.scheduledDate) || now;
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
          scheduledDate: resolvedScheduledDate,
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
          startDate:
            coerceTimestamp(inspectionData.scheduledDate) || now,
        },
        { merge: true }
      );
    }

    const bookingQuery = await admin
      .firestore()
      .collection(COLLECTIONS.BOOKINGS)
      .where("convertedJobId", "==", inspection.convertedToJobId)
      .limit(1)
      .get();

    const bookingPayload = (() => {
      const scheduledDate =
        coerceTimestamp(inspectionData.scheduledDate) || now;
      const scheduledTime =
        typeof inspectionData.scheduledTime === "string" && inspectionData.scheduledTime
          ? inspectionData.scheduledTime
          : "07:00";
      const assignedStaff = Array.isArray(inspectionData.assignedStaff)
        ? inspectionData.assignedStaff
        : [];
      const allocatedStaffIds = assignedStaff
        .map((staff) => (staff && typeof staff === "object" ? (staff as Record<string, unknown>).id : null))
        .filter((value): value is string => typeof value === "string");

      const siteLocationRaw = inspectionData.siteLocation;
      const siteLocation =
        siteLocationRaw && typeof siteLocationRaw === "object"
          ? siteLocationRaw
          : null;

      return {
        bookingType: deriveBookingType(inspectionData),
        organizationId: (inspectionData.organizationId as string | undefined) || organizationId,
        organizationName:
          (inspectionData.organizationName as string | undefined) ||
          (inspectionData.clientName as string | undefined) ||
          "Organisation",
        contactId: (inspectionData.contactId as string | undefined) || "",
        contactName: (inspectionData.contactName as string | undefined) || "",
        contactEmail: (inspectionData.clientEmail as string | undefined) || "",
        contactPhone: (inspectionData.clientPhone as string | undefined) || undefined,
        siteLocation: siteLocation || {
          name: "Site",
          address: { street: "", suburb: "", state: "", postcode: "", country: "Australia" },
        },
        scheduledDate,
        scheduledTime,
        allocatedStaff: assignedStaff,
        allocatedStaffIds,
        notes: (inspectionData.notes as string | undefined) || undefined,
        status: "converted_to_job",
        convertedJobId: inspection.convertedToJobId,
        updatedAt: now,
      };
    })();
    const cleanedBookingPayload = pruneUndefined(bookingPayload);

    if (!bookingQuery.empty) {
      await bookingQuery.docs[0].ref.set(cleanedBookingPayload, { merge: true });
    } else {
      const bookingNumber = await generateBookingNumber();
      const bookingRef = admin.firestore().collection(COLLECTIONS.BOOKINGS).doc();
      await bookingRef.set(
        pruneUndefined({
          ...cleanedBookingPayload,
          id: bookingRef.id,
          bookingNumber,
          resourceDurationTemplate: "short",
          createdAt: now,
          createdBy: userId,
        })
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
