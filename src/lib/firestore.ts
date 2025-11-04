import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  QueryConstraint,
  Timestamp,
  DocumentData,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebaseClient";

// ============================================
// COLLECTION NAMES
// ============================================

export const COLLECTIONS = {
  USERS: "users",
  JOBS: "jobs",
  INSPECTIONS: "inspections",
  LEADS: "leads",
  SALES_ACTIVITIES: "salesActivities",
  SALES_TASKS: "salesTasks",
  CONTACT_ORGANIZATIONS: "contactOrganizations",
  ORGANIZATION_CONTACTS: "organizationContacts",
  FILMS: "films",
  FILM_CLAIMS: "filmClaims",
  QUOTES: "quotes",
  CALENDAR_EVENTS: "calendarEvents",
  CALENDAR_TOKENS: "calendarTokens",
  WORKS_REGISTER: "worksRegister",
  NOTIFICATIONS: "notifications",
} as const;

// ============================================
// GENERIC FIRESTORE OPERATIONS
// ============================================

export async function createDocument<T extends DocumentData>(
  collectionName: string,
  id: string,
  data: T
) {
  const docRef = doc(db, collectionName, id);
  await setDoc(docRef, {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return id;
}

export async function getDocument<T>(
  collectionName: string,
  id: string
): Promise<T | null> {
  const docRef = doc(db, collectionName, id);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    return { id: docSnap.id, ...docSnap.data() } as T;
  }
  return null;
}

export async function updateDocument<T extends DocumentData>(
  collectionName: string,
  id: string,
  data: Partial<T>
) {
  const docRef = doc(db, collectionName, id);
  await updateDoc(docRef, {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteDocument(collectionName: string, id: string) {
  const docRef = doc(db, collectionName, id);
  await deleteDoc(docRef);
}

export async function queryDocuments<T>(
  collectionName: string,
  constraints: QueryConstraint[] = []
): Promise<T[]> {
  const collectionRef = collection(db, collectionName);
  const q = query(collectionRef, ...constraints);
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as T[];
}

// ============================================
// AUTO-INCREMENT HELPERS
// ============================================

export async function generateJobNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const jobsRef = collection(db, COLLECTIONS.JOBS);
  const q = query(
    jobsRef,
    where("jobNumber", ">=", `JOB-${year}-`),
    where("jobNumber", "<", `JOB-${year + 1}-`),
    orderBy("jobNumber", "desc"),
    limit(1)
  );

  const snapshot = await getDocs(q);
  if (snapshot.empty) {
    return `JOB-${year}-0001`;
  }

  const lastJobNumber = snapshot.docs[0].data().jobNumber as string;
  const lastNumber = parseInt(lastJobNumber.split("-")[2]);
  const nextNumber = (lastNumber + 1).toString().padStart(4, "0");
  return `JOB-${year}-${nextNumber}`;
}

export async function generateInspectionNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const inspectionsRef = collection(db, COLLECTIONS.INSPECTIONS);
  const q = query(
    inspectionsRef,
    where("inspectionNumber", ">=", `INS-${year}-`),
    where("inspectionNumber", "<", `INS-${year + 1}-`),
    orderBy("inspectionNumber", "desc"),
    limit(1)
  );

  const snapshot = await getDocs(q);
  if (snapshot.empty) {
    return `INS-${year}-0001`;
  }

  const lastNumber = parseInt(
    snapshot.docs[0].data().inspectionNumber.split("-")[2]
  );
  const nextNumber = (lastNumber + 1).toString().padStart(4, "0");
  return `INS-${year}-${nextNumber}`;
}

export async function generateQuoteNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const quotesRef = collection(db, COLLECTIONS.QUOTES);
  const q = query(
    quotesRef,
    where("quoteNumber", ">=", `QUO-${year}-`),
    where("quoteNumber", "<", `QUO-${year + 1}-`),
    orderBy("quoteNumber", "desc"),
    limit(1)
  );

  const snapshot = await getDocs(q);
  if (snapshot.empty) {
    return `QUO-${year}-0001`;
  }

  const lastNumber = parseInt(snapshot.docs[0].data().quoteNumber.split("-")[2]);
  const nextNumber = (lastNumber + 1).toString().padStart(4, "0");
  return `QUO-${year}-${nextNumber}`;
}

// ============================================
// ROLE-BASED QUERY HELPERS
// ============================================

export function getJobsForUser(userId: string, role: string) {
  const constraints: QueryConstraint[] = [];

  if (role === "client") {
    constraints.push(where("clientId", "==", userId));
  } else if (role === "technician") {
    constraints.push(
      where("assignedTechnicians", "array-contains", { technicianId: userId })
    );
  }
  // Admin sees all jobs (no filter)

  constraints.push(orderBy("createdAt", "desc"));

  return queryDocuments(COLLECTIONS.JOBS, constraints);
}

export function getLeadsForUser(userId: string, role: string) {
  const constraints: QueryConstraint[] = [];

  if (role !== "admin") {
    constraints.push(where("assignedTo", "==", userId));
  }

  constraints.push(orderBy("updatedAt", "desc"));

  return queryDocuments(COLLECTIONS.LEADS, constraints);
}

// ============================================
// TIMESTAMP HELPERS
// ============================================

export function toTimestamp(date: Date): Timestamp {
  return Timestamp.fromDate(date);
}

export function fromTimestamp(timestamp: Timestamp): Date {
  return timestamp.toDate();
}

export function nowTimestamp(): Timestamp {
  return Timestamp.now();
}
