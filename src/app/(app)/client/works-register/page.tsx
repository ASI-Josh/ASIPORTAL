"use client";

import { useMemo } from "react";
import { useJobs } from "@/contexts/JobsContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function ClientWorksRegisterPage() {
  const { worksRegister } = useJobs();

  const entries = useMemo(
    () =>
      worksRegister.slice().sort((a, b) => b.startDate.toMillis() - a.startDate.toMillis()),
    [worksRegister]
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-headline font-bold tracking-tight">Works Register</h2>
        <p className="text-muted-foreground">
          Track active and completed works for your organisation.
        </p>
      </div>

      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader>
          <CardTitle className="text-lg">Recent Works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {entries.length === 0 ? (
            <p className="text-muted-foreground">No works recorded yet.</p>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium">{entry.jobNumber}</div>
                  <div className="text-muted-foreground">{entry.serviceType}</div>
                </div>
                <div className="text-right">
                  <Badge variant="outline">
                    {entry.recordType === "inspection" ? "Inspection" : "Job"}
                  </Badge>
                  <div className="text-xs text-muted-foreground mt-1">
                    {entry.startDate.toDate().toLocaleDateString("en-AU")}
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
