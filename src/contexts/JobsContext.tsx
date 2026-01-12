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
  bookings: Booking[];
  worksRegister: WorksRegisterEntry[];
  loading: boolean;

  // Job operations
  updateJob: (jobId: string, updates: Partial<Job>) => Promise<void>;
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

    const unsubscribeJobs = onSnapshot(jobsQuery, (snapshot) => {
      setJobs(
        snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<Job, "id">),
        }))
      );
      setLoading(false);
    });

    const unsubscribeBookings = onSnapshot(bookingsQuery, (snapshot) => {
      setBookings(
        snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<Booking, "id">),
        }))
      );
    });

    const unsubscribeWorks = onSnapshot(worksQuery, (snapshot) => {
      setWorksRegister(
        snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<WorksRegisterEntry, "id">),
        }))
      );
    });

    return () => {
      unsubscribeJobs();
      unsubscribeBookings();
      unsubscribeWorks();
    };
  }, [user, authLoading]);

  const updateJob = useCallback(async (jobId: string, updates: Partial<Job>) => {
    const jobRef = doc(db, COLLECTIONS.JOBS, jobId);
    await updateDoc(jobRef, {
      ...updates,
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
    (jobId: string) => jobs.find((j) => j.id === jobId),
    [jobs]
  );

  const getJobByNumber = useCallback(
    (jobNumber: string) => jobs.find((j) => j.jobNumber === jobNumber),
    [jobs]
  );

  const createBooking = useCallback(
    async (input: CreateBookingInput): Promise<Job | null> => {
      if (!user) return null;

      const bookingNumber = await generateBookingNumber();
      const jobNumber = await generateJobNumber();
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
    await updateDoc(bookingRef, {
      ...updates,
      updatedAt: Timestamp.now(),
    });
  }, []);

  const updateWorksRegisterEntry = useCallback(
    async (entryId: string, updates: Partial<WorksRegisterEntry>) => {
      const entryRef = doc(db, COLLECTIONS.WORKS_REGISTER, entryId);
      await updateDoc(entryRef, updates);
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
    bookings,
    worksRegister,
    loading,
    updateJob,
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
