import { NextRequest } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { ADMIN_EMAILS } from "@/lib/auth";
import { COLLECTIONS } from "@/lib/collections";

export async function requireUserId(req: NextRequest): Promise<string> {
  const header = req.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) {
    throw new Error("Missing authorization token.");
  }
  const token = header.slice("Bearer ".length);
  const decoded = await admin.auth().verifyIdToken(token);
  return decoded.uid;
}

export async function requireAdminUser(req: NextRequest): Promise<{
  userId: string;
  email: string | null;
  user: { role?: string; name?: string; email?: string } | null;
}> {
  const header = req.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) {
    throw new Error("Missing authorization token.");
  }
  const token = header.slice("Bearer ".length);
  const decoded = await admin.auth().verifyIdToken(token);
  const userId = decoded.uid;
  const email = decoded.email ? decoded.email.toLowerCase() : null;

  let user: { role?: string; name?: string; email?: string } | null = null;
  try {
    const snap = await admin.firestore().collection(COLLECTIONS.USERS).doc(userId).get();
    user = (snap.data() as { role?: string; name?: string; email?: string } | undefined) || null;
  } catch (error) {
    user = null;
  }

  const role = user?.role;
  const isAdmin = role === "admin" || (!!email && ADMIN_EMAILS.includes(email));
  if (!isAdmin) {
    throw new Error("Not authorised.");
  }

  return { userId, email, user };
}
