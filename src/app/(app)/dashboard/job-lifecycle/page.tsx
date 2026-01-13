"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { JobLifecycleStage, JOB_LIFECYCLE_LABELS } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { GitBranch, Plus } from "lucide-react";
import { useJobs } from "@/contexts/JobsContext";
import { getLifecycleStageFromStatus } from "@/lib/jobs-data";
import { cn } from "@/lib/utils";

const STAGE_COLORS: Record<JobLifecycleStage, string> = {
  rfq: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  job_scheduled: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  job_live: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  job_completed: "bg-green-500/20 text-green-400 border-green-500/30",
  management_closeoff: "bg-slate-500/20 text-slate-400 border-slate-500/30",
};

const COLUMN_BORDERS: Record<JobLifecycleStage, string> = {
  rfq: "border-t-purple-500",
  job_scheduled: "border-t-blue-500",
  job_live: "border-t-amber-500",
  job_completed: "border-t-green-500",
  management_closeoff: "border-t-slate-500",
};

const stages: JobLifecycleStage[] = [
  "rfq",
  "job_scheduled",
  "job_live",
  "job_completed",
  "management_closeoff",
];

export default function JobLifecyclePage() {
  const router = useRouter();
  const { jobs } = useJobs();
  const [selectedOrganisation, setSelectedOrganisation] = useState("all");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const pipelineJobs = useMemo(
    () =>
      jobs.filter(
        (job) => !job.isDeleted && job.status !== "pending" && job.status !== "cancelled"
      ),
    [jobs]
  );

  const organisations = useMemo(() => {
    const orgMap = new Map<string, string>();
    pipelineJobs.forEach((job) => {
      const key = job.organizationId || job.clientId || job.clientName;
      if (key && !orgMap.has(key)) {
        orgMap.set(key, job.clientName);
      }
    });
    return Array.from(orgMap.entries()).map(([id, name]) => ({ id, name }));
  }, [pipelineJobs]);

  const filteredJobs = useMemo(() => {
    if (selectedOrganisation === "all") return pipelineJobs;
    return pipelineJobs.filter((job) => {
      const key = job.organizationId || job.clientId || job.clientName;
      return key === selectedOrganisation;
    });
  }, [pipelineJobs, selectedOrganisation]);

  const recentJobs = useMemo(() => {
    return [...filteredJobs]
      .sort((a, b) => {
        const aTime = (a.updatedAt ?? a.createdAt).toMillis();
        const bTime = (b.updatedAt ?? b.createdAt).toMillis();
        return bTime - aTime;
      })
      .slice(0, 10);
  }, [filteredJobs]);

  useEffect(() => {
    if (recentJobs.length === 0) {
      setSelectedJobId(null);
      return;
    }
    if (!selectedJobId || !recentJobs.some((job) => job.id === selectedJobId)) {
      setSelectedJobId(recentJobs[0].id);
    }
  }, [recentJobs, selectedJobId]);

  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) || null,
    [jobs, selectedJobId]
  );
  const selectedStage = selectedJob ? getLifecycleStageFromStatus(selectedJob.status) : null;

  const stageCounts = useMemo(() => {
    const counts = stages.reduce(
      (acc, stage) => {
        acc[stage] = 0;
        return acc;
      },
      {} as Record<JobLifecycleStage, number>
    );
    pipelineJobs.forEach((job) => {
      const stage = getLifecycleStageFromStatus(job.status);
      counts[stage] += 1;
    });
    return counts;
  }, [pipelineJobs]);

  const getServiceType = (notes?: string) => {
    const match = notes?.match(/^Service: (.+)$/m);
    return match?.[1] || "Service";
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return "N/A";
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
  };

  return (
    <div className="min-h-screen p-6">
      <div className="mb-8 space-y-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <GitBranch className="h-8 w-8 text-primary" />
              <h1 className="text-3xl font-bold">Job Lifecycle Pipeline</h1>
            </div>
            <p className="text-muted-foreground">
              Select a job to see where it sits in the lifecycle.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Select value={selectedOrganisation} onValueChange={setSelectedOrganisation}>
              <SelectTrigger className="w-[240px]">
                <SelectValue placeholder="Filter by organisation" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All organisations</SelectItem>
                {organisations.map((org) => (
                  <SelectItem key={org.id} value={org.id}>
                    {org.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => router.push("/dashboard/bookings")}>
              <Plus className="mr-2 h-4 w-4" />
              New Booking
            </Button>
          </div>
        </div>
      </div>

      {pipelineJobs.length === 0 ? (
        <Card className="bg-background/60 backdrop-blur-sm">
          <CardContent className="py-16 text-center">
            <GitBranch className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">No Jobs Yet</h3>
            <p className="text-muted-foreground mb-4">
              Create a booking to generate your first job and see it appear here.
            </p>
            <Button onClick={() => router.push("/dashboard/bookings")}>
              <Plus className="mr-2 h-4 w-4" />
              Create Booking
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-5">
            {stages.map((stage) => {
              const isSelected = selectedStage === stage;
              return (
                <Card
                  key={stage}
                  className={cn(
                    "bg-background/60 backdrop-blur-sm border-t-4",
                    COLUMN_BORDERS[stage],
                    isSelected && "ring-2 ring-primary/60"
                  )}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">{JOB_LIFECYCLE_LABELS[stage]}</CardTitle>
                      <Badge className={STAGE_COLORS[stage]}>{stageCounts[stage]}</Badge>
                    </div>
                    <CardDescription className="text-xs">
                      {isSelected && selectedJob
                        ? "Selected job"
                        : "Select a job below"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {isSelected && selectedJob ? (
                      <div className="space-y-2">
                        <p className="font-mono text-sm text-primary">{selectedJob.jobNumber}</p>
                        <p className="text-sm font-medium">{selectedJob.clientName}</p>
                        <p className="text-xs text-muted-foreground">
                          {getServiceType(selectedJob.notes)}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => router.push(`/dashboard/jobs/${selectedJob.id}`)}
                        >
                          Open job card
                        </Button>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Select a job below to see details here.
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card className="bg-card/50 backdrop-blur-lg border-border/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Recent jobs
              </CardTitle>
              <CardDescription>
                Showing the 10 most recent jobs from booked/scheduled onwards.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {recentJobs.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  No jobs match this organisation yet.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Job Number</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Service</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last Updated</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentJobs.map((job) => {
                      const stage = getLifecycleStageFromStatus(job.status);
                      const isSelected = job.id === selectedJobId;
                      return (
                        <TableRow
                          key={job.id}
                          className={cn(
                            "cursor-pointer hover:bg-muted/20",
                            isSelected && "bg-primary/5"
                          )}
                          onClick={() => setSelectedJobId(job.id)}
                        >
                          <TableCell className="font-medium text-primary">
                            {job.jobNumber}
                          </TableCell>
                          <TableCell>{job.clientName}</TableCell>
                          <TableCell>{getServiceType(job.notes)}</TableCell>
                          <TableCell>
                            <Badge className={STAGE_COLORS[stage]}>
                              {JOB_LIFECYCLE_LABELS[stage]}
                            </Badge>
                          </TableCell>
                          <TableCell>{formatDate(job.updatedAt ?? job.createdAt)}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation();
                                router.push(`/dashboard/jobs/${job.id}`);
                              }}
                            >
                              View
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
