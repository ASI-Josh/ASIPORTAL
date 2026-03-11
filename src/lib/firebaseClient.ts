import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";

// Access NEXT_PUBLIC_* vars directly so Next.js/webpack can statically inline
// them at build time. Dynamic access via process.env[key] bypasses this.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID ?? "",
};

// initializeApp is safe with an empty apiKey; only getAuth/getFirestore/getStorage
// validate the key. Guard them so build-time prerendering (where NEXT_PUBLIC_*
// env vars are absent) does not throw auth/invalid-api-key.
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const auth: Auth = firebaseConfig.apiKey
  ? getAuth(app)
  : ({} as Auth);

export const db: Firestore = firebaseConfig.apiKey
  ? getFirestore(app)
  : ({} as Firestore);

export const storage: FirebaseStorage = firebaseConfig.apiKey
  ? getStorage(app)
  : ({} as FirebaseStorage);

export default app;
