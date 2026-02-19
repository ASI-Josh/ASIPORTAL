"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { JobLifecycleStage, JOB_LIFECYCLE_LABELS, type Inspection, type Job } from "@/lib/types";
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
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
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

type RfqRow =
  | {
      kind: "job";
      id: string;
      reference: string;
      clientName: string;
      serviceType: string;
      statusLabel: string;
      scheduledLabel: string;
      sortMillis: number;
      route: string;
    }
  | {
      kind: "inspection";
      id: string;
      reference: string;
      clientName: string;
      serviceType: string;
      statusLabel: string;
      scheduledLabel: string;
      sortMillis: number;
      route: string;
    };

export default function JobLifecyclePage() {
  const router = useRouter();
  const { jobs } = useJobs();
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [selectedOrganisation, setSelectedOrganisation] = useState("all");
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [activeStage, setActiveStage] = useState<JobLifecycleStage>("job_scheduled");

  useEffect(() => {
    const inspectionsQuery = query(
      collection(db, COLLECTIONS.INSPECTIONS),
      orderBy("createdAt", "desc")
    );
    const unsubscribe = onSnapshot(
      inspectionsQuery,
      (snapshot) => {
        setInspections(
          snapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as Omit<Inspection, "id">),
          }))
        );
      },
      () => setInspections([])
    );
    return () => unsubscribe();
  }, []);

  const getServiceType = (notes?: string, fallback = "Service") => {
    const match = notes?.match(/^Service: (.+)$/m);
    return match?.[1] || fallback;
  };

  const toDateValue = (value: any): Date | null => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value?.toDate === "function") return value.toDate();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const formatDate = (timestamp: any) => {
    const date = toDateValue(timestamp);
    if (!date) return "N/A";
    return date.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
  };

  const toMillis = (value: any) => toDateValue(value)?.getTime() ?? 0;

  const resolveScheduledDate = (job: Job) => {
    return job.scheduledDate || job.booking?.preferredDate || job.updatedAt || job.createdAt;
  };

  const resolveInspectionDate = (inspection: Inspection) =>
    inspection.scheduledDate || inspection.updatedAt || inspection.createdAt;

  const resolveJobOrganisationKey = (job: Job) => job.organizationId || job.clientId || job.clientName;
  const resolveInspectionOrganisationKey = (inspection: Inspection) =>
    inspection.organizationId || inspection.clientId || inspection.organizationName || inspection.clientName;

  const isInspectionRfq = (inspection: Inspection) =>
    !inspection.convertedToJobId &&
    inspection.status !== "converted" &&
    inspection.status !== "rejected" &&
    (inspection.status === "submitted" || inspection.status === "approved");

  const getInspectionRfqStatusLabel = (inspection: Inspection) => {
    if (inspection.quote?.status === "sent") return "Quote Sent";
    if (inspection.quote?.status === "generated") return "Quote Generated";
    if (inspection.status === "approved") return "Approved";
    return "Submitted";
  };

  const pipelineJobs = useMemo(
    () => jobs.filter((job) => !job.isDeleted && job.status !== "cancelled"),
    [jobs]
  );

  const pipelineRfqInspections = useMemo(
    () => inspections.filter((inspection) => isInspectionRfq(inspection)),
    [inspections]
  );

  const organisations = useMemo(() => {
    const orgMap = new Map<string, string>();
    pipelineJobs.forEach((job) => {
      const key = resolveJobOrganisationKey(job);
      if (key && !orgMap.has(key)) {
        orgMap.set(key, job.clientName);
      }
    });
    pipelineRfqInspections.forEach((inspection) => {
      const key = resolveInspectionOrganisationKey(inspection);
      const name = inspection.organizationName || inspection.clientName;
      if (key && name && !orgMap.has(key)) {
        orgMap.set(key, name);
      }
    });
    return Array.from(orgMap.entries()).map(([id, name]) => ({ id, name }));
  }, [pipelineJobs, pipelineRfqInspections]);

  const filteredJobs = useMemo(() => {
    if (selectedOrganisation === "all") return pipelineJobs;
    return pipelineJobs.filter((job) => {
      const key = resolveJobOrganisationKey(job);
      return key === selectedOrganisation;
    });
  }, [pipelineJobs, selectedOrganisation]);

  const filteredRfqInspections = useMemo(() => {
    if (selectedOrganisation === "all") return pipelineRfqInspections;
    return pipelineRfqInspections.filter((inspection) => {
      const key = resolveInspectionOrganisationKey(inspection);
      return key === selectedOrganisation;
    });
  }, [pipelineRfqInspections, selectedOrganisation]);

  const sortedJobs = useMemo(() => {
    return [...filteredJobs].sort((a, b) => {
      const aDate = resolveScheduledDate(a);
      const bDate = resolveScheduledDate(b);
      const aMillis = toMillis(aDate);
      const bMillis = toMillis(bDate);
      return aMillis - bMillis;
    });
  }, [filteredJobs]);

  const sortedRfqInspections = useMemo(
    () =>
      [...filteredRfqInspections].sort(
        (a, b) => toMillis(resolveInspectionDate(a)) - toMillis(resolveInspectionDate(b))
      ),
    [filteredRfqInspections]
  );

  const stageCounts = useMemo(() => {
    const counts = stages.reduce(
      (acc, stage) => {
        acc[stage] = 0;
        return acc;
      },
      {} as Record<JobLifecycleStage, number>
    );
    filteredJobs.forEach((job) => {
      const stage = getLifecycleStageFromStatus(job.status);
      counts[stage] += 1;
    });
    counts.rfq += filteredRfqInspections.length;
    return counts;
  }, [filteredJobs, filteredRfqInspections.length]);

  const activeStageJobs = useMemo(
    () => sortedJobs.filter((job) => getLifecycleStageFromStatus(job.status) === activeStage),
    [sortedJobs, activeStage]
  );

  const activeRfqRows = useMemo(() => {
    if (activeStage !== "rfq") return [];

    const jobRows: RfqRow[] = sortedJobs
      .filter((job) => getLifecycleStageFromStatus(job.status) === "rfq")
      .map((job) => {
        const scheduled = resolveScheduledDate(job);
        return {
          kind: "job",
          id: job.id,
          reference: job.jobNumber,
          clientName: job.clientName,
          serviceType: getServiceType(job.notes),
          statusLabel: "RFQ",
          scheduledLabel: formatDate(scheduled),
          sortMillis: toMillis(scheduled),
          route: `/dashboard/jobs/${job.id}`,
        };
      });

    const inspectionRows: RfqRow[] = sortedRfqInspections.map((inspection) => {
      const scheduled = resolveInspectionDate(inspection);
      return {
        kind: "inspection",
        id: inspection.id,
        reference: inspection.inspectionNumber,
        clientName: inspection.organizationName || inspection.clientName || "-",
        serviceType: "Inspection RFQ",
        statusLabel: getInspectionRfqStatusLabel(inspection),
        scheduledLabel: formatDate(scheduled),
        sortMillis: toMillis(scheduled),
        route: `/dashboard/inspections/${inspection.id}`,
      };
    });

    return [...jobRows, ...inspectionRows].sort((a, b) => a.sortMillis - b.sortMillis);
  }, [activeStage, sortedJobs, sortedRfqInspections]);

  const activeRows = useMemo(() => {
    if (activeStage === "rfq") return activeRfqRows;

    return activeStageJobs.map((job) => {
      const stage = getLifecycleStageFromStatus(job.status);
      const scheduled = resolveScheduledDate(job);
      return {
        kind: "job" as const,
        id: job.id,
        reference: job.jobNumber,
        clientName: job.clientName,
        serviceType: getServiceType(job.notes),
        statusLabel: JOB_LIFECYCLE_LABELS[stage],
        scheduledLabel: formatDate(scheduled),
        sortMillis: toMillis(scheduled),
        route: `/dashboard/jobs/${job.id}`,
      };
    });
  }, [activeRfqRows, activeStage, activeStageJobs]);

  const hasPipelineEntries = pipelineJobs.length + pipelineRfqInspections.length > 0;

  const getStageItemLabel = (stage: JobLifecycleStage, count: number) => {
    if (stage === "rfq") return count === 1 ? "RFQ" : "RFQs";
    return count === 1 ? "job" : "jobs";
  };

  useEffect(() => {
    if (stageCounts[activeStage] > 0) return;
    const nextStage = stages.find((stage) => stageCounts[stage] > 0);
    if (nextStage) {
      setActiveStage(nextStage);
    }
  }, [activeStage, stageCounts]);

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
              Select a record to see where it sits in the lifecycle.
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

      {!hasPipelineEntries ? (
        <Card className="bg-background/60 backdrop-blur-sm">
          <CardContent className="py-16 text-center">
            <GitBranch className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">No Pipeline Items Yet</h3>
            <p className="text-muted-foreground mb-4">
              Create a booking or complete an inspection RFQ to see it appear here.
            </p>
            <Button onClick={() => router.push("/dashboard/bookings")}>
              <Plus className="mr-2 h-4 w-4" />
              Create booking
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-5">
            {stages.map((stage) => {
              const isSelected = activeStage === stage;
              return (
                <Card
                  key={stage}
                  className={cn(
                    "bg-background/60 backdrop-blur-sm border-t-4 cursor-pointer transition",
                    COLUMN_BORDERS[stage],
                    isSelected && "ring-2 ring-primary/60"
                  )}
                  onClick={() => setActiveStage(stage)}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">{JOB_LIFECYCLE_LABELS[stage]}</CardTitle>
                      <Badge className={STAGE_COLORS[stage]}>{stageCounts[stage]}</Badge>
                    </div>
                    <CardDescription className="text-xs">
                      {isSelected ? "Showing records below" : "Click to view stage"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">
                      {stageCounts[stage]} {getStageItemLabel(stage, stageCounts[stage])} in this stage.
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card className="bg-card/50 backdrop-blur-lg border-border/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {activeStage === "rfq"
                  ? JOB_LIFECYCLE_LABELS[activeStage]
                  : `${JOB_LIFECYCLE_LABELS[activeStage]} jobs`}
              </CardTitle>
              <CardDescription>
                {activeStage === "rfq"
                  ? "Showing all RFQs currently in this pipeline stage."
                  : "Showing all jobs currently in this pipeline stage."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {activeRows.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  No records are currently in this stage.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{activeStage === "rfq" ? "Reference" : "Job Number"}</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Service</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Scheduled Date</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeRows.map((row) => {
                      const rowKey = `${row.kind}:${row.id}`;
                      const isSelected = rowKey === selectedRecordId;
                      return (
                        <TableRow
                          key={rowKey}
                          className={cn(
                            "cursor-pointer hover:bg-muted/20",
                            isSelected && "bg-primary/5"
                          )}
                          onClick={() => {
                            setSelectedRecordId(rowKey);
                          }}
                        >
                          <TableCell className="font-medium text-primary">
                            {row.reference}
                          </TableCell>
                          <TableCell>{row.clientName}</TableCell>
                          <TableCell>{row.serviceType}</TableCell>
                          <TableCell>
                            <Badge
                              className={
                                row.kind === "inspection"
                                  ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/30"
                                  : STAGE_COLORS[activeStage]
                              }
                            >
                              {row.statusLabel}
                            </Badge>
                          </TableCell>
                          <TableCell>{row.scheduledLabel}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation();
                                router.push(row.route);
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
