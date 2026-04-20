import { NextRequest, NextResponse } from "next/server";
import { getAuthUrl } from "@/lib/xero";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = getAuthUrl();

  // Diagnostic mode: /api/xero/auth?debug=1 returns the constructed URL
  // as JSON instead of redirecting, so we can see exactly what's being
  // sent to Xero when the consent screen rejects it.
  if (req.nextUrl.searchParams.get("debug") === "1") {
    const parsed = new URL(url);
    return NextResponse.json({
      target: url,
      params: Object.fromEntries(parsed.searchParams.entries()),
    });
  }

  return NextResponse.redirect(url);
}
