"use client";

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
import { ClipboardList, Search, Calendar } from "lucide-react";

const mockWorksData = [
  {
    jobNumber: "WR-2024-001",
    client: "Metro Rail Authority",
    serviceType: "Track Inspection",
    technician: "John Smith",
    startDate: "2024-01-15",
    completionDate: "2024-01-18",
    status: "Completed",
    compliance: "Compliant",
  },
  {
    jobNumber: "WR-2024-002",
    client: "Sydney Trains",
    serviceType: "Signal Maintenance",
    technician: "Sarah Johnson",
    startDate: "2024-01-20",
    completionDate: "2024-01-22",
    status: "Completed",
    compliance: "Compliant",
  },
  {
    jobNumber: "WR-2024-003",
    client: "ARTC",
    serviceType: "Level Crossing Audit",
    technician: "Mike Chen",
    startDate: "2024-02-01",
    completionDate: "-",
    status: "In Progress",
    compliance: "Pending",
  },
  {
    jobNumber: "WR-2024-004",
    client: "Queensland Rail",
    serviceType: "Track Geometry Survey",
    technician: "Emma Wilson",
    startDate: "2024-02-05",
    completionDate: "2024-02-08",
    status: "Completed",
    compliance: "Compliant",
  },
  {
    jobNumber: "WR-2024-005",
    client: "V/Line",
    serviceType: "Rail Flaw Detection",
    technician: "David Brown",
    startDate: "2024-02-10",
    completionDate: "-",
    status: "Scheduled",
    compliance: "Pending",
  },
  {
    jobNumber: "WR-2024-006",
    client: "Metro Trains Melbourne",
    serviceType: "Overhead Line Inspection",
    technician: "Lisa Taylor",
    startDate: "2024-02-12",
    completionDate: "2024-02-14",
    status: "Completed",
    compliance: "Non-Conformance",
  },
];

function getStatusColor(status: string) {
  switch (status) {
    case "Completed":
      return "text-green-400";
    case "In Progress":
      return "text-yellow-400";
    case "Scheduled":
      return "text-blue-400";
    default:
      return "text-gray-400";
  }
}

function getComplianceColor(compliance: string) {
  switch (compliance) {
    case "Compliant":
      return "text-green-400 bg-green-400/10";
    case "Non-Conformance":
      return "text-red-400 bg-red-400/10";
    case "Pending":
      return "text-yellow-400 bg-yellow-400/10";
    default:
      return "text-gray-400 bg-gray-400/10";
  }
}

export default function WorksRegisterPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-lg bg-blue-500/20 backdrop-blur-sm">
            <ClipboardList className="h-8 w-8 text-blue-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">Works Register</h1>
            <p className="text-slate-400">ISO 9001 Compliant Works Tracking</p>
          </div>
        </div>

        {/* Filters */}
        <Card className="bg-slate-800/50 backdrop-blur-sm border-slate-700">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4">
              <div className="relative flex-1 min-w-[250px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search by job number, client, or technician..."
                  className="pl-10 bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500"
                />
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-slate-400" />
                <Input
                  type="date"
                  className="bg-slate-900/50 border-slate-600 text-white w-[150px]"
                />
                <span className="text-slate-400">to</span>
                <Input
                  type="date"
                  className="bg-slate-900/50 border-slate-600 text-white w-[150px]"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Works Table */}
        <Card className="bg-slate-800/50 backdrop-blur-sm border-slate-700">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-blue-400" />
              Historical Works Record
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-slate-700 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-900/50 hover:bg-slate-900/50 border-slate-700">
                    <TableHead className="text-slate-300">Job Number</TableHead>
                    <TableHead className="text-slate-300">Client</TableHead>
                    <TableHead className="text-slate-300">Service Type</TableHead>
                    <TableHead className="text-slate-300">Technician</TableHead>
                    <TableHead className="text-slate-300">Start Date</TableHead>
                    <TableHead className="text-slate-300">Completion Date</TableHead>
                    <TableHead className="text-slate-300">Status</TableHead>
                    <TableHead className="text-slate-300">Compliance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mockWorksData.map((work) => (
                    <TableRow
                      key={work.jobNumber}
                      className="border-slate-700 hover:bg-slate-700/50"
                    >
                      <TableCell className="font-medium text-blue-400">
                        {work.jobNumber}
                      </TableCell>
                      <TableCell className="text-slate-200">{work.client}</TableCell>
                      <TableCell className="text-slate-200">{work.serviceType}</TableCell>
                      <TableCell className="text-slate-200">{work.technician}</TableCell>
                      <TableCell className="text-slate-300">{work.startDate}</TableCell>
                      <TableCell className="text-slate-300">{work.completionDate}</TableCell>
                      <TableCell className={getStatusColor(work.status)}>
                        {work.status}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium ${getComplianceColor(work.compliance)}`}
                        >
                          {work.compliance}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
