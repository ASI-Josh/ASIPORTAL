// All values are read exclusively from environment variables.
// Set these in Netlify environment settings (or .env.local for local dev).
// Required NEXT_PUBLIC_ vars:
//   NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_APP_ID,
//   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
//   NEXT_PUBLIC_FIREBASE_PROJECT_ID, NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
//   NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

export function getPublicEnv(key: string): string {
  return process.env[key] ?? "";
}
