"use client";

import { JobLifecycleStage, JOB_LIFECYCLE_LABELS } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GitBranch, ArrowRight } from "lucide-react";

interface JobCard {
  id: string;
  jobNumber: string;
  clientName: string;
  serviceType: string;
  technician: string;
  scheduledDate: string;
  stage: JobLifecycleStage;
}

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

const mockJobs: JobCard[] = [
  { id: "1", jobNumber: "JOB-2024-001", clientName: "Metro Transport", serviceType: "Windscreen Repair", technician: "James Wilson", scheduledDate: "2024-01-15", stage: "rfq" },
  { id: "2", jobNumber: "JOB-2024-002", clientName: "City Fleet Services", serviceType: "Film Installation", technician: "Unassigned", scheduledDate: "2024-01-16", stage: "rfq" },
  { id: "3", jobNumber: "JOB-2024-003", clientName: "Government Motors", serviceType: "Scratch Removal", technician: "Sarah Chen", scheduledDate: "2024-01-17", stage: "rfq" },
  { id: "4", jobNumber: "JOB-2024-004", clientName: "ABC Logistics", serviceType: "Trim Restoration", technician: "Mike Brown", scheduledDate: "2024-01-18", stage: "job_scheduled" },
  { id: "5", jobNumber: "JOB-2024-005", clientName: "Express Couriers", serviceType: "Lens Restoration", technician: "James Wilson", scheduledDate: "2024-01-19", stage: "job_scheduled" },
  { id: "6", jobNumber: "JOB-2024-006", clientName: "State Transit", serviceType: "Film Installation", technician: "Sarah Chen", scheduledDate: "2024-01-20", stage: "job_live" },
  { id: "7", jobNumber: "JOB-2024-007", clientName: "Regional Buses", serviceType: "Windscreen Repair", technician: "Mike Brown", scheduledDate: "2024-01-21", stage: "job_live" },
  { id: "8", jobNumber: "JOB-2024-008", clientName: "Corporate Fleet", serviceType: "Graffiti Removal", technician: "James Wilson", scheduledDate: "2024-01-22", stage: "job_live" },
  { id: "9", jobNumber: "JOB-2024-009", clientName: "Mining Corp", serviceType: "Film Installation", technician: "Sarah Chen", scheduledDate: "2024-01-10", stage: "job_completed" },
  { id: "10", jobNumber: "JOB-2024-010", clientName: "School District", serviceType: "Scratch Removal", technician: "Mike Brown", scheduledDate: "2024-01-08", stage: "job_completed" },
  { id: "11", jobNumber: "JOB-2024-011", clientName: "Police Fleet", serviceType: "Windscreen Repair", technician: "James Wilson", scheduledDate: "2024-01-05", stage: "management_closeoff" },
  { id: "12", jobNumber: "JOB-2024-012", clientName: "Fire Services", serviceType: "Trim Restoration", technician: "Sarah Chen", scheduledDate: "2024-01-03", stage: "management_closeoff" },
];

const stages: JobLifecycleStage[] = ["rfq", "job_scheduled", "job_live", "job_completed", "management_closeoff"];

export default function JobLifecyclePage() {
  const getJobsByStage = (stage: JobLifecycleStage) => mockJobs.filter((job) => job.stage === stage);

  return (
    <div className="min-h-screen p-6">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <GitBranch className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold">Job Lifecycle Pipeline</h1>
        </div>
        <p className="text-muted-foreground">
          Track jobs as they move through each stage of the workflow
        </p>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {stages.map((stage, index) => {
          const stageJobs = getJobsByStage(stage);
          return (
            <div key={stage} className="flex items-start gap-2">
              <Card className={`min-w-[320px] bg-background/60 backdrop-blur-sm border-t-4 ${COLUMN_BORDERS[stage]}`}>
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
                          <Button variant="ghost" size="sm" className="h-6 px-2">
                            <ArrowRight className="h-3 w-3" />
                          </Button>
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
    </div>
  );
}
