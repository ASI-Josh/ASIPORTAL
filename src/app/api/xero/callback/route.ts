import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/lib/xero";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "Missing authorization code." }, { status: 400 });
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    // Redirect to dashboard with success message
    const base = process.env.NEXT_PUBLIC_APP_URL || "https://asiportal.live";
    return NextResponse.redirect(
      `${base}/dashboard?xero=connected&org=${encodeURIComponent(tokens.tenantName || "")}`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Xero auth failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
