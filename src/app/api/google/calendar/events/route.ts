import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { fetchCalendarEvents, getAccessTokenForUser } from "@/lib/server/googleCalendar";

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const accessToken = await getAccessTokenForUser(userId);

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
