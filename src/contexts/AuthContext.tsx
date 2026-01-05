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
import { doc, setDoc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebaseClient";
import { User, UserRole } from "@/lib/types";
import { determineUserRole } from "@/lib/auth";
import { COLLECTIONS } from "@/lib/firestore";
import { Timestamp } from "firebase/firestore";

interface AuthContextType {
  user: User | null;
  firebaseUser: FirebaseUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

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
              role: "customer" as UserRole,
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
            role: "customer" as UserRole,
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

  const signUp = async (email: string, password: string, name: string) => {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const firebaseUser = userCredential.user;

    await updateProfile(firebaseUser, { displayName: name });

    const role = determineUserRole(email);

    const newUser: User = {
      uid: firebaseUser.uid,
      email: firebaseUser.email!,
      role,
      name,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };

    await setDoc(doc(db, COLLECTIONS.USERS, firebaseUser.uid), newUser);

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
