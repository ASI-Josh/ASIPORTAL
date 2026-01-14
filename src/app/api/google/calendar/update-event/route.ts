import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/server/firebaseAuth";
import {
  getAccessTokenForUser,
  updateCalendarEvent,
} from "@/lib/server/googleCalendar";

type UpdateEventBody = {
  eventId: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: string;
  end?: string;
  attendees?: string[];
  createMeet?: boolean;
};

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const body = (await req.json()) as UpdateEventBody;

    if (!body.eventId) {
      return NextResponse.json({ error: "Missing event ID." }, { status: 400 });
    }

    if (!body.start || !body.end) {
      return NextResponse.json({ error: "Missing event dates." }, { status: 400 });
    }

    const accessToken = await getAccessTokenForUser(userId);

    const eventPayload: Record<string, unknown> = {
      summary: body.summary,
      description: body.description,
      location: body.location,
      start: { dateTime: body.start, timeZone: "Australia/Sydney" },
      end: { dateTime: body.end, timeZone: "Australia/Sydney" },
      attendees: body.attendees?.map((email) => ({ email })),
    };

    if (body.createMeet) {
      eventPayload.conferenceData = {
        createRequest: {
          requestId: `meet-${Date.now()}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      };
    }

    const updated = await updateCalendarEvent(accessToken, body.eventId, eventPayload);
    return NextResponse.json({
      eventId: updated.id,
      htmlLink: updated.htmlLink,
      hangoutLink: updated.hangoutLink,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update event.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
