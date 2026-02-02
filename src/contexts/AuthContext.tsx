"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  User as FirebaseUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
} from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  query,
  where,
  limit,
  getDocs,
  updateDoc,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebaseClient";
import { User, UserRole } from "@/lib/types";
import { determineUserRole } from "@/lib/auth";
import { COLLECTIONS, addDocument, getOrganizationByDomain } from "@/lib/firestore";
import { Timestamp } from "firebase/firestore";

interface AuthContextType {
  user: User | null;
  firebaseUser: FirebaseUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  updateUserProfile: (updates: { name?: string; phone?: string }) => Promise<void>;
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
const REQUEST_ACCESS_MESSAGE =
  "Access is by invitation only. Email support@asi-australia.com.au to request access.";

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

function isStaffRole(role: UserRole) {
  return role === "admin" || role === "technician";
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
  const inviteCheckRef = useRef(false);

  useEffect(() => {
    getRedirectResult(auth).catch((error) => {
      console.warn("Google sign-in redirect failed:", error);
    });
  }, []);

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

  const ensureStaffContact = async (params: {
    userId: string;
    email: string;
    name: string;
    phone?: string;
    role: UserRole;
    contactId?: string;
    organizationId?: string;
  }) => {
    const {
      userId,
      email,
      name,
      phone,
      role,
      contactId,
      organizationId,
    } = params;
    const asiOrg = organizationId
      ? { id: organizationId, name: "ASI Australia" }
      : await ensureAsiOrganization();

    const resolvedName = name || email.split("@")[0] || "User";
    const { firstName, lastName } = splitName(resolvedName);
    const contactRole = role === "admin" ? "management" : "technical";

    const phoneUpdates = phone ? { phone, mobile: phone } : {};

    if (contactId) {
      await updateDoc(doc(db, COLLECTIONS.ORGANIZATION_CONTACTS, contactId), {
        firstName,
        lastName,
        email,
        role: contactRole,
        updatedAt: Timestamp.now(),
        ...phoneUpdates,
      });
      return contactId;
    }

    const existingByUser = await getDocs(
      query(
        collection(db, COLLECTIONS.ORGANIZATION_CONTACTS),
        where("portalUserId", "==", userId),
        limit(1)
      )
    );
    if (!existingByUser.empty) {
      const existingId = existingByUser.docs[0].id;
      await updateDoc(doc(db, COLLECTIONS.ORGANIZATION_CONTACTS, existingId), {
        firstName,
        lastName,
        email,
        role: contactRole,
        updatedAt: Timestamp.now(),
        ...phoneUpdates,
      });
      return existingId;
    }

    const newContactId = await addDocument(COLLECTIONS.ORGANIZATION_CONTACTS, {
      organizationId: asiOrg.id,
      firstName,
      lastName,
      email,
      phone: phone || "",
      mobile: phone || "",
      role: contactRole,
      status: "active",
      isPrimary: false,
      hasPortalAccess: true,
      portalUserId: userId,
    });
    return newContactId;
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const userDoc = await getDoc(doc(db, COLLECTIONS.USERS, firebaseUser.uid));
          const email = firebaseUser.email || "";

          if (userDoc.exists()) {
            const storedUser = userDoc.data() as User;
            const resolvedRole = determineUserRole(email || storedUser.email, storedUser.role);
            const updates: Partial<User> = {};

            if (resolvedRole !== storedUser.role) {
              updates.role = resolvedRole;
            }

            if (isStaffRole(resolvedRole)) {
              const asiOrg = await ensureAsiOrganization();
              if (storedUser.organizationId !== asiOrg.id) {
                updates.organizationId = asiOrg.id;
              }
              if (storedUser.organizationName !== asiOrg.name) {
                updates.organizationName = asiOrg.name;
              }
              const contactId = await ensureStaffContact({
                userId: firebaseUser.uid,
                email: email || storedUser.email,
                name: storedUser.name || firebaseUser.displayName || "User",
                phone: storedUser.phone,
                role: resolvedRole,
                contactId: storedUser.contactId,
                organizationId: asiOrg.id,
              });
              if (contactId && contactId !== storedUser.contactId) {
                updates.contactId = contactId;
              }
            } else if (!storedUser.organizationId) {
              const emailDomain = getEmailDomain(email || storedUser.email);
              const isPublicDomain = PUBLIC_EMAIL_DOMAINS.has(emailDomain);
              if (emailDomain && !isPublicDomain) {
                const existingOrg = await getOrganizationByDomain(emailDomain);
                if (existingOrg) {
                  updates.organizationId = existingOrg.id;
                  updates.organizationName = existingOrg.name;
                  if (existingOrg.portalRole && existingOrg.portalRole !== resolvedRole) {
                    updates.role = existingOrg.portalRole;
                  }
                }
              }
            }

            const nextUser = Object.keys(updates).length > 0
              ? { ...storedUser, ...updates }
              : storedUser;
            setUser(nextUser);

            if (!inviteCheckRef.current) {
              inviteCheckRef.current = true;
              try {
                const token = await firebaseUser.getIdToken();
                await fetch("/api/auth/accept-invite?mode=cleanup", {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${token}`,
                  },
                });
              } catch (inviteError) {
                console.warn("Invite reconciliation failed:", inviteError);
              }
            }

            if (Object.keys(updates).length > 0) {
              try {
                await updateDoc(doc(db, COLLECTIONS.USERS, firebaseUser.uid), {
                  ...updates,
                  updatedAt: Timestamp.now(),
                });
              } catch (updateError) {
                console.warn("Failed to update user role/organisation in Firestore:", updateError);
              }
            }
          } else {
            try {
              const token = await firebaseUser.getIdToken();
              const response = await fetch("/api/auth/accept-invite", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token}`,
                },
              });
              if (response.ok) {
                const data = (await response.json()) as { user: User };
                setUser(data.user);
                setFirebaseUser(firebaseUser);
                setLoading(false);
                return;
              }
            } catch (inviteError) {
              console.warn("Invite acceptance failed:", inviteError);
            }

            if (typeof window !== "undefined") {
              sessionStorage.setItem("authError", REQUEST_ACCESS_MESSAGE);
            }
            try {
              await firebaseUser.delete();
            } catch (deleteError) {
              console.warn("Failed to delete unapproved account:", deleteError);
            }
            await firebaseSignOut(auth);
            setUser(null);
            setFirebaseUser(null);
            setLoading(false);
            return;
          }
        } catch (error) {
          console.warn("Failed to fetch user doc, using basic user info:", error);
          const basicUser: User = {
            uid: firebaseUser.uid,
            email: firebaseUser.email!,
            name: firebaseUser.displayName || "User",
            role: determineUserRole(firebaseUser.email || "", "client"),
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

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      const code = error?.code as string | undefined;
      if (
        code === "auth/popup-blocked" ||
        code === "auth/popup-closed-by-user" ||
        code === "auth/operation-not-supported-in-this-environment"
      ) {
        await signInWithRedirect(auth, provider);
        return;
      }
      throw error;
    }
  };

  const updateUserProfile = async (updates: { name?: string; phone?: string }) => {
    if (!firebaseUser) {
      throw new Error("Not signed in.");
    }
    const nextUpdates: Partial<User> = {};
    if (updates.name) {
      nextUpdates.name = updates.name;
    }
    if (updates.phone) {
      nextUpdates.phone = updates.phone;
    }
    if (Object.keys(nextUpdates).length === 0) return;

    await updateDoc(doc(db, COLLECTIONS.USERS, firebaseUser.uid), {
      ...nextUpdates,
      updatedAt: Timestamp.now(),
    });

    if (updates.name && firebaseUser.displayName !== updates.name) {
      await updateProfile(firebaseUser, { displayName: updates.name });
    }

    setUser((current) => (current ? { ...current, ...nextUpdates } : current));

    if (user && isStaffRole(user.role)) {
      const resolvedRole = user.role;
      const contactId = await ensureStaffContact({
        userId: firebaseUser.uid,
        email: firebaseUser.email || user?.email || "",
        name: updates.name || user?.name || "User",
        phone: updates.phone || user?.phone,
        role: resolvedRole,
        contactId: user?.contactId,
        organizationId: user?.organizationId,
      });
      if (contactId && contactId !== user?.contactId) {
        await updateDoc(doc(db, COLLECTIONS.USERS, firebaseUser.uid), {
          contactId,
          updatedAt: Timestamp.now(),
        });
        setUser((current) => (current ? { ...current, contactId } : current));
      }
    }
  };

  const signUp = async (data: SignUpData) => {
    throw new Error(REQUEST_ACCESS_MESSAGE);
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    setUser(null);
    setFirebaseUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        firebaseUser,
        loading,
        signIn,
        signInWithGoogle,
        updateUserProfile,
        signUp,
        signOut,
      }}
    >
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
