"use client";

import { useParams } from "next/navigation";
import type { Job, JobStatus, Vehicle, DamageItem, QuoteLineItem, TechnicianAssignment, StatusLogEntry } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Briefcase, Car, Camera, FileText, Users, Calendar, MapPin, Clock, Edit, Printer, X, Phone, Mail, DollarSign, AlertTriangle, CheckCircle, Wrench } from "lucide-react";

const statusColors: Record<JobStatus, string> = {
  pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  scheduled: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  in_progress: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  completed: "bg-green-500/20 text-green-400 border-green-500/30",
  cancelled: "bg-red-500/20 text-red-400 border-red-500/30",
};

const severityColors = {
  minor: "bg-green-500/20 text-green-400",
  moderate: "bg-yellow-500/20 text-yellow-400",
  severe: "bg-red-500/20 text-red-400",
};

const mockJob: Job & { siteLocation?: { name: string; address: string } } = {
  id: "job-001",
  jobNumber: "JOB-2024-0042",
  clientId: "client-001",
  clientName: "Metro Fleet Services",
  clientEmail: "fleet@metroservices.com.au",
  clientPhone: "02 9555 1234",
  vehicles: [
    { registration: "ABC-123", make: "Toyota", model: "HiLux", year: 2022, color: "White", vin: "JTFR123456789" },
    { registration: "XYZ-789", make: "Ford", model: "Ranger", year: 2023, color: "Blue", vin: "MNBR987654321" },
    { registration: "DEF-456", make: "Mazda", model: "BT-50", year: 2021, color: "Silver", vin: "JMZR567891234" },
  ],
  damage: [
    { id: "dmg-1", description: "Windscreen chip - driver side", severity: "minor", location: "Front windscreen", photoUrls: ["/placeholder.jpg"], estimatedCost: 150 },
    { id: "dmg-2", description: "Deep scratch on bonnet", severity: "moderate", location: "Bonnet - center", photoUrls: ["/placeholder.jpg", "/placeholder.jpg"], estimatedCost: 450 },
    { id: "dmg-3", description: "Cracked headlight lens", severity: "severe", location: "Front left headlight", photoUrls: ["/placeholder.jpg"], estimatedCost: 680 },
  ],
  status: "in_progress",
  assignedTechnicians: [
    { technicianId: "tech-001", role: "primary", assignedAt: { toDate: () => new Date("2024-01-15") } as any, assignedBy: "admin" },
    { technicianId: "tech-002", role: "secondary", assignedAt: { toDate: () => new Date("2024-01-15") } as any, assignedBy: "admin" },
  ],
  booking: {
    preferredDate: { toDate: () => new Date("2024-01-20") } as any,
    preferredTime: "09:00 AM",
    urgency: "medium",
    specialInstructions: "Access via loading dock at rear of building. Contact site manager on arrival.",
  },
  quoteDetails: {
    items: [
      { id: "qi-1", type: "labor", description: "Windscreen chip repair", quantity: 1, unitPrice: 85, totalPrice: 85 },
      { id: "qi-2", type: "material", description: "Resin kit", quantity: 1, unitPrice: 45, totalPrice: 45 },
      { id: "qi-3", type: "labor", description: "Scratch removal - bonnet", quantity: 2, unitPrice: 120, totalPrice: 240 },
      { id: "qi-4", type: "material", description: "Polishing compound", quantity: 1, unitPrice: 35, totalPrice: 35 },
      { id: "qi-5", type: "labor", description: "Headlight lens restoration", quantity: 1, unitPrice: 180, totalPrice: 180 },
      { id: "qi-6", type: "material", description: "Lens restoration kit", quantity: 1, unitPrice: 95, totalPrice: 95 },
    ],
    subtotal: 680,
    gst: 68,
    total: 748,
    approvedAt: { toDate: () => new Date("2024-01-16") } as any,
    approvedBy: "John Smith",
  },
  statusLog: [
    { status: "pending", changedAt: { toDate: () => new Date("2024-01-14T09:00:00") } as any, changedBy: "System", notes: "Job created from booking request" },
    { status: "scheduled", changedAt: { toDate: () => new Date("2024-01-15T10:30:00") } as any, changedBy: "Sarah Admin", notes: "Technicians assigned, scheduled for Jan 20" },
    { status: "in_progress", changedAt: { toDate: () => new Date("2024-01-20T09:15:00") } as any, changedBy: "Mike Tech", notes: "Work commenced on site" },
  ],
  scheduledDate: { toDate: () => new Date("2024-01-20") } as any,
  createdAt: { toDate: () => new Date("2024-01-14") } as any,
  createdBy: "booking-system",
  updatedAt: { toDate: () => new Date("2024-01-20") } as any,
  notes: "Priority client - ensure quality checks are thorough. Previous work completed successfully in December.",
  siteLocation: {
    name: "Metro Fleet Depot - Alexandria",
    address: "42 Industrial Drive, Alexandria NSW 2015",
  },
};

const mockTechnicians = [
  { id: "tech-001", name: "Mike Thompson", phone: "0412 345 678", specialty: "Glass Repair" },
  { id: "tech-002", name: "James Wilson", phone: "0423 456 789", specialty: "Paint Correction" },
];

export default function JobDetailsPage() {
  const params = useParams();
  const jobId = params.id as string;
  const job = mockJob;

  const formatDate = (timestamp: any) => {
    if (!timestamp) return "N/A";
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  };

  const formatDateTime = (timestamp: any) => {
    if (!timestamp) return "N/A";
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Briefcase className="h-8 w-8 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">{job.jobNumber}</h1>
            <Badge className={statusColors[job.status]} variant="outline">
              {job.status.replace("_", " ").toUpperCase()}
            </Badge>
          </div>
          <p className="text-muted-foreground">{job.clientName}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <Edit className="mr-2 h-4 w-4" />
            Edit
          </Button>
          <Button variant="outline" size="sm">
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
          <Button variant="destructive" size="sm">
            <X className="mr-2 h-4 w-4" />
            Close
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4 lg:grid-cols-7 bg-muted/50">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="vehicles">Vehicles</TabsTrigger>
          <TabsTrigger value="damage">Damage</TabsTrigger>
          <TabsTrigger value="quote">Quote</TabsTrigger>
          <TabsTrigger value="team" className="hidden lg:inline-flex">Team</TabsTrigger>
          <TabsTrigger value="history" className="hidden lg:inline-flex">History</TabsTrigger>
          <TabsTrigger value="notes" className="hidden lg:inline-flex">Notes</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card className="bg-card/50 backdrop-blur">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Briefcase className="h-4 w-4 text-primary" />
                  Job Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Job Number</span>
                  <span className="font-medium">{job.jobNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <Badge className={statusColors[job.status]} variant="outline">
                    {job.status.replace("_", " ")}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Created</span>
                  <span className="font-medium">{formatDate(job.createdAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Vehicles</span>
                  <span className="font-medium">{job.vehicles.length}</span>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/50 backdrop-blur">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="h-4 w-4 text-primary" />
                  Client Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <span className="font-medium">{job.clientName}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Mail className="h-3.5 w-3.5" />
                  {job.clientEmail}
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Phone className="h-3.5 w-3.5" />
                  {job.clientPhone}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/50 backdrop-blur">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Calendar className="h-4 w-4 text-primary" />
                  Schedule
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Scheduled Date</span>
                  <span className="font-medium">{formatDate(job.scheduledDate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Time</span>
                  <span className="font-medium">{job.booking?.preferredTime || "TBD"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Urgency</span>
                  <Badge variant="outline" className="capitalize">{job.booking?.urgency || "normal"}</Badge>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="bg-card/50 backdrop-blur">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <MapPin className="h-4 w-4 text-primary" />
                Site Location
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                <p className="font-medium">{job.siteLocation?.name}</p>
                <p className="text-sm text-muted-foreground">{job.siteLocation?.address}</p>
                {job.booking?.specialInstructions && (
                  <p className="mt-3 text-sm text-muted-foreground border-l-2 border-primary/50 pl-3">
                    {job.booking.specialInstructions}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Vehicles Tab */}
        <TabsContent value="vehicles" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {job.vehicles.map((vehicle, index) => (
              <Card key={index} className="bg-card/50 backdrop-blur">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Car className="h-4 w-4 text-primary" />
                    {vehicle.registration}
                  </CardTitle>
                  <CardDescription>{vehicle.year} {vehicle.make} {vehicle.model}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Color</span>
                    <span>{vehicle.color || "N/A"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">VIN</span>
                    <span className="font-mono text-xs">{vehicle.vin || "N/A"}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Damage Report Tab */}
        <TabsContent value="damage" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {job.damage.map((item) => (
              <Card key={item.id} className="bg-card/50 backdrop-blur">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Camera className="h-4 w-4 text-primary" />
                      {item.location}
                    </CardTitle>
                    <Badge className={severityColors[item.severity]}>
                      {item.severity}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm">{item.description}</p>
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      {item.photoUrls.map((_, idx) => (
                        <div key={idx} className="h-16 w-16 rounded bg-muted flex items-center justify-center">
                          <Camera className="h-6 w-6 text-muted-foreground" />
                        </div>
                      ))}
                    </div>
                  </div>
                  {item.estimatedCost && (
                    <div className="flex justify-between pt-2 border-t border-border/50">
                      <span className="text-muted-foreground text-sm">Est. Cost</span>
                      <span className="font-medium">${item.estimatedCost.toFixed(2)}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Quote Tab */}
        <TabsContent value="quote" className="space-y-4">
          <Card className="bg-card/50 backdrop-blur">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-primary" />
                  Quote Details
                </CardTitle>
                {job.quoteDetails?.approvedAt && (
                  <Badge className="bg-green-500/20 text-green-400 border-green-500/30" variant="outline">
                    <CheckCircle className="mr-1 h-3 w-3" />
                    Approved
                  </Badge>
                )}
              </div>
              {job.quoteDetails?.approvedAt && (
                <CardDescription>
                  Approved by {job.quoteDetails.approvedBy} on {formatDate(job.quoteDetails.approvedAt)}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="rounded-lg border border-border/50">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border/50 bg-muted/30">
                        <th className="px-4 py-3 text-left text-sm font-medium">Description</th>
                        <th className="px-4 py-3 text-left text-sm font-medium">Type</th>
                        <th className="px-4 py-3 text-right text-sm font-medium">Qty</th>
                        <th className="px-4 py-3 text-right text-sm font-medium">Unit Price</th>
                        <th className="px-4 py-3 text-right text-sm font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {job.quoteDetails?.items.map((item) => (
                        <tr key={item.id} className="border-b border-border/30">
                          <td className="px-4 py-3 text-sm">{item.description}</td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className="capitalize">{item.type}</Badge>
                          </td>
                          <td className="px-4 py-3 text-right text-sm">{item.quantity}</td>
                          <td className="px-4 py-3 text-right text-sm">${item.unitPrice.toFixed(2)}</td>
                          <td className="px-4 py-3 text-right text-sm font-medium">${item.totalPrice.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end">
                  <div className="w-64 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span>${job.quoteDetails?.subtotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">GST (10%)</span>
                      <span>${job.quoteDetails?.gst.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between border-t border-border/50 pt-2">
                      <span className="font-medium">Total</span>
                      <span className="font-bold text-lg">${job.quoteDetails?.total.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Team Tab */}
        <TabsContent value="team" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {job.assignedTechnicians.map((assignment) => {
              const tech = mockTechnicians.find(t => t.id === assignment.technicianId);
              return (
                <Card key={assignment.technicianId} className="bg-card/50 backdrop-blur">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Wrench className="h-4 w-4 text-primary" />
                        {tech?.name || "Unknown Technician"}
                      </CardTitle>
                      <Badge variant="outline" className="capitalize">{assignment.role}</Badge>
                    </div>
                    <CardDescription>{tech?.specialty}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Phone className="h-3.5 w-3.5" />
                      {tech?.phone}
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Calendar className="h-3.5 w-3.5" />
                      Assigned: {formatDate(assignment.assignedAt)}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* Status History Tab */}
        <TabsContent value="history" className="space-y-4">
          <Card className="bg-card/50 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-primary" />
                Status History
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative space-y-4">
                {job.statusLog.map((entry, index) => (
                  <div key={index} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className={`h-3 w-3 rounded-full ${statusColors[entry.status].split(" ")[0]}`} />
                      {index < job.statusLog.length - 1 && (
                        <div className="w-px flex-1 bg-border/50 my-1" />
                      )}
                    </div>
                    <div className="flex-1 pb-4">
                      <div className="flex items-center gap-2">
                        <Badge className={statusColors[entry.status]} variant="outline">
                          {entry.status.replace("_", " ")}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{formatDateTime(entry.changedAt)}</span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">by {entry.changedBy}</p>
                      {entry.notes && (
                        <p className="text-sm mt-2 text-muted-foreground border-l-2 border-primary/30 pl-2">
                          {entry.notes}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notes Tab */}
        <TabsContent value="notes" className="space-y-4">
          <Card className="bg-card/50 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Job Notes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg bg-muted/30 p-4">
                <p className="text-sm">{job.notes || "No notes for this job."}</p>
              </div>
              <div className="mt-4">
                <Button variant="outline" size="sm">
                  <Edit className="mr-2 h-4 w-4" />
                  Add Note
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
