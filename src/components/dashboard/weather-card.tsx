"use client";

import { useEffect, useState } from "react";
import { CloudSun } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type WeatherSnapshot = {
  temperature: number;
  windSpeed: number;
  code: number;
  time: string;
};

type WeatherState = {
  loading: boolean;
  error?: string;
  locationLabel: string;
  data?: WeatherSnapshot;
};

const DEFAULT_LOCATION = {
  label: "Melbourne",
  latitude: -37.8136,
  longitude: 144.9631,
};

const WEATHER_CODES: Record<number, string> = {
  0: "Clear",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snow",
  73: "Moderate snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

async function fetchWeather(latitude: number, longitude: number): Promise<WeatherSnapshot> {
  const params = new URLSearchParams({
    latitude: latitude.toString(),
    longitude: longitude.toString(),
    current: "temperature_2m,wind_speed_10m,weather_code",
    timezone: "auto",
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
  if (!response.ok) {
    throw new Error("Weather unavailable");
  }
  const payload = (await response.json()) as {
    current?: {
      temperature_2m?: number;
      wind_speed_10m?: number;
      weather_code?: number;
      time?: string;
    };
  };
  return {
    temperature: payload.current?.temperature_2m ?? 0,
    windSpeed: payload.current?.wind_speed_10m ?? 0,
    code: payload.current?.weather_code ?? 0,
    time: payload.current?.time ?? "",
  };
}

export function WeatherCard() {
  const [state, setState] = useState<WeatherState>({
    loading: true,
    locationLabel: DEFAULT_LOCATION.label,
  });

  useEffect(() => {
    let cancelled = false;
    const resolveWeather = async () => {
      const handleResult = async (
        latitude: number,
        longitude: number,
        locationLabel: string
      ) => {
        try {
          const data = await fetchWeather(latitude, longitude);
          if (!cancelled) {
            setState({ loading: false, locationLabel, data });
          }
        } catch {
          if (!cancelled) {
            setState({
              loading: false,
              locationLabel,
              error: "Weather data unavailable.",
            });
          }
        }
      };

      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            void handleResult(
              position.coords.latitude,
              position.coords.longitude,
              "Current location"
            );
          },
          () => {
            void handleResult(
              DEFAULT_LOCATION.latitude,
              DEFAULT_LOCATION.longitude,
              DEFAULT_LOCATION.label
            );
          },
          { enableHighAccuracy: true, timeout: 5000 }
        );
        return;
      }

      void handleResult(
        DEFAULT_LOCATION.latitude,
        DEFAULT_LOCATION.longitude,
        DEFAULT_LOCATION.label
      );
    };

    void resolveWeather();
    return () => {
      cancelled = true;
    };
  }, []);

  const condition = state.data ? WEATHER_CODES[state.data.code] || "Conditions" : "";

  return (
    <Card className="bg-card/50 backdrop-blur-lg border-border/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CloudSun className="h-4 w-4 text-sky-400" />
          Local Weather
        </CardTitle>
        <CardDescription>{state.locationLabel}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {state.loading ? (
          <p className="text-muted-foreground">Loading weather...</p>
        ) : state.error ? (
          <p className="text-xs text-destructive">{state.error}</p>
        ) : state.data ? (
          <>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-semibold">
                {Math.round(state.data.temperature)}°C
              </span>
              <Badge variant="outline">{condition}</Badge>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Wind</span>
              <span>{Math.round(state.data.windSpeed)} km/h</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Updated {state.data.time ? new Date(state.data.time).toLocaleTimeString("en-AU") : ""}
            </p>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
