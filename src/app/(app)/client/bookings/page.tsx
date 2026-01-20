"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";

import type { Booking } from "@/lib/types";
import { BOOKING_TYPE_LABELS } from "@/lib/types";
import { useJobs } from "@/contexts/JobsContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const statusLabels: Record<Booking["status"], string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  converted_to_job: "Converted",
  cancelled: "Cancelled",
};

export default function ClientBookingsPage() {
  const router = useRouter();
  const { bookings } = useJobs();

  const clientBookings = useMemo(
    () => bookings.slice().sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis()),
    [bookings]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-3xl font-headline font-bold tracking-tight">Bookings</h2>
          <p className="text-muted-foreground">
            Bookings are managed by ASI. Contact support if you need new work scheduled.
          </p>
        </div>
      </div>

      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader>
          <CardTitle className="text-lg">Booking History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {clientBookings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bookings yet.</p>
          ) : (
            <div className="space-y-3">
              {clientBookings.map((booking) => (
                <Card key={booking.id} className="bg-background/50 border-border/50">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{booking.bookingNumber}</p>
                        <p className="text-sm text-muted-foreground">
                          {BOOKING_TYPE_LABELS[booking.bookingType]}
                        </p>
                      </div>
                      <Badge variant="secondary">{statusLabels[booking.status]}</Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {format(booking.scheduledDate.toDate(), "PPP")} at {booking.scheduledTime}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Contact: {booking.contactName}
                    </div>
                    {booking.convertedJobId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => router.push(`/client/jobs/${booking.convertedJobId}`)}
                      >
                        View job card
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
