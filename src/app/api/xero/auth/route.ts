import { NextResponse } from "next/server";
import { getAuthUrl } from "@/lib/xero";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.redirect(getAuthUrl());
}
