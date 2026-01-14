import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl, createAuthState } from "@/lib/server/googleCalendar";
import { requireUserId } from "@/lib/server/firebaseAuth";

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const state = await createAuthState(userId);
    const url = buildAuthUrl(state);
    return NextResponse.json({ url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start auth.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
