import { NextRequest, NextResponse } from "next/server";
import { exchangeGmailCode, upsertGmailToken, gmailGetProfile, getGmailRedirectUri } from "@/lib/server/gmail";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.json({ error: `OAuth denied: ${error}` }, { status: 400 });
  }

  if (!code) {
    return NextResponse.json({ error: "Missing authorization code" }, { status: 400 });
  }

  try {
    const tokens = await exchangeGmailCode(code);

    // Get the user's email address
    let email = "";
    try {
      const profile = await gmailGetProfile(tokens.access_token);
      email = (profile as { emailAddress?: string }).emailAddress || "";
    } catch { /* non-fatal */ }

    await upsertGmailToken("default", {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      scope: tokens.scope,
      email,
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://asiportal.live";
    return NextResponse.redirect(`${baseUrl}/dashboard?gmail=connected`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token exchange failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
