"use client";

import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { useJobs } from "@/contexts/JobsContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function ClientJobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { jobs } = useJobs();

  const job = useMemo(() => jobs.find((item) => item.id === id), [jobs, id]);

  if (!job) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <h2 className="text-xl font-semibold">Job not found</h2>
        <Button onClick={() => router.push("/client/bookings")}>
          <ChevronLeft className="mr-2 h-4 w-4" />
          Back to bookings
        </Button>
      </div>
    );
  }

  const serviceType = job.notes?.split("\n")[0]?.replace("Service: ", "") || "Service";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Button variant="ghost" size="sm" onClick={() => router.back()}>
            <ChevronLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <h2 className="text-3xl font-headline font-bold tracking-tight">{job.jobNumber}</h2>
          <p className="text-muted-foreground">{serviceType}</p>
        </div>
        <Badge variant="secondary">{job.status}</Badge>
      </div>

      {job.jobDescription && (
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader>
            <CardTitle className="text-base">Job Summary</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {job.jobDescription}
          </CardContent>
        </Card>
      )}

      {job.jobVehicles?.length ? (
        <div className="space-y-4">
          {job.jobVehicles.map((vehicle) => (
            <Card key={vehicle.id} className="bg-card/50 backdrop-blur-lg border-border/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {vehicle.registration || vehicle.fleetAssetNumber || vehicle.vin || "Vehicle"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {vehicle.repairSites.map((site) => (
                  <div key={site.id} className="border border-border/50 rounded-md p-3">
                    <div className="font-medium">{site.location}</div>
                    <div className="text-muted-foreground">{site.description || "Repair site"}</div>
                    {site.totalCost !== undefined && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Estimated cost: ${site.totalCost.toFixed(2)}
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardContent className="p-6 text-sm text-muted-foreground">
            Job details will appear here once work starts.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
