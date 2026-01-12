"use client";

import { createContext, useContext, useEffect, useState } from "react";
import {
  User as FirebaseUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
} from "firebase/auth";
import { collection, doc, getDoc, query, where, limit, getDocs } from "firebase/firestore";
import { auth, db } from "@/lib/firebaseClient";
import { User, UserRole } from "@/lib/types";
import { determineUserRole } from "@/lib/auth";
import { COLLECTIONS, addDocument, createDocument, getOrganizationByDomain } from "@/lib/firestore";
import { Timestamp } from "firebase/firestore";

interface AuthContextType {
  user: User | null;
  firebaseUser: FirebaseUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (data: SignUpData) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

type PortalRole = "client" | "contractor";

type SignUpData = {
  email: string;
  password: string;
  name: string;
  phone?: string;
  role: PortalRole;
  organization: {
    name: string;
    abn?: string;
    phone?: string;
    street?: string;
    suburb?: string;
    state?: string;
    postcode?: string;
  };
};

const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "icloud.com",
  "bigpond.com",
]);

const ASI_DOMAIN = "asi-australia.com.au";

function getEmailDomain(email: string) {
  const parts = email.toLowerCase().trim().split("@");
  return parts.length === 2 ? parts[1] : "";
}

function splitName(fullName: string) {
  const trimmed = fullName.trim();
  if (!trimmed) return { firstName: "User", lastName: "" };
  const [firstName, ...rest] = trimmed.split(" ");
  return { firstName, lastName: rest.join(" ") };
}

type OrgMatch = {
  id: string;
  name: string;
  portalRole?: UserRole;
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const userDoc = await getDoc(doc(db, COLLECTIONS.USERS, firebaseUser.uid));
          
          if (userDoc.exists()) {
            setUser(userDoc.data() as User);
          } else {
            const basicUser: User = {
              uid: firebaseUser.uid,
              email: firebaseUser.email!,
              name: firebaseUser.displayName || "User",
              role: "client",
              createdAt: Timestamp.now(),
              updatedAt: Timestamp.now(),
            };
            setUser(basicUser);
          }
        } catch (error) {
          console.warn("Failed to fetch user doc, using basic user info:", error);
          const basicUser: User = {
            uid: firebaseUser.uid,
            email: firebaseUser.email!,
            name: firebaseUser.displayName || "User",
            role: "client",
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
          };
          setUser(basicUser);
        }
        setFirebaseUser(firebaseUser);
      } else {
        setUser(null);
        setFirebaseUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const signUp = async (data: SignUpData) => {
    const { email, password, name, phone, role, organization } = data;
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const firebaseUser = userCredential.user;

    await updateProfile(firebaseUser, { displayName: name });

    const emailDomain = getEmailDomain(email);
    const isPublicDomain = PUBLIC_EMAIL_DOMAINS.has(emailDomain);
    const resolvedRole = determineUserRole(email, role);

    let organizationId: string | undefined;
    let organizationName: string | undefined;
    let contactId: string | undefined;
    let finalRole: UserRole = resolvedRole;

    const ensureAsiOrganization = async (): Promise<OrgMatch> => {
      const existingAsi = await getOrganizationByDomain(ASI_DOMAIN);
      if (existingAsi?.id) {
        return existingAsi;
      }

      const createdId = await addDocument(COLLECTIONS.CONTACT_ORGANIZATIONS, {
        name: "ASI Australia",
        category: "asi_staff",
        type: "partner",
        status: "active",
        domains: [ASI_DOMAIN],
        portalRole: "technician",
        phone: "",
        email: `admin@${ASI_DOMAIN}`,
        sites: [],
      });
      return { id: createdId, name: "ASI Australia" };
    };

    if (resolvedRole === "admin" || resolvedRole === "technician") {
      const asiOrg = await ensureAsiOrganization();
      organizationId = asiOrg.id;
      organizationName = asiOrg.name;
    } else if (emailDomain && !isPublicDomain) {
      const existingOrg = await getOrganizationByDomain(emailDomain);
      if (existingOrg) {
        organizationId = existingOrg.id as string;
        organizationName = existingOrg.name as string;
        if (existingOrg.portalRole) {
          finalRole = existingOrg.portalRole as UserRole;
        }
      }
    }

    if (!organizationId) {
      const createdOrgId = await addDocument(COLLECTIONS.CONTACT_ORGANIZATIONS, {
        name: organization.name,
        category: role === "contractor" ? "supplier_vendor" : "trade_client",
        type: role === "contractor" ? "supplier" : "customer",
        status: "active",
        abn: organization.abn || "",
        phone: organization.phone || "",
        email,
        domains: emailDomain && !isPublicDomain ? [emailDomain] : [],
        portalRole: role,
        address: organization.street
          ? {
              street: organization.street,
              suburb: organization.suburb || "",
              state: organization.state || "NSW",
              postcode: organization.postcode || "",
              country: "Australia",
            }
          : undefined,
        sites: organization.street
          ? [
              {
                id: `site-${Date.now()}`,
                name: "Main Location",
                address: {
                  street: organization.street,
                  suburb: organization.suburb || "",
                  state: organization.state || "NSW",
                  postcode: organization.postcode || "",
                  country: "Australia",
                },
                isDefault: true,
              },
            ]
          : [],
      });
      organizationId = createdOrgId;
      organizationName = organization.name;
    }

    const { firstName, lastName } = splitName(name);
    const existingContactsSnapshot = await getDocs(
      query(
        collection(db, COLLECTIONS.ORGANIZATION_CONTACTS),
        where("organizationId", "==", organizationId),
        limit(1)
      )
    );
    const isPrimary = existingContactsSnapshot.empty;

    contactId = await addDocument(COLLECTIONS.ORGANIZATION_CONTACTS, {
      organizationId,
      firstName,
      lastName,
      email,
      phone: phone || organization.phone || "",
      mobile: phone || organization.phone || "",
      role: "primary",
      jobTitle: "",
      status: "active",
      isPrimary,
      hasPortalAccess: true,
      portalUserId: firebaseUser.uid,
    });

    const newUser: User = {
      uid: firebaseUser.uid,
      email: firebaseUser.email!,
      role: finalRole,
      name,
      phone,
      organizationId,
      organizationName,
      contactId,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };

    await createDocument(COLLECTIONS.USERS, firebaseUser.uid, newUser);

    setUser(newUser);
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    setUser(null);
    setFirebaseUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, firebaseUser, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
