import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { buildGmailAuthUrl } from "@/lib/server/gmail";

export async function GET() {
  const state = randomBytes(16).toString("hex");
  const url = buildGmailAuthUrl(state);
  return NextResponse.json({ url, state });
}
