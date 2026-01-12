"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClipboardList, Search, Calendar, Plus, FileText, Download } from "lucide-react";
import { useJobs } from "@/contexts/JobsContext";

function getStatusColor(status: string) {
  switch (status) {
    case "Completed":
      return "text-green-400";
    case "In Progress":
      return "text-amber-400";
    case "Scheduled":
      return "text-blue-400";
    default:
      return "text-muted-foreground";
  }
}

function getComplianceColor(compliance: string) {
  switch (compliance) {
    case "Compliant":
      return "bg-green-500/20 text-green-400 border-green-500/30";
    case "Non-Conformance":
      return "bg-red-500/20 text-red-400 border-red-500/30";
    case "Pending":
      return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export default function WorksRegisterPage() {
  const router = useRouter();
  const { getWorksRegisterDisplayData, worksRegister, jobs } = useJobs();
  const [searchQuery, setSearchQuery] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const worksData = getWorksRegisterDisplayData();

  // Filter by search and date range
  const filteredData = worksData.filter((work) => {
    const matchesSearch =
      work.jobNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      work.client.toLowerCase().includes(searchQuery.toLowerCase()) ||
      work.technician.toLowerCase().includes(searchQuery.toLowerCase()) ||
      work.serviceType.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesDateRange =
      (!startDate || work.startDate >= startDate) &&
      (!endDate || work.startDate <= endDate);

    return matchesSearch && matchesDateRange;
  });

  // Summary stats
  const totalJobs = worksData.length;
  const completedJobs = worksData.filter((w) => w.status === "Completed").length;
  const inProgressJobs = worksData.filter((w) => w.status === "In Progress").length;
  const complianceRate =
    totalJobs > 0
      ? Math.round(
          (worksData.filter((w) => w.compliance === "Compliant").length / totalJobs) * 100
        )
      : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-lg bg-blue-500/20 backdrop-blur-sm">
            <ClipboardList className="h-8 w-8 text-blue-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Works Register</h1>
            <p className="text-muted-foreground">ISO 9001 Compliant Works Tracking</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
          <Button size="sm" onClick={() => router.push("/dashboard/bookings")}>
            <Plus className="mr-2 h-4 w-4" />
            New Booking
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-card/50 backdrop-blur">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{totalJobs}</div>
            <p className="text-xs text-muted-foreground">Total Jobs</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-green-400">{completedJobs}</div>
            <p className="text-xs text-muted-foreground">Completed</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-amber-400">{inProgressJobs}</div>
            <p className="text-xs text-muted-foreground">In Progress</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-blue-400">{complianceRate}%</div>
            <p className="text-xs text-muted-foreground">Compliance Rate</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="bg-card/50 backdrop-blur">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4">
            <div className="relative flex-1 min-w-[250px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by job number, client, or technician..."
                className="pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <Input
                type="date"
                className="w-[150px]"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
              <span className="text-muted-foreground">to</span>
              <Input
                type="date"
                className="w-[150px]"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Works Table */}
      <Card className="bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Historical Works Record
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredData.length === 0 ? (
            <div className="text-center py-12">
              <ClipboardList className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No Works Records Yet</h3>
              <p className="text-muted-foreground mb-4">
                Create a booking to generate your first works register entry.
              </p>
              <Button onClick={() => router.push("/dashboard/bookings")}>
                <Plus className="mr-2 h-4 w-4" />
                Create Booking
              </Button>
            </div>
          ) : (
            <div className="rounded-md border border-border/50 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead>Job Number</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Service Type</TableHead>
                    <TableHead>Technician</TableHead>
                    <TableHead>Start Date</TableHead>
                    <TableHead>Completion Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Compliance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredData.map((work) => (
                    <TableRow
                      key={work.jobNumber}
                      className="hover:bg-muted/20 cursor-pointer"
                      onClick={() => {
                        const job = jobs.find((j) => j.jobNumber === work.jobNumber);
                        if (job) {
                          router.push(`/dashboard/jobs/${job.id}`);
                        }
                      }}
                    >
                      <TableCell className="font-medium text-primary">
                        {work.jobNumber}
                      </TableCell>
                      <TableCell>{work.client}</TableCell>
                      <TableCell>{work.serviceType}</TableCell>
                      <TableCell>{work.technician}</TableCell>
                      <TableCell>{work.startDate}</TableCell>
                      <TableCell>{work.completionDate}</TableCell>
                      <TableCell className={getStatusColor(work.status)}>
                        {work.status}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={getComplianceColor(work.compliance)}>
                          {work.compliance}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
