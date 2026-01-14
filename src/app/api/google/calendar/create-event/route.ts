import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/server/firebaseAuth";
import {
  createCalendarEvent,
  getAccessTokenForUser,
} from "@/lib/server/googleCalendar";

type CreateEventBody = {
  summary: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  attendees?: string[];
  createMeet?: boolean;
};

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const body = (await req.json()) as CreateEventBody;

    if (!body.summary || !body.start || !body.end) {
      return NextResponse.json({ error: "Missing event details." }, { status: 400 });
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

    const created = await createCalendarEvent(accessToken, eventPayload);
    return NextResponse.json({
      eventId: created.id,
      htmlLink: created.htmlLink,
      hangoutLink: created.hangoutLink,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create event.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
