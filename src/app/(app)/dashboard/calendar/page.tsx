"use client";

import { useEffect, useMemo, useState } from "react";
import { Calendar, CheckCircle2, Link2Off, RefreshCw, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

type GoogleCalendarEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  organizer?: { email?: string; displayName?: string };
  attendees?: {
    email?: string;
    displayName?: string;
    responseStatus?: string;
    organizer?: boolean;
    self?: boolean;
  }[];
  conferenceData?: {
    entryPoints?: { entryPointType?: string; uri?: string; label?: string }[];
  };
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

const DEFAULT_RANGE_DAYS = 30;

export default function CalendarPage() {
  const { firebaseUser, user } = useAuth();
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [events, setEvents] = useState<GoogleCalendarEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canUseCalendar = user?.role === "admin" || user?.role === "technician";

  const successMessage = useMemo(() => {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    return params.get("connected") ? "Google Calendar connected." : "";
  }, []);

  const getAuthHeaders = async () => {
    if (!firebaseUser) throw new Error("Not signed in");
    const token = await firebaseUser.getIdToken();
    return { Authorization: `Bearer ${token}` };
  };

  const loadStatus = async () => {
    if (!firebaseUser) return;
    setLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/google/calendar/status", { headers });
      if (!res.ok) {
        throw new Error("Unable to load calendar status.");
      }
      const data = (await res.json()) as { connected?: boolean };
      setConnected(Boolean(data.connected));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Calendar status failed.");
    } finally {
      setLoading(false);
    }
  };

  const loadEvents = async () => {
    if (!firebaseUser) return;
    setSyncing(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams({ rangeDays: String(DEFAULT_RANGE_DAYS) });
      const res = await fetch(`/api/google/calendar/events?${params}`, { headers });
      if (!res.ok) {
        throw new Error("Unable to load calendar events.");
      }
      const data = (await res.json()) as { events?: GoogleCalendarEvent[] };
      setEvents(data.events ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Calendar events failed.");
    } finally {
      setSyncing(false);
    }
  };

  const handleConnect = async () => {
    if (!firebaseUser) return;
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/google/calendar/auth-url", {
        method: "POST",
        headers,
      });
      if (!res.ok) {
        throw new Error("Unable to start Google Calendar auth.");
      }
      const data = (await res.json()) as { url?: string };
      if (!data.url) {
        throw new Error("Missing Google auth URL.");
      }
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Calendar auth failed.");
    }
  };

  const handleDisconnect = async () => {
    if (!firebaseUser) return;
    setSyncing(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/google/calendar/disconnect", {
        method: "POST",
        headers,
      });
      if (!res.ok) {
        throw new Error("Unable to disconnect calendar.");
      }
      setConnected(false);
      setEvents([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Calendar disconnect failed.");
    } finally {
      setSyncing(false);
    }
  };

  const formatEventDate = (value?: string) => {
    if (!value) return "Unknown date";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.valueOf())) return value;
    return parsed.toLocaleString("en-AU");
  };

  const getVideoLink = (event: GoogleCalendarEvent) => {
    if (event.hangoutLink) return event.hangoutLink;
    const entryPoints = event.conferenceData?.entryPoints || [];
    const video = entryPoints.find((entry) => entry.entryPointType === "video");
    return video?.uri;
  };

  useEffect(() => {
    loadStatus();
  }, [firebaseUser]);

  useEffect(() => {
    if (connected) {
      loadEvents();
    }
  }, [connected]);

  return (
    <div className="flex-1 space-y-6">
      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-2xl font-headline flex items-center gap-2">
              <Calendar className="h-6 w-6 text-primary" />
              Calendar Integration
            </CardTitle>
            <p className="text-muted-foreground mt-2">
              Connect Google Calendar to sync upcoming work and view your schedule.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {connected ? (
              <Button variant="secondary" onClick={handleDisconnect} disabled={syncing}>
                <Link2Off className="h-4 w-4 mr-2" />
                Disconnect
              </Button>
            ) : (
              <Button onClick={handleConnect} disabled={loading || !canUseCalendar}>
                Connect Google Calendar
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {successMessage ? (
            <div className="flex items-center gap-2 text-sm text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
              {successMessage}
            </div>
          ) : null}
          {error ? (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <TriangleAlert className="h-4 w-4" />
              {error}
            </div>
          ) : null}
          {!canUseCalendar ? (
            <div className="text-sm text-muted-foreground">
              Calendar integration is available for admin and technician accounts only.
            </div>
          ) : null}
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              Status:{" "}
              {loading ? "Checking..." : connected ? "Connected" : "Not connected"}
            </span>
            {connected ? (
              <Button variant="outline" onClick={loadEvents} disabled={syncing}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh events
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {connected ? (
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader>
            <CardTitle className="text-lg font-headline">
              Upcoming events (next {DEFAULT_RANGE_DAYS} days)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {syncing && events.length === 0 ? (
              <p className="text-sm text-muted-foreground">Loading events...</p>
            ) : null}
            {events.length === 0 && !syncing ? (
              <p className="text-sm text-muted-foreground">
                No upcoming events found.
              </p>
            ) : null}
            {events.map((event) => {
              const start = event.start?.dateTime || event.start?.date;
              const end = event.end?.dateTime || event.end?.date;
              const isSelected = selectedEventId === event.id;
              const attendeeList = event.attendees || [];
              const otherInvitees = attendeeList.filter((attendee) => !attendee.organizer);
              const videoLink = getVideoLink(event);
              return (
                <div
                  key={event.id}
                  className="rounded-lg border border-border/50 p-3 cursor-pointer transition hover:border-primary/50"
                  onClick={() =>
                    setSelectedEventId((current) => (current === event.id ? null : event.id))
                  }
                >
                  <div className="font-medium">{event.summary || "Untitled event"}</div>
                  {event.description ? (
                    <div className="text-sm text-muted-foreground mt-1 line-clamp-2">
                      {event.description}
                    </div>
                  ) : null}
                  <div className="text-xs text-muted-foreground mt-2">
                    {formatEventDate(start)}
                    {end ? ` → ${formatEventDate(end)}` : ""}
                  </div>
                  {isSelected ? (
                    <div className="mt-3 space-y-2 text-sm">
                      {event.location ? (
                        <div>
                          <span className="font-medium">Address:</span> {event.location}
                        </div>
                      ) : null}
                      {videoLink ? (
                        <div>
                          <span className="font-medium">Video call:</span>{" "}
                          <a
                            className="text-primary underline"
                            href={videoLink}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Join meeting
                          </a>
                        </div>
                      ) : null}
                      {event.htmlLink ? (
                        <div>
                          <span className="font-medium">Calendar link:</span>{" "}
                          <a
                            className="text-primary underline"
                            href={event.htmlLink}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open in Google Calendar
                          </a>
                        </div>
                      ) : null}
                      {event.organizer?.email ? (
                        <div>
                          <span className="font-medium">Organiser:</span>{" "}
                          {event.organizer.displayName || event.organizer.email}
                        </div>
                      ) : null}
                      {otherInvitees.length > 0 ? (
                        <div>
                          <span className="font-medium">Invitees:</span>{" "}
                          {otherInvitees
                            .map((attendee) => attendee.displayName || attendee.email)
                            .filter(Boolean)
                            .join(", ")}
                        </div>
                      ) : null}
                      {event.description ? (
                        <div>
                          <span className="font-medium">Notes:</span> {event.description}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
