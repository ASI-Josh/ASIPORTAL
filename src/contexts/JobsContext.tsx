"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from "react";
import {
  Timestamp,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
  updateDoc,
  setDoc,
  deleteField,
  deleteDoc,
  QueryConstraint,
} from "firebase/firestore";
import type {
  Job,
  Booking,
  WorksRegisterEntry,
  JobStatus,
  JobLifecycleStage,
  BookingType,
  ContactOrganization,
  OrganizationContact,
  SiteLocation,
} from "@/lib/types";
import {
  BOOKING_TYPE_LABELS,
} from "@/lib/types";
import {
  createJobFromBooking,
  createWorksRegisterEntry,
  jobToLifecycleCard,
  worksEntryToDisplay,
  JobLifecycleCard,
  WorksRegisterDisplay,
} from "@/lib/jobs-data";
import { COLLECTIONS, generateBookingNumber, generateJobNumber } from "@/lib/firestore";
import { db } from "@/lib/firebaseClient";
import { useAuth } from "@/contexts/AuthContext";

type CreateBookingInput = {
  bookingType: BookingType;
  organization: ContactOrganization;
  contact: OrganizationContact;
  siteLocation: SiteLocation;
  scheduledDate: Date;
  scheduledTime: string;
  allocatedStaff: {
    id: string;
    name: string;
    type: "asi_staff" | "subcontractor";
  }[];
  notes?: string;
};

interface JobsContextValue {
  jobs: Job[];
  deletedJobs: Job[];
  bookings: Booking[];
  worksRegister: WorksRegisterEntry[];
  loading: boolean;

  // Job operations
  updateJob: (jobId: string, updates: Partial<Job>) => Promise<void>;
  deleteJob: (jobId: string, deletedBy: string) => Promise<void>;
  hardDeleteJob: (jobId: string) => Promise<void>;
  restoreJob: (jobId: string, restoredBy: string) => Promise<void>;
  updateJobStatus: (
    jobId: string,
    status: JobStatus,
    changedBy: string,
    notes?: string
  ) => Promise<void>;
  updateJobLifecycleStage: (
    jobId: string,
    stage: JobLifecycleStage,
    changedBy: string
  ) => Promise<void>;
  getJobById: (jobId: string) => Job | undefined;
  getJobByNumber: (jobNumber: string) => Job | undefined;

  // Booking operations
  createBooking: (input: CreateBookingInput) => Promise<Job | null>;
  updateBooking: (bookingId: string, updates: Partial<Booking>) => Promise<void>;

  // Works register operations
  updateWorksRegisterEntry: (
    entryId: string,
    updates: Partial<WorksRegisterEntry>
  ) => Promise<void>;
  completeWorksRegisterEntry: (entryId: string, approvedBy: string) => Promise<void>;

  // Derived data for views
  getJobLifecycleCards: (serviceTypeMap: Record<string, string>) => JobLifecycleCard[];
  getWorksRegisterDisplayData: () => WorksRegisterDisplay[];
}

const JobsContext = createContext<JobsContextValue | undefined>(undefined);

function isTraversableObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (value instanceof Timestamp) return false;
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

function buildConstraintsForRole(
  role: string,
  userId: string,
  organizationId?: string
) {
  const jobConstraints: QueryConstraint[] = [];
  const bookingConstraints: QueryConstraint[] = [];
  const worksConstraints: QueryConstraint[] = [];

  if (role === "client" || role === "contractor") {
    if (organizationId) {
      jobConstraints.push(where("organizationId", "==", organizationId));
      bookingConstraints.push(where("organizationId", "==", organizationId));
      worksConstraints.push(where("organizationId", "==", organizationId));
    }
  } else if (role === "technician") {
    jobConstraints.push(where("assignedTechnicianIds", "array-contains", userId));
    bookingConstraints.push(where("allocatedStaffIds", "array-contains", userId));
    worksConstraints.push(where("technicianId", "==", userId));
  }

  jobConstraints.push(orderBy("createdAt", "desc"));
  bookingConstraints.push(orderBy("createdAt", "desc"));
  worksConstraints.push(orderBy("createdAt", "desc"));

  return { jobConstraints, bookingConstraints, worksConstraints };
}

export function JobsProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [deletedJobs, setDeletedJobs] = useState<Job[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [worksRegister, setWorksRegister] = useState<WorksRegisterEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setJobs([]);
      setBookings([]);
      setWorksRegister([]);
      setLoading(false);
      return;
    }

    if ((user.role === "client" || user.role === "contractor") && !user.organizationId) {
      setJobs([]);
      setBookings([]);
      setWorksRegister([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const { jobConstraints, bookingConstraints, worksConstraints } =
      buildConstraintsForRole(user.role, user.uid, user.organizationId);

    const jobsQuery = query(collection(db, COLLECTIONS.JOBS), ...jobConstraints);
    const bookingsQuery = query(collection(db, COLLECTIONS.BOOKINGS), ...bookingConstraints);
    const worksQuery = query(
      collection(db, COLLECTIONS.WORKS_REGISTER),
      ...worksConstraints
    );

    const unsubscribeJobs = onSnapshot(
      jobsQuery,
      (snapshot) => {
        const loaded = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<Job, "id">),
        }));
        setJobs(loaded.filter((job) => !job.isDeleted));
        setDeletedJobs(loaded.filter((job) => job.isDeleted));
        setLoading(false);
      },
      (error) => {
        console.warn("Failed to load jobs:", error);
        setJobs([]);
        setDeletedJobs([]);
        setLoading(false);
      }
    );

    const unsubscribeBookings = onSnapshot(
      bookingsQuery,
      (snapshot) => {
        setBookings(
          snapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as Omit<Booking, "id">),
          }))
        );
      },
      (error) => {
        console.warn("Failed to load bookings:", error);
        setBookings([]);
      }
    );

    const unsubscribeWorks = onSnapshot(
      worksQuery,
      (snapshot) => {
        setWorksRegister(
          snapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as Omit<WorksRegisterEntry, "id">),
          }))
        );
      },
      (error) => {
        console.warn("Failed to load works register:", error);
        setWorksRegister([]);
      }
    );

    return () => {
      unsubscribeJobs();
      unsubscribeBookings();
      unsubscribeWorks();
    };
  }, [user, authLoading]);

  const updateJob = useCallback(async (jobId: string, updates: Partial<Job>) => {
    const jobRef = doc(db, COLLECTIONS.JOBS, jobId);
    const payload = pruneUndefined({
      ...updates,
      updatedAt: Timestamp.now(),
    });
    await updateDoc(jobRef, payload);
  }, []);

  const deleteJob = useCallback(async (jobId: string, deletedBy: string) => {
    const jobRef = doc(db, COLLECTIONS.JOBS, jobId);
    await updateDoc(jobRef, {
      isDeleted: true,
      deletedAt: Timestamp.now(),
      deletedBy,
      updatedAt: Timestamp.now(),
    });
  }, []);

  const hardDeleteJob = useCallback(
    async (jobId: string) => {
      const jobRef = doc(db, COLLECTIONS.JOBS, jobId);
      await deleteDoc(jobRef);

      const worksEntry = worksRegister.find((entry) => entry.jobId === jobId);
      if (worksEntry) {
        await deleteDoc(doc(db, COLLECTIONS.WORKS_REGISTER, worksEntry.id));
      }

      const booking = bookings.find((item) => item.convertedJobId === jobId);
      if (booking) {
        await deleteDoc(doc(db, COLLECTIONS.BOOKINGS, booking.id));
      }
    },
    [bookings, worksRegister]
  );

  const restoreJob = useCallback(async (jobId: string, restoredBy: string) => {
    const jobRef = doc(db, COLLECTIONS.JOBS, jobId);
    await updateDoc(jobRef, {
      isDeleted: false,
      deletedAt: deleteField(),
      deletedBy: deleteField(),
      restoredAt: Timestamp.now(),
      restoredBy,
      updatedAt: Timestamp.now(),
    });
  }, []);

  const updateJobStatus = useCallback(
    async (jobId: string, status: JobStatus, changedBy: string, notes?: string) => {
      const job = jobs.find((j) => j.id === jobId);
      if (!job) return;
      const now = Timestamp.now();
      await updateJob(jobId, {
        status,
        statusLog: [
          ...job.statusLog,
          {
            status,
            changedAt: now,
            changedBy,
            notes,
          },
        ],
        completedDate: status === "completed" ? now : job.completedDate,
      });
    },
    [jobs, updateJob]
  );

  const updateJobLifecycleStage = useCallback(
    async (jobId: string, stage: JobLifecycleStage, changedBy: string) => {
      const statusMap: Record<JobLifecycleStage, JobStatus> = {
        rfq: "pending",
        job_scheduled: "scheduled",
        job_live: "in_progress",
        job_completed: "completed",
        management_closeoff: "completed",
      };
      const newStatus = statusMap[stage];
      await updateJobStatus(jobId, newStatus, changedBy, `Moved to ${stage.replace(/_/g, " ")}`);
    },
    [updateJobStatus]
  );

  const getJobById = useCallback(
    (jobId: string) =>
      jobs.find((j) => j.id === jobId) || deletedJobs.find((j) => j.id === jobId),
    [jobs, deletedJobs]
  );

  const getJobByNumber = useCallback(
    (jobNumber: string) =>
      jobs.find((j) => j.jobNumber === jobNumber) ||
      deletedJobs.find((j) => j.jobNumber === jobNumber),
    [jobs, deletedJobs]
  );

  const createBooking = useCallback(
    async (input: CreateBookingInput): Promise<Job | null> => {
      if (!user) return null;

      const bookingNumber = await generateBookingNumber();
      const jobNumber = await generateJobNumber(input.organization);
      const now = Timestamp.now();

      const bookingRef = doc(collection(db, COLLECTIONS.BOOKINGS));
      const booking: Booking = {
        id: bookingRef.id,
        bookingNumber,
        bookingType: input.bookingType,
        organizationId: input.organization.id,
        organizationName: input.organization.name,
        contactId: input.contact.id,
        contactName: `${input.contact.firstName} ${input.contact.lastName}`.trim(),
        contactEmail: input.contact.email,
        contactPhone: input.contact.mobile || input.contact.phone,
        siteLocation: {
          id: input.siteLocation.id,
          name: input.siteLocation.name,
          address: input.siteLocation.address,
        },
        scheduledDate: Timestamp.fromDate(input.scheduledDate),
        scheduledTime: input.scheduledTime,
        allocatedStaff: input.allocatedStaff,
        allocatedStaffIds: input.allocatedStaff.map((staff) => staff.id),
        notes: input.notes,
        status: "pending",
        createdAt: now,
        createdBy: user.uid,
        updatedAt: now,
      };

      await setDoc(bookingRef, booking);

      const jobRef = doc(collection(db, COLLECTIONS.JOBS));
      const job = createJobFromBooking({
        booking,
        bookingTypeLabelMap: BOOKING_TYPE_LABELS,
        jobId: jobRef.id,
        jobNumber,
      });

      await setDoc(jobRef, job);

      const worksRef = doc(collection(db, COLLECTIONS.WORKS_REGISTER));
      const primaryStaff = booking.allocatedStaff[0];
      const worksEntry = createWorksRegisterEntry({
        job,
        serviceType: BOOKING_TYPE_LABELS[booking.bookingType],
        technicianName: primaryStaff?.name || "Unassigned",
        entryId: worksRef.id,
      });

      await setDoc(worksRef, worksEntry);

      await updateDoc(bookingRef, {
        status: "converted_to_job",
        convertedJobId: job.id,
        updatedAt: Timestamp.now(),
      });

      return job;
    },
    [user]
  );

  const updateBooking = useCallback(async (bookingId: string, updates: Partial<Booking>) => {
    const bookingRef = doc(db, COLLECTIONS.BOOKINGS, bookingId);
    const payload = pruneUndefined({
      ...updates,
      updatedAt: Timestamp.now(),
    });
    await updateDoc(bookingRef, payload);
  }, []);

  const updateWorksRegisterEntry = useCallback(
    async (entryId: string, updates: Partial<WorksRegisterEntry>) => {
      const entryRef = doc(db, COLLECTIONS.WORKS_REGISTER, entryId);
      const payload = pruneUndefined(updates);
      await updateDoc(entryRef, payload);
    },
    []
  );

  const completeWorksRegisterEntry = useCallback(
    async (entryId: string, approvedBy: string) => {
      const now = Timestamp.now();
      const entryRef = doc(db, COLLECTIONS.WORKS_REGISTER, entryId);
      await updateDoc(entryRef, {
        completionDate: now,
        approvedBy,
        approvedAt: now,
      });
    },
    []
  );

  const getJobLifecycleCards = useCallback(
    (serviceTypeMap: Record<string, string>): JobLifecycleCard[] => {
      return jobs.map((job) => {
        const serviceType =
          job.notes?.split("\n")[0]?.replace("Service: ", "") || "Unknown";
        return jobToLifecycleCard(job, serviceType);
      });
    },
    [jobs]
  );

  const getWorksRegisterDisplayData = useCallback((): WorksRegisterDisplay[] => {
    return worksRegister.map(worksEntryToDisplay);
  }, [worksRegister]);

  const value: JobsContextValue = {
    jobs,
    deletedJobs,
    bookings,
    worksRegister,
    loading,
    updateJob,
    deleteJob,
    hardDeleteJob,
    restoreJob,
    updateJobStatus,
    updateJobLifecycleStage,
    getJobById,
    getJobByNumber,
    createBooking,
    updateBooking,
    updateWorksRegisterEntry,
    completeWorksRegisterEntry,
    getJobLifecycleCards,
    getWorksRegisterDisplayData,
  };

  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>;
}

export function useJobs() {
  const context = useContext(JobsContext);
  if (!context) {
    throw new Error("useJobs must be used within a JobsProvider");
  }
  return context;
}
