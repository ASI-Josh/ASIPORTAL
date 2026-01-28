// Auto-generated from .env.local. Contains only public config keys.
export const PUBLIC_ENV = {
  NEXT_PUBLIC_APP_URL: "http://localhost:9002",
  NEXT_PUBLIC_FIREBASE_API_KEY: "AIzaSyBtfcKEMwORZUIB5S0uqSiaBVu4X-fh0I8",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:548483185357:web:a6e80e7cc8dc28e0984784",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "studio-2665508380-b2b5f.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "548483185357",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "studio-2665508380-b2b5f",
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "studio-2665508380-b2b5f.firebasestorage.app",
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: "AIzaSyCcSkBy-8hzIzHE6nLsPzHNQ_ZkLoe9c6Y",
} as const;

export type PublicEnvKey = keyof typeof PUBLIC_ENV;

export function getPublicEnv(key: string) {
  return process.env[key] ?? (PUBLIC_ENV as Record<string, string | undefined>)[key];
}
