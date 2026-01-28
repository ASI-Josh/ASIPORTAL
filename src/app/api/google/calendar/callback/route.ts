import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { exchangeCodeForTokens, upsertCalendarToken, getRedirectUri } from "@/lib/server/googleCalendar";

function getAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || "https://asiportal.live";
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (!code || !state) {
    return NextResponse.redirect(`${getAppUrl()}/dashboard/calendar?error=missing_code`);
  }

  try {
    const stateRef = admin.firestore().collection("calendarAuthStates").doc(state);
    const stateSnap = await stateRef.get();
    if (!stateSnap.exists) {
      return NextResponse.redirect(`${getAppUrl()}/dashboard/calendar?error=invalid_state`);
    }

    const stateData = stateSnap.data() as { userId?: string };
    await stateRef.delete();

    if (!stateData?.userId) {
      return NextResponse.redirect(`${getAppUrl()}/dashboard/calendar?error=invalid_state`);
    }

    const tokenData = await exchangeCodeForTokens(code);
    await upsertCalendarToken(stateData.userId, {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      scope: tokenData.scope,
    });

    const redirectUri = getRedirectUri();
    const baseUrl = redirectUri.replace("/api/google/calendar/callback", "");
    return NextResponse.redirect(`${baseUrl}/dashboard/calendar?connected=1`);
  } catch (error) {
    return NextResponse.redirect(`${getAppUrl()}/dashboard/calendar?error=oauth_failed`);
  }
}
