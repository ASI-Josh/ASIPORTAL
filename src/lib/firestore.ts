import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
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
import type { ContactOrganization } from "./types";
import { COLLECTIONS } from "./collections";

export { COLLECTIONS };

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

export async function addDocument<T extends DocumentData>(
  collectionName: string,
  data: T
) {
  const collectionRef = collection(db, collectionName);
  const docRef = await addDoc(collectionRef, {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return docRef.id;
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

export async function getOrganizationByDomain(
  domain: string
): Promise<(ContactOrganization & { id: string }) | null> {
  const organizationsRef = collection(db, COLLECTIONS.CONTACT_ORGANIZATIONS);
  const q = query(
    organizationsRef,
    where("domains", "array-contains", domain),
    limit(1)
  );
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;
  const orgDoc = snapshot.docs[0];
  return { id: orgDoc.id, ...(orgDoc.data() as Omit<ContactOrganization, "id">) };
}

// ============================================
// AUTO-INCREMENT HELPERS
// ============================================

function normaliseJobCode(value: string) {
  const cleaned = value.replace(/[^a-zA-Z0-9]/g, "");
  if (!cleaned) return "JOB";
  const upper = cleaned.toUpperCase();
  return upper.length >= 3 ? upper.slice(0, 3) : upper.padEnd(3, "X");
}

function getOrganizationJobCode(organization: ContactOrganization) {
  if (organization.jobCode?.trim()) {
    return normaliseJobCode(organization.jobCode.trim());
  }

  const domain = organization.domains?.find(Boolean);
  if (domain) {
    const base = domain.replace(/^www\./i, "").split(".")[0] || "";
    const domainCode = normaliseJobCode(base);
    if (domainCode !== "JOB") return domainCode;
  }

  const stopWords = new Set([
    "pty",
    "ltd",
    "limited",
    "the",
    "and",
    "group",
    "company",
    "co",
    "inc",
    "australia",
    "aust",
  ]);
  const cleanedName = organization.name.replace(/[^a-zA-Z0-9 ]/g, " ");
  const words = cleanedName
    .split(/\s+/)
    .filter((word) => word && !stopWords.has(word.toLowerCase()));
  const base = words[0] || cleanedName || "JOB";
  return normaliseJobCode(base);
}

export async function generateJobNumber(
  organization: ContactOrganization
): Promise<string> {
  const year = new Date().getFullYear();
  const yearSuffix = String(year).slice(-2);
  const jobCode = getOrganizationJobCode(organization);
  const prefix = `${jobCode}-${yearSuffix}-`;

  const jobsRef = collection(db, COLLECTIONS.JOBS);
  const startOfYear = Timestamp.fromDate(new Date(year, 0, 1));
  const startOfNextYear = Timestamp.fromDate(new Date(year + 1, 0, 1));
  const q = query(
    jobsRef,
    where("organizationId", "==", organization.id),
    where("createdAt", ">=", startOfYear),
    where("createdAt", "<", startOfNextYear),
    orderBy("createdAt", "desc"),
    limit(1)
  );

  const snapshot = await getDocs(q);
  if (snapshot.empty) {
    return `${prefix}0001`;
  }

  const lastJobNumber = snapshot.docs[0].data().jobNumber as string | undefined;
  if (!lastJobNumber || !lastJobNumber.startsWith(prefix)) {
    return `${prefix}0001`;
  }

  const lastNumber = parseInt(lastJobNumber.split("-")[2] || "", 10);
  const nextNumber = Number.isFinite(lastNumber)
    ? (lastNumber + 1).toString().padStart(4, "0")
    : "0001";

  return `${prefix}${nextNumber}`;
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

export async function generateBookingNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const bookingsRef = collection(db, COLLECTIONS.BOOKINGS);
  const q = query(
    bookingsRef,
    where("bookingNumber", ">=", `BK-${year}-`),
    where("bookingNumber", "<", `BK-${year + 1}-`),
    orderBy("bookingNumber", "desc"),
    limit(1)
  );

  const snapshot = await getDocs(q);
  if (snapshot.empty) {
    return `BK-${year}-0001`;
  }

  const lastNumber = parseInt(snapshot.docs[0].data().bookingNumber.split("-")[2]);
  const nextNumber = (lastNumber + 1).toString().padStart(4, "0");
  return `BK-${year}-${nextNumber}`;
}

export async function generateIncidentNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const incidentsRef = collection(db, COLLECTIONS.IMS_INCIDENTS);
  const q = query(
    incidentsRef,
    where("incidentNumber", ">=", `INC-${year}-`),
    where("incidentNumber", "<", `INC-${year + 1}-`),
    orderBy("incidentNumber", "desc"),
    limit(1)
  );

  const snapshot = await getDocs(q);
  if (snapshot.empty) {
    return `INC-${year}-0001`;
  }

  const lastNumber = parseInt(
    snapshot.docs[0].data().incidentNumber.split("-")[2]
  );
  const nextNumber = (lastNumber + 1).toString().padStart(4, "0");
  return `INC-${year}-${nextNumber}`;
}

// ============================================
// ROLE-BASED QUERY HELPERS
// ============================================

export function getJobsForUser(userId: string, role: string, organizationId?: string) {
  const constraints: QueryConstraint[] = [];

  if (role === "client" || role === "contractor") {
    if (organizationId) {
      constraints.push(where("organizationId", "==", organizationId));
    }
  } else if (role === "technician") {
    constraints.push(where("assignedTechnicianIds", "array-contains", userId));
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
