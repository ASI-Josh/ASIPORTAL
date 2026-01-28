"use server";

import { NextResponse } from "next/server";

type WeatherApiResponse = {
  temperature?: { degrees?: number };
  wind?: { speed?: { value?: number } };
  weatherCondition?: { description?: { text?: string } };
  currentTime?: string;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");

  if (!lat || !lng) {
    return NextResponse.json({ error: "Missing coordinates." }, { status: 400 });
  }

  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing server key." }, { status: 500 });
  }

  const params = new URLSearchParams({
    "location.latitude": lat,
    "location.longitude": lng,
    "units_system": "METRIC",
    "language": "en",
    "key": apiKey,
  });

  const response = await fetch(
    `https://weather.googleapis.com/v1/currentConditions:lookup?${params.toString()}`,
    { cache: "no-store" }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return NextResponse.json({ error: text || "Weather unavailable." }, { status: 502 });
  }

  const payload = (await response.json()) as WeatherApiResponse;
  const data = {
    temperature: payload.temperature?.degrees ?? 0,
    windSpeed: payload.wind?.speed?.value ?? 0,
    condition: payload.weatherCondition?.description?.text ?? "Conditions",
    time: payload.currentTime ?? "",
  };

  return NextResponse.json(data);
}
