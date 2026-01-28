"use server";

import { NextResponse } from "next/server";

type WeatherApiResponse = {
  temperature?: { degrees?: number };
  wind?: {
    speed?: { value?: number };
    direction?: { degrees?: number };
    gust?: { value?: number };
  };
  weatherCondition?: { description?: { text?: string } };
  currentTime?: string;
  relativeHumidity?: number;
  uvIndex?: number;
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
    unitsSystem: "METRIC",
    languageCode: "en",
    key: apiKey,
  });

  const response = await fetch(
    `https://weather.googleapis.com/v1/currentConditions:lookup?${params.toString()}`,
    { cache: "no-store" }
  );

  if (response.ok) {
    const payload = (await response.json()) as WeatherApiResponse;
    const data = {
      temperature: payload.temperature?.degrees ?? 0,
      windSpeed: payload.wind?.speed?.value ?? 0,
      windDirection: payload.wind?.direction?.degrees ?? null,
      windGust: payload.wind?.gust?.value ?? null,
      condition: payload.weatherCondition?.description?.text ?? "Conditions",
      time: payload.currentTime ?? "",
      humidity: payload.relativeHumidity ?? null,
      uvIndex: payload.uvIndex ?? null,
    };
    return NextResponse.json(data);
  }

  const fallbackParams = new URLSearchParams({
    latitude: lat,
    longitude: lng,
    current: "temperature_2m,relative_humidity_2m,uv_index,wind_speed_10m,wind_direction_10m",
    timezone: "auto",
  });
  const fallbackResponse = await fetch(
    `https://api.open-meteo.com/v1/forecast?${fallbackParams.toString()}`,
    { cache: "no-store" }
  );
  if (!fallbackResponse.ok) {
    const text = await response.text().catch(() => "");
    return NextResponse.json(
      { error: text || "Weather unavailable." },
      { status: 502 }
    );
  }
  const fallbackPayload = (await fallbackResponse.json()) as {
    current?: {
      temperature_2m?: number;
      relative_humidity_2m?: number;
      uv_index?: number;
      wind_speed_10m?: number;
      wind_direction_10m?: number;
      time?: string;
    };
  };
  const data = {
    temperature: fallbackPayload.current?.temperature_2m ?? 0,
    windSpeed: fallbackPayload.current?.wind_speed_10m ?? 0,
    windDirection: fallbackPayload.current?.wind_direction_10m ?? null,
    windGust: null,
    condition: "Conditions",
    time: fallbackPayload.current?.time ?? "",
    humidity: fallbackPayload.current?.relative_humidity_2m ?? null,
    uvIndex: fallbackPayload.current?.uv_index ?? null,
  };
  return NextResponse.json(data);
}
