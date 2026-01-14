import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { fetchCalendarEvents, refreshAccessToken, upsertCalendarToken } from "@/lib/server/googleCalendar";

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const tokenSnap = await admin.firestore().collection(COLLECTIONS.CALENDAR_TOKENS).doc(userId).get();
    if (!tokenSnap.exists) {
      return NextResponse.json({ error: "No calendar connection found." }, { status: 404 });
    }

    const tokenData = tokenSnap.data() as {
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: { toMillis?: () => number };
    };

    let accessToken = tokenData.accessToken;
    const refreshToken = tokenData.refreshToken;
    const expiresAt = tokenData.expiresAt?.toMillis?.() || 0;
    const now = Date.now();

    if (!accessToken || (expiresAt && now > expiresAt - 60000)) {
      if (!refreshToken) {
        return NextResponse.json({ error: "Missing refresh token." }, { status: 401 });
      }
      const refreshed = await refreshAccessToken(refreshToken);
      accessToken = refreshed.access_token;
      await upsertCalendarToken(userId, {
        accessToken,
        refreshToken,
        expiresIn: refreshed.expires_in,
        scope: refreshed.scope,
      });
    }

    if (!accessToken) {
      return NextResponse.json({ error: "Missing access token." }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const rangeDays = Number(searchParams.get("rangeDays") || "30");
    const start = new Date();
    const end = new Date();
    end.setDate(end.getDate() + (Number.isFinite(rangeDays) ? rangeDays : 30));

    const payload = await fetchCalendarEvents(
      accessToken,
      start.toISOString(),
      end.toISOString()
    );

    return NextResponse.json({ events: payload.items ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load events.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
