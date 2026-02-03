"use server";

import { NextRequest, NextResponse } from "next/server";
import { getMoltbookAgentFromRequest } from "@/lib/moltbook-auth";

export async function POST(req: NextRequest) {
  try {
    const { agent, error, status } = await getMoltbookAgentFromRequest(req);
    if (!agent) {
      return NextResponse.json({ error }, { status });
    }
    return NextResponse.json({ valid: true, agent });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to verify Moltbook identity.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
