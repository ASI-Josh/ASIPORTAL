import { NextRequest } from "next/server";
import { admin } from "@/lib/firebaseAdmin";

export async function requireUserId(req: NextRequest): Promise<string> {
  const header = req.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) {
    throw new Error("Missing authorization token.");
  }
  const token = header.slice("Bearer ".length);
  const decoded = await admin.auth().verifyIdToken(token);
  return decoded.uid;
}
