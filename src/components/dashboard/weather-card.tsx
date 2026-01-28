"use client";

import { useEffect, useState } from "react";
import { CloudSun } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type WeatherSnapshot = {
  temperature: number;
  windSpeed: number;
  windDirection?: number | null;
  windGust?: number | null;
  humidity?: number | null;
  uvIndex?: number | null;
  condition: string;
  time: string;
};

type WeatherState = {
  loading: boolean;
  error?: string;
  locationLabel: string;
  data?: WeatherSnapshot;
};

type WeatherCardProps = {
  variant?: "card" | "embedded";
  layout?: "standard" | "compact";
  className?: string;
};

const DEFAULT_LOCATION = {
  label: "Melbourne",
  latitude: -37.8136,
  longitude: 144.9631,
};

const directionToCompass = (deg?: number | null) => {
  if (deg === undefined || deg === null || Number.isNaN(deg)) return "-";
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const index = Math.round(((deg % 360) / 45)) % 8;
  return directions[index];
};

async function fetchWeather(latitude: number, longitude: number): Promise<WeatherSnapshot> {
  const params = new URLSearchParams({
    lat: latitude.toString(),
    lng: longitude.toString(),
  });
  const response = await fetch(`/api/google/weather?${params.toString()}`);
  if (!response.ok) {
    const errorPayload = await response.json().catch(() => null);
    throw new Error(errorPayload?.error || "Weather unavailable");
  }
  const payload = (await response.json()) as WeatherSnapshot;
  return {
    temperature: payload.temperature ?? 0,
    windSpeed: payload.windSpeed ?? 0,
    windDirection: payload.windDirection ?? null,
    windGust: payload.windGust ?? null,
    humidity: payload.humidity ?? null,
    uvIndex: payload.uvIndex ?? null,
    condition: payload.condition ?? "Conditions",
    time: payload.time ?? "",
  };
}

export function WeatherCard({ variant = "card", layout = "standard", className }: WeatherCardProps) {
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

  const condition = state.data ? state.data.condition || "Conditions" : "";

  const Wrapper: React.ElementType = variant === "card" ? Card : "div";
  const Header: React.ElementType = variant === "card" ? CardHeader : "div";
  const Content: React.ElementType = variant === "card" ? CardContent : "div";

  return (
    <Wrapper
      className={cn(
        variant === "card" && "bg-card/50 backdrop-blur-lg border-border/20",
        className
      )}
    >
      <Header className={cn(variant === "card" ? "" : "flex items-center justify-between")}>
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <CloudSun className="h-4 w-4 text-sky-400" />
            Local Weather
          </CardTitle>
          <CardDescription>{state.locationLabel}</CardDescription>
        </div>
      </Header>
      <Content className={cn("space-y-3 text-sm", layout === "compact" && "space-y-2")}>
        {state.loading ? (
          <p className="text-muted-foreground">Loading weather...</p>
        ) : state.error ? (
          <p className="text-xs text-destructive">{state.error}</p>
        ) : state.data ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-2xl font-semibold">
                {Math.round(state.data.temperature)}°C
              </span>
              <Badge variant="outline">{condition}</Badge>
            </div>
            <div
              className={cn(
                "grid gap-2 text-xs text-muted-foreground",
                layout === "compact" ? "grid-cols-2" : "grid-cols-4"
              )}
            >
              <div className="flex items-center justify-between">
                <span>Humidity</span>
                <span>{state.data.humidity ?? "-"}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span>UV</span>
                <span>{state.data.uvIndex ?? "-"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Wind</span>
                <span>
                  {Math.round(state.data.windSpeed)} km/h {directionToCompass(state.data.windDirection)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Gust</span>
                <span>
                  {state.data.windGust ? `${Math.round(state.data.windGust)} km/h` : "-"}
                </span>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Updated {state.data.time ? new Date(state.data.time).toLocaleTimeString("en-AU") : ""}
            </p>
          </>
        ) : null}
      </Content>
    </Wrapper>
  );
}
