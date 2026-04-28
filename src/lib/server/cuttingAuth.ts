import { NextRequest } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";
import { CUTTING_ACCESS_ROLES } from "@/lib/auth";
import type { User, UserRole } from "@/lib/types";

export interface CuttingAuthCtx {
  userId: string;
  email: string | null;
  role: UserRole;
  user: User;
}

export async function requireCuttingUser(req: NextRequest): Promise<CuttingAuthCtx> {
  const header = req.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) {
    throw new Error("Missing authorization token.");
  }
  const token = header.slice("Bearer ".length);
  const decoded = await admin.auth().verifyIdToken(token);
  const userId = decoded.uid;
  const email = decoded.email?.toLowerCase() ?? null;

  const snap = await admin.firestore().collection(COLLECTIONS.USERS).doc(userId).get();
  const user = snap.data() as User | undefined;
  if (!user) throw new Error("User profile missing.");
  if (!CUTTING_ACCESS_ROLES.includes(user.role)) {
    throw new Error("Not authorised for cutting workflow.");
  }
  return { userId, email, role: user.role, user };
}

export function cuttingErrorStatus(message: string): number {
  if (message.includes("authorization")) return 401;
  if (message.includes("Not authorised") || message.includes("missing")) return 403;
  return 500;
}
