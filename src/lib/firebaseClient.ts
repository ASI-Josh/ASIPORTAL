import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import { getPublicEnv } from "@/lib/public-env";

const firebaseConfig = {
  apiKey: getPublicEnv("NEXT_PUBLIC_FIREBASE_API_KEY"),
  authDomain: getPublicEnv("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"),
  projectId: getPublicEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID"),
  storageBucket: getPublicEnv("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"),
  messagingSenderId: getPublicEnv("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"),
  appId: getPublicEnv("NEXT_PUBLIC_FIREBASE_APP_ID"),
  measurementId: getPublicEnv("NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID"),
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
