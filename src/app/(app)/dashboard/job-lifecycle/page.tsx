"use client";

import { useRouter } from "next/navigation";
import { JobLifecycleStage, JOB_LIFECYCLE_LABELS, BOOKING_TYPE_LABELS } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GitBranch, ArrowRight, Plus } from "lucide-react";
import { useJobs } from "@/contexts/JobsContext";
import { getLifecycleStageFromStatus } from "@/lib/jobs-data";
import { asiStaff } from "@/lib/contacts-data";
import { useAuth } from "@/contexts/AuthContext";

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
  const { jobs, updateJobLifecycleStage } = useJobs();
  const { user } = useAuth();

  // Convert jobs to lifecycle cards
  const jobCards = jobs.map((job) => {
    // Extract service type from notes (first line after "Service: ")
    const serviceMatch = job.notes?.match(/^Service: (.+)$/m);
    const serviceType = serviceMatch ? serviceMatch[1] : "Service";

    // Get technician names
    const techNames = job.assignedTechnicians
      .map((t) => {
        const staff = asiStaff.find((s) => s.id === t.technicianId);
        return t.technicianName || staff?.name || t.technicianId;
      })
      .join(", ");

    return {
      id: job.id,
      jobNumber: job.jobNumber,
      clientName: job.clientName,
      serviceType,
      technician: techNames || "Unassigned",
      scheduledDate: job.scheduledDate
        ? job.scheduledDate.toDate().toLocaleDateString("en-AU", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })
        : "TBD",
      stage: getLifecycleStageFromStatus(job.status),
    };
  });

  const getJobsByStage = (stage: JobLifecycleStage) =>
    jobCards.filter((job) => job.stage === stage);

  const handleMoveToNextStage = (jobId: string, currentStage: JobLifecycleStage) => {
    const currentIndex = stages.indexOf(currentStage);
    if (currentIndex < stages.length - 1) {
      const nextStage = stages[currentIndex + 1];
      updateJobLifecycleStage(jobId, nextStage, user?.name || "System");
    }
  };

  const handleJobClick = (jobId: string) => {
    router.push(`/dashboard/jobs/${jobId}`);
  };

  return (
    <div className="min-h-screen p-6">
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <GitBranch className="h-8 w-8 text-primary" />
              <h1 className="text-3xl font-bold">Job Lifecycle Pipeline</h1>
            </div>
            <p className="text-muted-foreground">
              Track jobs as they move through each stage of the workflow
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => router.push("/dashboard/bookings")}>
              <Plus className="mr-2 h-4 w-4" />
              New Booking
            </Button>
          </div>
        </div>
      </div>

      {jobs.length === 0 ? (
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
        <div className="flex gap-4 overflow-x-auto pb-4">
          {stages.map((stage, index) => {
            const stageJobs = getJobsByStage(stage);
            return (
              <div key={stage} className="flex items-start gap-2">
                <Card
                  className={`min-w-[320px] bg-background/60 backdrop-blur-sm border-t-4 ${COLUMN_BORDERS[stage]}`}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{JOB_LIFECYCLE_LABELS[stage]}</CardTitle>
                      <Badge className={STAGE_COLORS[stage]}>{stageJobs.length}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {stageJobs.map((job) => (
                      <Card
                        key={job.id}
                        className="bg-background/80 backdrop-blur-sm border-border/50 hover:border-primary/50 transition-colors cursor-pointer"
                        onClick={() => handleJobClick(job.id)}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-mono text-sm font-semibold text-primary">
                              {job.jobNumber}
                            </span>
                            <Badge variant="outline" className="text-xs">
                              {job.scheduledDate}
                            </Badge>
                          </div>
                          <h3 className="font-medium mb-1">{job.clientName}</h3>
                          <p className="text-sm text-muted-foreground mb-2">{job.serviceType}</p>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">
                              Tech: {job.technician}
                            </span>
                            {index < stages.length - 1 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMoveToNextStage(job.id, stage);
                                }}
                                title={`Move to ${JOB_LIFECYCLE_LABELS[stages[index + 1]]}`}
                              >
                                <ArrowRight className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                    {stageJobs.length === 0 && (
                      <div className="text-center py-8 text-muted-foreground text-sm">
                        No jobs in this stage
                      </div>
                    )}
                  </CardContent>
                </Card>
                {index < stages.length - 1 && (
                  <div className="hidden lg:flex items-center h-full pt-16">
                    <ArrowRight className="h-5 w-5 text-muted-foreground/50" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
