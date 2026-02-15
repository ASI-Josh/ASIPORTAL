import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Client portal inspection approvals are disabled. Please reply to the quote email to approve works and provide your booked-out dates/times.",
    },
    { status: 410 }
  );
}

