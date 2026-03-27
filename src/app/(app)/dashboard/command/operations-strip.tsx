"use client";

import { Activity, AlertTriangle, CalendarDays, Clock, Pause, UserX } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  jobsInProgress: number;
  jobsScheduled: number;
  overdueJobs: number;
  onHoldJobs: number;
  unassignedJobs: number;
  jobsCompleted: number;
  avgCompletionHours: number;
  complianceRate: number;
}

function formatHours(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0h";
  return `${value.toFixed(1)}h`;
}

export function OperationsStrip(props: Props) {
  return (
    <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader className="pb-1">
          <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Activity className="h-3.5 w-3.5 text-blue-400" />
            In Progress
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{props.jobsInProgress}</div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader className="pb-1">
          <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5 text-emerald-400" />
            Scheduled
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{props.jobsScheduled}</div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader className="pb-1">
          <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
            Overdue
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold ${props.overdueJobs > 0 ? "text-red-400" : ""}`}>
            {props.overdueJobs}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader className="pb-1">
          <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Pause className="h-3.5 w-3.5 text-amber-400" />
            On Hold
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold ${props.onHoldJobs > 0 ? "text-amber-400" : ""}`}>
            {props.onHoldJobs}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader className="pb-1">
          <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Clock className="h-3.5 w-3.5 text-purple-400" />
            Avg Completion
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatHours(props.avgCompletionHours)}</div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader className="pb-1">
          <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <UserX className="h-3.5 w-3.5 text-orange-400" />
            Unassigned
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold ${props.unassignedJobs > 0 ? "text-orange-400" : ""}`}>
            {props.unassignedJobs}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
