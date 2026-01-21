"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { useJobs } from "@/contexts/JobsContext";
import { useAuth } from "@/contexts/AuthContext";
import { asiStaff } from "@/lib/contacts-data";
import { buildFleetDocId, getFleetSeedForOrgName, normalizeVehicleKey } from "@/lib/fleet-data";
import { generateJobDescriptionAction } from "@/app/actions/ai";
import { useToast } from "@/hooks/use-toast";
import { db, storage } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/firestore";
import type {
  FleetVehicle,
  JobStatus,
  JobVehicle,
  RepairSite,
  RepairType,
  MicrofiberDiskUsage,
  MicrofiberDiskGrade,
  MicrofiberDiskSize,
  RepairWorkStatus,
} from "@/lib/types";
import {
  BOOKING_TYPE_LABELS,
  MICROFIBER_DISK_GRADES,
  MICROFIBER_DISK_SIZES,
  calculateCostBreakdown,
} from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Briefcase,
  Car,
  Camera,
  Plus,
  Trash2,
  ArrowLeft,
  ArrowRight,
  Phone,
  Mail,
  CheckCircle,
  Wrench,
  MapPin,
  Calendar,
  Users,
  DollarSign,
  Package,
  FileText,
  Building2,
  CircleDot,
  Pause,
  Clock,
  Upload,
} from "lucide-react";

const statusColors: Record<JobStatus, string> = {
  pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  scheduled: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  in_progress: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  completed: "bg-green-500/20 text-green-400 border-green-500/30",
  closed: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  cancelled: "bg-red-500/20 text-red-400 border-red-500/30",
};

const vehicleStatusColors = {
  pending: "bg-yellow-500/20 text-yellow-400",
  in_progress: "bg-purple-500/20 text-purple-400",
  completed: "bg-green-500/20 text-green-400",
  on_hold: "bg-red-500/20 text-red-400",
};

const repairStatusColors: Record<RepairWorkStatus, string> = {
  not_started: "bg-muted text-muted-foreground",
  in_progress: "bg-blue-500/20 text-blue-400",
  on_hold: "bg-amber-500/20 text-amber-400",
  completed: "bg-green-500/20 text-green-400",
};

const repairStatusLabels: Record<RepairWorkStatus, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  on_hold: "On Hold",
  completed: "Completed",
};

export default function JobCardPage() {
  const params = useParams();
  const router = useRouter();
  const {
    getJobById,
    updateJob,
    updateJobStatus,
    deleteJob,
    worksRegister,
    completeWorksRegisterEntry,
  } = useJobs();
  const { user } = useAuth();
  const { toast } = useToast();
  const jobId = params.id as string;

  const job = getJobById(jobId);

  // Local state for editing
  const [jobVehicles, setJobVehicles] = useState<JobVehicle[]>(job?.jobVehicles || []);
  const [showAddVehicleDialog, setShowAddVehicleDialog] = useState(false);
  const [showAddRepairDialog, setShowAddRepairDialog] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);

  // New vehicle form state
  const [newVehicle, setNewVehicle] = useState({
    registration: "",
    vin: "",
    fleetAssetNumber: "",
    bodyManufacturer: "",
    year: "",
    poWorksOrderNumber: "",
  });
  const [fleetVehicles, setFleetVehicles] = useState<FleetVehicle[]>([]);
  const [fleetSeeded, setFleetSeeded] = useState(false);

  // New repair site form state
  const [newRepair, setNewRepair] = useState({
    repairType: "" as RepairType | "",
    location: "",
    description: "",
    totalCost: "",
  });
  const [aiRequest, setAiRequest] = useState("");
  const [aiResult, setAiResult] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<{ url: string; label: string } | null>(
    null
  );
  const [uploadingPhotos, setUploadingPhotos] = useState<Record<string, boolean>>({});
  const [jobDescription, setJobDescription] = useState(() =>
    job?.jobDescription ?? extractAiDescription(job?.notes)
  );
  const [descriptionDirty, setDescriptionDirty] = useState(false);
  const [holdDialogOpen, setHoldDialogOpen] = useState(false);
  const [holdReason, setHoldReason] = useState("");
  const [holdTarget, setHoldTarget] = useState<{
    vehicleId: string;
    repairId: string;
  } | null>(null);
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState(job?.invoiceNumber ?? "");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [invoiceSentDate, setInvoiceSentDate] = useState("");

  const toDateValue = (value?: Timestamp | string | number | Date | null | undefined) => {
    if (!value) return null;
    if (value instanceof Timestamp) return value.toDate();
    const hasToDate = (value as { toDate?: () => Date }).toDate;
    if (typeof hasToDate === "function") return hasToDate.call(value);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const formatDate = (timestamp?: Timestamp | string | number | Date | null) => {
    const date = toDateValue(timestamp);
    if (!date) return "N/A";
    return date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  };
  const formatDateInput = (timestamp?: Timestamp | string | number | Date | null) => {
    const date = toDateValue(timestamp);
    if (!date) return "";
    return date.toISOString().split("T")[0];
  };
  const formatDateTime = (timestamp?: Timestamp | string | number | Date | null) => {
    const date = toDateValue(timestamp);
    if (!date) return "N/A";
    return date.toLocaleString("en-AU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  function extractAiDescription(notes?: string) {
    if (!notes) return "";
    const marker = "AI Job Description:";
    const index = notes.indexOf(marker);
    if (index === -1) return "";
    return notes.slice(index + marker.length).trim();
  }

  function upsertAiDescription(notes: string, description: string) {
    const trimmedNotes = notes.trim();
    const marker = "AI Job Description:";
    if (!description) {
      if (!trimmedNotes) return "";
      if (!trimmedNotes.includes(marker)) return notes;
      const before = trimmedNotes.split(marker)[0].trimEnd();
      return before;
    }
    if (!trimmedNotes) {
      return `${marker}\n${description}`.trim();
    }
    if (trimmedNotes.includes(marker)) {
      const before = trimmedNotes.split(marker)[0].trimEnd();
      return `${before}\n\n${marker}\n${description}`.trim();
    }
    return `${trimmedNotes}\n\n${marker}\n${description}`.trim();
  }

  useEffect(() => {
    if (!job || descriptionDirty) return;
    const nextDescription = job.jobDescription ?? extractAiDescription(job.notes);
    setJobDescription(nextDescription);
  }, [job, descriptionDirty]);

  useEffect(() => {
    if (!job) return;
    setInvoiceNumber(job.invoiceNumber ?? "");
    setInvoiceDate(formatDateInput(job.invoiceDate));
    setInvoiceSentDate(formatDateInput(job.invoiceSentAt));
  }, [job]);

  useEffect(() => {
    setFleetSeeded(false);
  }, [job?.organizationId]);

  useEffect(() => {
    if (!job?.organizationId) {
      setFleetVehicles([]);
      return;
    }
    const fleetQuery = query(
      collection(db, COLLECTIONS.FLEET_VEHICLES),
      where("organizationId", "==", job.organizationId)
    );
    const unsubscribe = onSnapshot(fleetQuery, (snapshot) => {
      const loaded = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<FleetVehicle, "id">),
      }));
      setFleetVehicles(loaded);
    });
    return () => unsubscribe();
  }, [job?.organizationId]);

  useEffect(() => {
    const clientName = job?.clientName ?? "";
    const organizationId = job?.organizationId ?? "";
    if (!organizationId || !clientName) return;
    if (fleetVehicles.length > 0 || fleetSeeded) return;
    const seeds = getFleetSeedForOrgName(clientName);
    if (seeds.length === 0) {
      setFleetSeeded(true);
      return;
    }
    let cancelled = false;
    const seedFleet = async () => {
      try {
        const now = Timestamp.now();
        await Promise.all(
          seeds.map((vehicle) => {
            const docId = buildFleetDocId(organizationId, vehicle.registration);
            const docRef = doc(db, COLLECTIONS.FLEET_VEHICLES, docId);
            return setDoc(
              docRef,
              {
                organizationId,
                registration: vehicle.registration.toUpperCase(),
                vin: vehicle.vin?.toUpperCase(),
                fleetAssetNumber: vehicle.fleetAssetNumber,
                bodyManufacturer: vehicle.bodyManufacturer,
                year: vehicle.year,
                createdAt: now,
                updatedAt: now,
              },
              { merge: true }
            );
          })
        );
      } catch (error) {
        console.warn("Failed to seed fleet vehicles:", error);
      } finally {
        if (!cancelled) setFleetSeeded(true);
      }
    };
    void seedFleet();
    return () => {
      cancelled = true;
    };
  }, [job?.organizationId, job?.clientName, fleetSeeded, fleetVehicles.length]);

  // Calculate totals
  const jobTotals = useMemo(() => {
    let totalCost = 0;
    let totalLabour = 0;
    let totalMaterials = 0;

    jobVehicles.forEach((vehicle) => {
      vehicle.repairSites.forEach((repair) => {
        totalCost += repair.totalCost;
        totalLabour += repair.labourCost;
        totalMaterials += repair.materialsCost;
      });
    });

    return { totalCost, totalLabour, totalMaterials };
  }, [jobVehicles]);

  const fleetByRegistration = useMemo(() => {
    const map = new Map<string, FleetVehicle>();
    fleetVehicles.forEach((vehicle) => {
      map.set(normalizeVehicleKey(vehicle.registration), vehicle);
    });
    return map;
  }, [fleetVehicles]);

  const fleetByAssetNumber = useMemo(() => {
    const map = new Map<string, FleetVehicle>();
    fleetVehicles.forEach((vehicle) => {
      if (vehicle.fleetAssetNumber) {
        map.set(normalizeVehicleKey(vehicle.fleetAssetNumber), vehicle);
      }
    });
    return map;
  }, [fleetVehicles]);

  const handleFleetLookup = () => {
    const regoKey = normalizeVehicleKey(newVehicle.registration);
    const fleetKey = normalizeVehicleKey(newVehicle.fleetAssetNumber);
    const match =
      (fleetKey && fleetByAssetNumber.get(fleetKey)) ||
      (regoKey && fleetByRegistration.get(regoKey));
    const seedMatch = !match
      ? getFleetSeedForOrgName(job?.clientName ?? "").find((vehicle) => {
          const seedRego = normalizeVehicleKey(vehicle.registration);
          const seedFleet = normalizeVehicleKey(vehicle.fleetAssetNumber);
          return (fleetKey && seedFleet === fleetKey) || (regoKey && seedRego === regoKey);
        })
      : null;
    const resolvedMatch = match ?? seedMatch ?? null;
    if (!resolvedMatch) {
      toast({
        title: "Vehicle not found",
        description: "No fleet vehicle matched the registration or fleet number.",
        variant: "destructive",
      });
      return;
    }
    setNewVehicle((prev) => ({
      ...prev,
      registration: resolvedMatch.registration || prev.registration,
      vin: resolvedMatch.vin ?? prev.vin,
      fleetAssetNumber: resolvedMatch.fleetAssetNumber ?? prev.fleetAssetNumber,
      bodyManufacturer: resolvedMatch.bodyManufacturer ?? prev.bodyManufacturer,
      year: resolvedMatch.year ? String(resolvedMatch.year) : prev.year,
    }));
  };

  const lookupRegoKey = normalizeVehicleKey(newVehicle.registration);
  const lookupFleetKey = normalizeVehicleKey(newVehicle.fleetAssetNumber);
  const canLookupFleet = lookupRegoKey.length >= 5 || lookupFleetKey.length >= 1;

  if (!job) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <Briefcase className="h-16 w-16 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Job Not Found</h2>
        <p className="text-muted-foreground">The requested job could not be found.</p>
        <Button onClick={() => router.push("/dashboard/job-lifecycle")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Job Lifecycle
        </Button>
      </div>
    );
  }

  // Parse job notes for service type
  const notesLines = job.notes?.split("\n") || [];
  const serviceType = notesLines[0]?.replace("Service: ", "") || "Not specified";

  // Get technician details
  const assignedTechs = job.assignedTechnicians.map((assignment) => {
    const staff = asiStaff.find((s) => s.id === assignment.technicianId);
    return {
      ...assignment,
      name: assignment.technicianName || staff?.name || assignment.technicianId,
    };
  });

  const getRepairStatus = (repair: RepairSite): RepairWorkStatus => {
    if (repair.workStatus) return repair.workStatus;
    return repair.isCompleted ? "completed" : "not_started";
  };

  const updateJobVehiclesState = async (updatedVehicles: JobVehicle[]) => {
    setJobVehicles(updatedVehicles);
    await updateJob(job.id, { jobVehicles: updatedVehicles });
  };

  const queueNotification = async (
    userId: string,
    title: string,
    message: string,
    type: "job_started" | "job_on_hold" | "job_completed"
  ) => {
    await addDoc(collection(db, COLLECTIONS.NOTIFICATIONS), {
      userId,
      type,
      title,
      message,
      read: false,
      relatedEntityId: job.id,
      relatedEntityType: "job",
      createdAt: Timestamp.now(),
    });
  };

  const queueEmail = async (recipientEmail: string, subject: string, text: string) => {
    await addDoc(collection(db, COLLECTIONS.MAIL), {
      to: [recipientEmail],
      message: {
        subject,
        text,
      },
    });
  };

  const notifyClients = async (
    type: "job_started" | "job_on_hold" | "job_completed",
    title: string,
    message: string,
    subject: string
  ) => {
    try {
      if (!job.organizationId) {
        if (job.clientEmail) {
          await queueEmail(job.clientEmail, subject, message);
        }
        return;
      }
      const usersRef = collection(db, COLLECTIONS.USERS);
      const clientQuery = query(
        usersRef,
        where("organizationId", "==", job.organizationId),
        where("role", "==", "client")
      );
      const snapshot = await getDocs(clientQuery);
      if (snapshot.empty && job.clientEmail) {
        await queueEmail(job.clientEmail, subject, message);
        return;
      }
      await Promise.all(
        snapshot.docs.map(async (docSnap) => {
          const data = docSnap.data() as { email?: string };
          await queueNotification(docSnap.id, title, message, type);
          if (data.email) {
            await queueEmail(data.email, subject, message);
          }
        })
      );
    } catch (error) {
      console.warn("Failed to notify clients:", error);
    }
  };

  const notifyAdmins = async (
    title: string,
    message: string,
    subject?: string,
    type: "job_started" | "job_on_hold" | "job_completed" = "job_completed",
    sendEmail = true
  ) => {
    try {
      const usersRef = collection(db, COLLECTIONS.USERS);
      const adminQuery = query(usersRef, where("role", "==", "admin"));
      const snapshot = await getDocs(adminQuery);
      await Promise.all(
        snapshot.docs.map(async (docSnap) => {
          const data = docSnap.data() as { email?: string };
          await queueNotification(docSnap.id, title, message, type);
          if (sendEmail && subject && data.email) {
            await queueEmail(data.email, subject, message);
          }
        })
      );
    } catch (error) {
      console.warn("Failed to notify admins:", error);
    }
  };

  const completeJobFlow = async (note: string) => {
    const changedBy = user?.name || user?.email || user?.uid || "System";
    await updateJob(job.id, {
      jobVehicles,
      totalJobCost: jobTotals.totalCost,
      totalLabourCost: jobTotals.totalLabour,
      totalMaterialsCost: jobTotals.totalMaterials,
    });
    await updateJobStatus(job.id, "completed", changedBy, note);
    const worksEntry = worksRegister.find((entry) => entry.jobId === job.id);
    if (worksEntry && !worksEntry.completionDate) {
      await completeWorksRegisterEntry(worksEntry.id, changedBy);
    }
    await notifyAdmins(
      `Job ${job.jobNumber} completed`,
      `${job.jobNumber} for ${job.clientName} is complete and ready for review/invoicing.`,
      `Job completed: ${job.jobNumber}`,
      "job_completed",
      true
    );
    await notifyClients(
      "job_completed",
      `Job ${job.jobNumber} completed`,
      `Your job ${job.jobNumber} with ASI is complete. We'll be in touch shortly.`,
      `ASI Job Complete: ${job.jobNumber}`
    );
  };

  const getRepairCompletionState = (vehicles: JobVehicle[]) => {
    const repairs = vehicles.flatMap((vehicle) => vehicle.repairSites);
    const allCompleted =
      repairs.length > 0 &&
      repairs.every((repair) => getRepairStatus(repair) === "completed");
    return { repairs, allCompleted };
  };

  const handleSaveChanges = async () => {
    const { allCompleted } = getRepairCompletionState(jobVehicles);

    if (allCompleted && job.status !== "completed" && job.status !== "closed") {
      await completeJobFlow("All repair sites completed");
      toast({
        title: "Job Completed",
        description: "Notifications have been sent to the client and admins.",
      });
      router.push("/dashboard/bookings");
      return;
    }

    await updateJob(job.id, {
      jobVehicles,
      totalJobCost: jobTotals.totalCost,
      totalLabourCost: jobTotals.totalLabour,
      totalMaterialsCost: jobTotals.totalMaterials,
    });
    toast({
      title: "Changes Saved",
      description: "Job card updates have been saved.",
    });
  };

  const parseDateInput = (value: string) => {
    if (!value) return undefined;
    return Timestamp.fromDate(new Date(`${value}T00:00:00`));
  };

  const handleSaveInvoiceDetails = async () => {
    await updateJob(job.id, {
      invoiceNumber: invoiceNumber.trim() || undefined,
      invoiceDate: parseDateInput(invoiceDate),
      invoiceSentAt: parseDateInput(invoiceSentDate),
    });
    toast({
      title: "Invoicing Details Saved",
      description: "Invoice information has been updated.",
    });
  };

  const handleManagementCloseOff = async () => {
    if (job.status !== "completed" && job.status !== "closed") {
      toast({
        title: "Job Not Completed",
        description: "Complete the job before closing it off for invoicing.",
        variant: "destructive",
      });
      return;
    }
    if (!invoiceNumber.trim() || !invoiceDate) {
      toast({
        title: "Missing Invoice Details",
        description: "Add the invoice number and invoice date to close this job.",
        variant: "destructive",
      });
      return;
    }
    const changedBy = user?.name || user?.email || user?.uid || "System";
    const now = Timestamp.now();
    await updateJob(job.id, {
      invoiceNumber: invoiceNumber.trim(),
      invoiceDate: parseDateInput(invoiceDate),
      invoiceSentAt: parseDateInput(invoiceSentDate) ?? now,
      managementApprovedAt: job.managementApprovedAt ?? now,
      managementApprovedBy: job.managementApprovedBy ?? changedBy,
      closedAt: now,
      closedBy: changedBy,
    });
    await updateJobStatus(job.id, "closed", changedBy, "Management close-off completed");
    toast({
      title: "Job Closed",
      description: "The job has been marked as closed after invoicing.",
    });
  };

  // Add new vehicle
  const handleAddVehicle = () => {
    if (!newVehicle.registration.trim()) {
      return;
    }

    const vehicle: JobVehicle = {
      id: `vehicle-${Date.now()}`,
      registration: newVehicle.registration.trim().toUpperCase(),
      vin: newVehicle.vin.trim().toUpperCase() || undefined,
      fleetAssetNumber: newVehicle.fleetAssetNumber.trim() || undefined,
      bodyManufacturer: newVehicle.bodyManufacturer.trim() || undefined,
      year: newVehicle.year ? parseInt(newVehicle.year, 10) : undefined,
      poWorksOrderNumber: newVehicle.poWorksOrderNumber.trim() || undefined,
      repairSites: [],
      microfiberDisksUsed: [],
      status: "pending",
      totalCost: 0,
      totalLabourCost: 0,
      totalMaterialsCost: 0,
    };

    setJobVehicles([...jobVehicles, vehicle]);
    setNewVehicle({
      registration: "",
      vin: "",
      fleetAssetNumber: "",
      bodyManufacturer: "",
      year: "",
      poWorksOrderNumber: "",
    });
    setShowAddVehicleDialog(false);
  };

  // Add repair site to vehicle
  const handleAddRepairSite = () => {
    if (!selectedVehicleId || !newRepair.repairType || !newRepair.location) return;

    const cost = parseFloat(newRepair.totalCost) || 0;
    const { labourCost, materialsCost } = calculateCostBreakdown(cost);

    const repairSite: RepairSite = {
      id: `repair-${Date.now()}`,
      repairType: newRepair.repairType as RepairType,
      location: newRepair.location,
      description: newRepair.description || undefined,
      preWorkPhotos: [],
      postWorkPhotos: [],
      totalCost: cost,
      labourCost,
      materialsCost,
      isCompleted: false,
      workStatus: "not_started",
      workLog: [],
    };

    setJobVehicles(
      jobVehicles.map((v) =>
        v.id === selectedVehicleId
          ? {
              ...v,
              repairSites: [...v.repairSites, repairSite],
              totalCost: v.totalCost + cost,
              totalLabourCost: v.totalLabourCost + labourCost,
              totalMaterialsCost: v.totalMaterialsCost + materialsCost,
            }
          : v
      )
    );

    setNewRepair({ repairType: "", location: "", description: "", totalCost: "" });
    setShowAddRepairDialog(false);
  };

  // Update repair site cost
  const handleUpdateRepairCost = (vehicleId: string, repairId: string, newCost: number) => {
    const { labourCost, materialsCost } = calculateCostBreakdown(newCost);

    setJobVehicles(
      jobVehicles.map((v) => {
        if (v.id !== vehicleId) return v;

        const updatedRepairs = v.repairSites.map((r) =>
          r.id === repairId ? { ...r, totalCost: newCost, labourCost, materialsCost } : r
        );

        const vehicleTotals = updatedRepairs.reduce(
          (acc, r) => ({
            totalCost: acc.totalCost + r.totalCost,
            totalLabour: acc.totalLabour + r.labourCost,
            totalMaterials: acc.totalMaterials + r.materialsCost,
          }),
          { totalCost: 0, totalLabour: 0, totalMaterials: 0 }
        );

        return {
          ...v,
          repairSites: updatedRepairs,
          totalCost: vehicleTotals.totalCost,
          totalLabourCost: vehicleTotals.totalLabour,
          totalMaterialsCost: vehicleTotals.totalMaterials,
        };
      })
    );
  };

  // Update microfiber disk usage
  const handleUpdateMicrofiberUsage = (
    vehicleId: string,
    grade: MicrofiberDiskGrade,
    size: MicrofiberDiskSize,
    quantity: number
  ) => {
    setJobVehicles(
      jobVehicles.map((v) => {
        if (v.id !== vehicleId) return v;

        const existingIndex = v.microfiberDisksUsed.findIndex(
          (d) => d.grade === grade && d.size === size
        );

        let updatedDisks: MicrofiberDiskUsage[];
        if (existingIndex >= 0) {
          if (quantity === 0) {
            updatedDisks = v.microfiberDisksUsed.filter((_, i) => i !== existingIndex);
          } else {
            updatedDisks = v.microfiberDisksUsed.map((d, i) =>
              i === existingIndex ? { ...d, quantity } : d
            );
          }
        } else if (quantity > 0) {
          updatedDisks = [...v.microfiberDisksUsed, { grade, size, quantity }];
        } else {
          updatedDisks = v.microfiberDisksUsed;
        }

        return { ...v, microfiberDisksUsed: updatedDisks };
      })
    );
  };

  // Update vehicle status
  const handleUpdateVehicleStatus = (
    vehicleId: string,
    status: JobVehicle["status"],
    holdReason?: string
  ) => {
    setJobVehicles(
      jobVehicles.map((v) =>
        v.id === vehicleId ? { ...v, status, holdReason: status === "on_hold" ? holdReason : undefined } : v
      )
    );
  };

  const handleRepairAction = async (
    vehicleId: string,
    repairId: string,
    action: "start" | "hold" | "resume" | "complete",
    note?: string
  ) => {
    const now = Timestamp.now();
    const changedBy = user?.name || user?.email || user?.uid || "System";
    const actionToStatus: Record<"start" | "hold" | "resume" | "complete", RepairWorkStatus> = {
      start: "in_progress",
      hold: "on_hold",
      resume: "in_progress",
      complete: "completed",
    };
    const actionToLogStatus: Record<
      "start" | "hold" | "resume" | "complete",
      "started" | "held" | "resumed" | "completed"
    > = {
      start: "started",
      hold: "held",
      resume: "resumed",
      complete: "completed",
    };

    const updatedVehicles = jobVehicles.map((v) => {
      if (v.id !== vehicleId) return v;
      const updatedRepairs = v.repairSites.map((repair) => {
        if (repair.id !== repairId) return repair;
        const workLog = [
          ...(repair.workLog || []),
          {
            status: actionToLogStatus[action],
            at: now,
            by: changedBy,
            note: note?.trim() || undefined,
          },
        ];
        const nextStatus = actionToStatus[action];
        const isCompleted = nextStatus === "completed";
        return {
          ...repair,
          workStatus: nextStatus,
          workLog,
          isCompleted,
          completedAt: isCompleted ? now : repair.completedAt,
          completedBy: isCompleted ? changedBy : repair.completedBy,
          holdReason: action === "hold" ? note || repair.holdReason : repair.holdReason,
        };
      });
      return { ...v, repairSites: updatedRepairs };
    });

    await updateJobVehiclesState(updatedVehicles);

    const allRepairs = updatedVehicles.flatMap((vehicle) => vehicle.repairSites);
    if (allRepairs.length > 0) {
      const allCompleted = allRepairs.every((repair) => getRepairStatus(repair) === "completed");
      const anyActive = allRepairs.some((repair) => {
        const status = getRepairStatus(repair);
        return status === "in_progress" || status === "on_hold";
      });

      if (anyActive && (job.status === "scheduled" || job.status === "pending")) {
        await updateJobStatus(job.id, "in_progress", changedBy, "Repair work started");
        if (action === "start") {
          await notifyClients(
            "job_started",
            `Job ${job.jobNumber} started`,
            `Our technician has started work on job ${job.jobNumber}.`,
            `ASI Job Started: ${job.jobNumber}`
          );
          await notifyAdmins(
            `Job ${job.jobNumber} started`,
            `${job.jobNumber} for ${job.clientName} has started.`,
            undefined,
            "job_started",
            false
          );
        }
      }
      if (action === "hold") {
        await notifyClients(
          "job_on_hold",
          `Job ${job.jobNumber} on hold`,
          `Job ${job.jobNumber} is on hold. Reason: ${note || "Awaiting update"}.`,
          `ASI Job On Hold: ${job.jobNumber}`
        );
        await notifyAdmins(
          `Job ${job.jobNumber} on hold`,
          `${job.jobNumber} for ${job.clientName} is on hold. Reason: ${note || "Awaiting update"}.`,
          undefined,
          "job_on_hold",
          false
        );
      }
    }
  };

  const handleRepairPhotoUpload = async (
    vehicleId: string,
    repairId: string,
    kind: "pre" | "post",
    files: FileList | null
  ) => {
    if (!files || files.length === 0) return;
    const key = `${vehicleId}-${repairId}-${kind}`;
    setUploadingPhotos((prev) => ({ ...prev, [key]: true }));

    try {
      const uploadedUrls = await Promise.all(
        Array.from(files).map(async (file) => {
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
          const path = `jobs/${job.id}/vehicles/${vehicleId}/repairs/${repairId}/${kind}/${Date.now()}-${safeName}`;
          const fileRef = ref(storage, path);
          await uploadBytes(fileRef, file, { contentType: file.type });
          return getDownloadURL(fileRef);
        })
      );

      const updatedVehicles = jobVehicles.map((vehicle) => {
        if (vehicle.id !== vehicleId) return vehicle;
        const updatedRepairs = vehicle.repairSites.map((repair) => {
          if (repair.id !== repairId) return repair;
          const existing =
            kind === "pre" ? repair.preWorkPhotos ?? [] : repair.postWorkPhotos ?? [];
          const nextPhotos = [...existing, ...uploadedUrls];
          return kind === "pre"
            ? { ...repair, preWorkPhotos: nextPhotos }
            : { ...repair, postWorkPhotos: nextPhotos };
        });
        return { ...vehicle, repairSites: updatedRepairs };
      });

      await updateJobVehiclesState(updatedVehicles);
    } catch (error: any) {
      toast({
        title: "Upload Failed",
        description: error.message || "Unable to upload photos. Please try again.",
        variant: "destructive",
      });
    } finally {
      setUploadingPhotos((prev) => ({ ...prev, [key]: false }));
    }
  };

  // Delete vehicle
  const handleDeleteVehicle = (vehicleId: string) => {
    setJobVehicles(jobVehicles.filter((v) => v.id !== vehicleId));
  };

  // Delete repair site
  const handleDeleteRepair = (vehicleId: string, repairId: string) => {
    setJobVehicles(
      jobVehicles.map((v) => {
        if (v.id !== vehicleId) return v;
        const updatedRepairs = v.repairSites.filter((r) => r.id !== repairId);
        const vehicleTotals = updatedRepairs.reduce(
          (acc, r) => ({
            totalCost: acc.totalCost + r.totalCost,
            totalLabour: acc.totalLabour + r.labourCost,
            totalMaterials: acc.totalMaterials + r.materialsCost,
          }),
          { totalCost: 0, totalLabour: 0, totalMaterials: 0 }
        );
        return {
          ...v,
          repairSites: updatedRepairs,
          totalCost: vehicleTotals.totalCost,
          totalLabourCost: vehicleTotals.totalLabour,
          totalMaterialsCost: vehicleTotals.totalMaterials,
        };
      })
    );
  };

  // Check if any vehicle has scratch/graffiti repair
  const vehicleHasScratchGraffitiRepair = (vehicle: JobVehicle) => {
    return vehicle.repairSites.some((r) => r.repairType === "scratch_graffiti_removal");
  };

  // Get microfiber disk quantity
  const getMicrofiberQuantity = (
    vehicle: JobVehicle,
    grade: MicrofiberDiskGrade,
    size: MicrofiberDiskSize
  ) => {
    return vehicle.microfiberDisksUsed.find((d) => d.grade === grade && d.size === size)?.quantity || 0;
  };

  const handleGenerateJobDescription = async () => {
    if (!aiRequest.trim()) {
      toast({
        title: "Add a Request",
        description: "Enter a short client request before generating a description.",
        variant: "destructive",
      });
      return;
    }

    setAiLoading(true);
    try {
      const description = await generateJobDescriptionAction(aiRequest.trim());
      setAiResult(description);
    } catch (error: any) {
      toast({
        title: "Generation Failed",
        description: error.message || "Unable to generate a job description.",
        variant: "destructive",
      });
    } finally {
      setAiLoading(false);
    }
  };

  const handleApplyJobDescription = async () => {
    if (!aiResult.trim()) return;
    const description = aiResult.trim();
    const updatedNotes = upsertAiDescription(job.notes || "", description);
    await updateJob(job.id, { jobDescription: description, notes: updatedNotes });
    setJobDescription(description);
    setDescriptionDirty(false);
    toast({
      title: "Job Notes Updated",
      description: "The AI description has been added to the job notes.",
    });
  };

  const handleSaveJobDescription = async () => {
    const description = jobDescription.trim();
    const updatedNotes = upsertAiDescription(job.notes || "", description);
    await updateJob(job.id, {
      jobDescription: description || undefined,
      notes: updatedNotes,
    });
    setDescriptionDirty(false);
    toast({
      title: "Job Description Saved",
      description: "The job description has been updated.",
    });
  };

  const handleDeleteJob = async () => {
    await deleteJob(job.id, user?.uid || "system");
    toast({
      title: "Job Moved to Recycle Bin",
      description: "The job has been removed from active lists.",
    });
    router.push("/dashboard/job-lifecycle");
  };

  const completionState = getRepairCompletionState(jobVehicles);
  const readyToCloseJob =
    completionState.allCompleted && job.status !== "completed" && job.status !== "closed";
  const canManageCloseOff = user?.role === "admin";
  const isClosed = job.status === "closed";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Button variant="ghost" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Button>
          <Separator orientation="vertical" className="h-4" />
          <span>ISO 9001:2015 Compliant Job Card</span>
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <Briefcase className="h-8 w-8 text-primary" />
              <h1 className="text-2xl font-bold tracking-tight">{job.jobNumber}</h1>
              <Badge className={statusColors[job.status]} variant="outline">
                {job.status.replace("_", " ").toUpperCase()}
              </Badge>
            </div>
            <p className="text-muted-foreground">
              {job.clientName} • {serviceType}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={handleSaveChanges}
              className={readyToCloseJob ? "bg-emerald-600 hover:bg-emerald-700" : undefined}
            >
              <CheckCircle className="mr-2 h-4 w-4" />
              {readyToCloseJob ? "Save & Close Job" : "Save Changes"}
            </Button>
            <Dialog open={showCompleteDialog} onOpenChange={setShowCompleteDialog}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  disabled={!readyToCloseJob}
                >
                  Mark Job Complete
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Mark Job as Complete?</DialogTitle>
                  <DialogDescription>
                    This will notify the client and alert admins to review and invoice the job.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowCompleteDialog(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={async () => {
                      await completeJobFlow("Marked complete by technician");
                      setShowCompleteDialog(false);
                      router.push("/dashboard/bookings");
                    }}
                  >
                    Confirm Complete
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
              <DialogTrigger asChild>
                <Button variant="destructive">
                  Move to Recycle Bin
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Move Job to Recycle Bin?</DialogTitle>
                  <DialogDescription>
                    This removes the job from active lists. You can restore it later if needed.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
                    Cancel
                  </Button>
                  <Button variant="destructive" onClick={handleDeleteJob}>
                    Move to Recycle Bin
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="vehicles" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 lg:grid-cols-5 bg-muted/50">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="vehicles">Vehicles & Repairs</TabsTrigger>
          <TabsTrigger value="summary">Job Summary</TabsTrigger>
          <TabsTrigger value="team" className="hidden lg:inline-flex">
            Team
          </TabsTrigger>
          <TabsTrigger value="history" className="hidden lg:inline-flex">
            History
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card className="bg-card/50 backdrop-blur">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="h-4 w-4 text-primary" />
                  Job Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Job Number</span>
                  <span className="font-mono font-medium">{job.jobNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <Badge className={statusColors[job.status]} variant="outline">
                    {job.status.replace("_", " ")}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Service Type</span>
                  <span>{serviceType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Scheduled</span>
                  <span>{formatDate(job.scheduledDate)}</span>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/50 backdrop-blur">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Building2 className="h-4 w-4 text-primary" />
                  Customer
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="font-medium">{job.clientName}</p>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Mail className="h-3.5 w-3.5" />
                  {job.clientEmail}
                </div>
                {job.clientPhone && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="h-3.5 w-3.5" />
                    {job.clientPhone}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card/50 backdrop-blur">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <MapPin className="h-4 w-4 text-primary" />
                  Location
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {job.siteLocation && (
                  <>
                    <p className="font-medium">{job.siteLocation.name}</p>
                    <p className="text-muted-foreground">{job.siteLocation.address}</p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="bg-card/50 backdrop-blur">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4 text-primary" />
                AI Job Description
              </CardTitle>
              <CardDescription>
                Generate a detailed description from a short client request.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ai-request">Client Request</Label>
                <Textarea
                  id="ai-request"
                  placeholder="e.g., Remove graffiti from two buses and restore trim..."
                  value={aiRequest}
                  onChange={(e) => setAiRequest(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={handleGenerateJobDescription} disabled={aiLoading}>
                  {aiLoading ? "Generating..." : "Generate Description"}
                </Button>
                {aiResult && (
                  <Button variant="outline" onClick={handleApplyJobDescription}>
                    Add to Job Notes
                  </Button>
                )}
              </div>
              {aiResult && (
                <div className="space-y-2">
                  <Label>Generated Description</Label>
                  <Textarea value={aiResult} readOnly rows={6} />
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-card/50 backdrop-blur">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4 text-primary" />
                Job Description
              </CardTitle>
              <CardDescription>
                Editable summary shown on the job overview.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={jobDescription}
                onChange={(e) => {
                  setJobDescription(e.target.value);
                  setDescriptionDirty(true);
                }}
                placeholder="Add a clear job description for this work order..."
                rows={5}
              />
              <div className="flex items-center gap-2">
                <Button onClick={handleSaveJobDescription} disabled={!descriptionDirty}>
                  Save Description
                </Button>
                {!descriptionDirty && (
                  <span className="text-xs text-muted-foreground">
                    Description is up to date.
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Vehicles & Repairs Tab */}
        <TabsContent value="vehicles" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium">Vehicles & Repair Sites</h3>
              <p className="text-sm text-muted-foreground">
                Add vehicles and document repair work performed
              </p>
            </div>
            <Button onClick={() => setShowAddVehicleDialog(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Vehicle
            </Button>
          </div>

          {jobVehicles.length === 0 ? (
            <Card className="bg-card/50 backdrop-blur">
              <CardContent className="py-12 text-center">
                <Car className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium mb-2">No Vehicles Added</h3>
                <p className="text-muted-foreground mb-4">
                  Add vehicles to document repair work
                </p>
                <Button onClick={() => setShowAddVehicleDialog(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add First Vehicle
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Accordion type="multiple" className="space-y-4">
              {jobVehicles.map((vehicle, vehicleIndex) => (
                <AccordionItem
                  key={vehicle.id}
                  value={vehicle.id}
                  className="bg-card/50 backdrop-blur rounded-lg border px-4"
                >
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-4 w-full">
                      <div className="flex items-center gap-2">
                        <Car className="h-5 w-5 text-primary" />
                        <span className="font-mono font-medium">
                          {vehicle.registration || vehicle.vin || "Vehicle"}
                        </span>
                      </div>
                      <Badge className={vehicleStatusColors[vehicle.status]}>
                        {vehicle.status === "on_hold" ? "On Hold" : vehicle.status.replace("_", " ")}
                      </Badge>
                      {vehicle.poWorksOrderNumber && (
                        <Badge variant="outline">PO: {vehicle.poWorksOrderNumber}</Badge>
                      )}
                      <span className="text-sm text-muted-foreground ml-auto mr-4">
                        {vehicle.repairSites.length} repair(s) • ${vehicle.totalCost.toFixed(2)}
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pt-4 space-y-6">
                    {/* Vehicle Details */}
                    <div className="grid gap-4 md:grid-cols-5 p-4 bg-muted/30 rounded-lg">
                      <div>
                        <Label className="text-xs text-muted-foreground">Registration</Label>
                        <p className="font-medium">{vehicle.registration || "-"}</p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Fleet/Asset #</Label>
                        <p className="font-medium">{vehicle.fleetAssetNumber || "-"}</p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Body Manufacturer</Label>
                        <p className="font-medium">{vehicle.bodyManufacturer || "-"}</p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Year</Label>
                        <p className="font-medium">{vehicle.year || "-"}</p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">PO/Works Order</Label>
                        <p className="font-medium">{vehicle.poWorksOrderNumber || "-"}</p>
                      </div>
                    </div>

                    {/* Repair Sites */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">Repair Sites</Label>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedVehicleId(vehicle.id);
                            setShowAddRepairDialog(true);
                          }}
                        >
                          <Plus className="mr-1 h-3 w-3" />
                          Add Repair
                        </Button>
                      </div>

                      {vehicle.repairSites.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">
                          No repair sites added yet
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {vehicle.repairSites.map((repair) => {
                            const repairStatus = getRepairStatus(repair);
                            const preKey = `${vehicle.id}-${repair.id}-pre`;
                            const postKey = `${vehicle.id}-${repair.id}-post`;
                            const preCameraId = `${preKey}-camera`;
                            const preUploadId = `${preKey}-upload`;
                            const postCameraId = `${postKey}-camera`;
                            const postUploadId = `${postKey}-upload`;
                            const preUploading = uploadingPhotos[preKey];
                            const postUploading = uploadingPhotos[postKey];
                            const prePhotos = repair.preWorkPhotos ?? [];
                            const postPhotos = repair.postWorkPhotos ?? [];
                            return (
                              <Card key={repair.id} className="bg-muted/20">
                                <CardContent className="p-4 space-y-4">
                                  <div className="flex items-start justify-between">
                                    <div>
                                      <Badge variant="outline" className="mb-2">
                                        {BOOKING_TYPE_LABELS[repair.repairType]}
                                      </Badge>
                                      <p className="font-medium">{repair.location}</p>
                                      {repair.description && (
                                        <p className="text-sm text-muted-foreground">
                                          {repair.description}
                                        </p>
                                      )}
                                    </div>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="text-destructive"
                                      onClick={() => handleDeleteRepair(vehicle.id, repair.id)}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>

                                  {/* Work Status */}
                                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/50 px-3 py-2">
                                    <div className="flex items-center gap-2">
                                      <Badge className={repairStatusColors[repairStatus]} variant="outline">
                                        {repairStatusLabels[repairStatus]}
                                      </Badge>
                                      {repair.workLog && repair.workLog.length > 0 && (
                                        <span className="text-xs text-muted-foreground">
                                          Last update {formatDateTime(repair.workLog[repair.workLog.length - 1].at)}
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                      {repairStatus === "not_started" && (
                                        <Button size="sm" onClick={() => handleRepairAction(vehicle.id, repair.id, "start")}>
                                          <CircleDot className="mr-1 h-4 w-4" />
                                          Start
                                        </Button>
                                      )}
                                      {repairStatus === "in_progress" && (
                                        <>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => {
                                              setHoldTarget({ vehicleId: vehicle.id, repairId: repair.id });
                                              setHoldReason(repair.holdReason || "");
                                              setHoldDialogOpen(true);
                                            }}
                                          >
                                            <Pause className="mr-1 h-4 w-4" />
                                            Hold
                                          </Button>
                                          <Button
                                            size="sm"
                                            onClick={() => handleRepairAction(vehicle.id, repair.id, "complete")}
                                          >
                                            <CheckCircle className="mr-1 h-4 w-4" />
                                            Complete
                                          </Button>
                                        </>
                                      )}
                                      {repairStatus === "on_hold" && (
                                        <>
                                          <Button
                                            size="sm"
                                            onClick={() => handleRepairAction(vehicle.id, repair.id, "resume")}
                                          >
                                            <ArrowRight className="mr-1 h-4 w-4" />
                                            Resume
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => handleRepairAction(vehicle.id, repair.id, "complete")}
                                          >
                                            <CheckCircle className="mr-1 h-4 w-4" />
                                            Complete
                                          </Button>
                                        </>
                                      )}
                                    </div>
                                  </div>

                                  {repairStatus === "on_hold" && repair.holdReason && (
                                    <p className="text-sm text-amber-400">
                                      Hold reason: {repair.holdReason}
                                    </p>
                                  )}

                                  {/* Work Log */}
                                  {repair.workLog && repair.workLog.length > 0 && (
                                    <div className="rounded-md border border-border/50 px-3 py-2 text-xs">
                                      <div className="flex items-center gap-2 text-muted-foreground">
                                        <Clock className="h-3.5 w-3.5" />
                                        Work log
                                      </div>
                                      <div className="mt-2 space-y-1">
                                        {repair.workLog.map((entry, index) => (
                                          <div key={`${entry.status}-${index}`} className="space-y-0.5">
                                            <div className="flex items-center justify-between">
                                              <span className="capitalize">
                                                {entry.status.replace("_", " ")}
                                              </span>
                                              <span className="text-muted-foreground">
                                                {formatDateTime(entry.at)} • {entry.by}
                                              </span>
                                            </div>
                                            {entry.note && (
                                              <div className="text-muted-foreground">
                                                Note: {entry.note}
                                              </div>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* Photos */}
                                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                    <div className="space-y-2">
                                      <Label className="text-xs">Pre-Work Photos</Label>
                                      <div className="flex gap-2 flex-wrap">
                                        {prePhotos.map((url, idx) => (
                                          <button
                                            key={`${url}-${idx}`}
                                            type="button"
                                            className="h-16 w-16 overflow-hidden rounded border border-border/50"
                                            onClick={() => setPhotoPreview({ url, label: "Pre-Work Photo" })}
                                          >
                                            <img
                                              src={url}
                                              alt="Pre-work"
                                              className="h-full w-full object-cover"
                                              loading="lazy"
                                            />
                                          </button>
                                        ))}
                                        {prePhotos.length === 0 && (
                                          <div className="h-16 w-16 rounded bg-muted flex items-center justify-center text-xs text-muted-foreground">
                                            No photos
                                          </div>
                                        )}
                                      </div>
                                      <div className="flex flex-wrap gap-2">
                                        <input
                                          id={preCameraId}
                                          type="file"
                                          accept="image/*"
                                          capture="environment"
                                          multiple
                                          className="hidden"
                                          onChange={(event) => {
                                            void handleRepairPhotoUpload(
                                              vehicle.id,
                                              repair.id,
                                              "pre",
                                              event.target.files
                                            );
                                            event.currentTarget.value = "";
                                          }}
                                        />
                                        <Button size="sm" variant="outline" asChild disabled={preUploading}>
                                          <Label htmlFor={preCameraId} className="cursor-pointer">
                                            <Camera className="mr-1 h-4 w-4" />
                                            Camera
                                          </Label>
                                        </Button>
                                        <input
                                          id={preUploadId}
                                          type="file"
                                          accept="image/*"
                                          multiple
                                          className="hidden"
                                          onChange={(event) => {
                                            void handleRepairPhotoUpload(
                                              vehicle.id,
                                              repair.id,
                                              "pre",
                                              event.target.files
                                            );
                                            event.currentTarget.value = "";
                                          }}
                                        />
                                        <Button size="sm" variant="outline" asChild disabled={preUploading}>
                                          <Label htmlFor={preUploadId} className="cursor-pointer">
                                            <Upload className="mr-1 h-4 w-4" />
                                            Upload
                                          </Label>
                                        </Button>
                                        {preUploading && (
                                          <span className="text-xs text-muted-foreground">
                                            Uploading...
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="space-y-2">
                                      <Label className="text-xs">Post-Work Photos</Label>
                                      <div className="flex gap-2 flex-wrap">
                                        {postPhotos.map((url, idx) => (
                                          <button
                                            key={`${url}-${idx}`}
                                            type="button"
                                            className="h-16 w-16 overflow-hidden rounded border border-border/50"
                                            onClick={() => setPhotoPreview({ url, label: "Post-Work Photo" })}
                                          >
                                            <img
                                              src={url}
                                              alt="Post-work"
                                              className="h-full w-full object-cover"
                                              loading="lazy"
                                            />
                                          </button>
                                        ))}
                                        {postPhotos.length === 0 && (
                                          <div className="h-16 w-16 rounded bg-muted flex items-center justify-center text-xs text-muted-foreground">
                                            No photos
                                          </div>
                                        )}
                                      </div>
                                      <div className="flex flex-wrap gap-2">
                                        <input
                                          id={postCameraId}
                                          type="file"
                                          accept="image/*"
                                          capture="environment"
                                          multiple
                                          className="hidden"
                                          onChange={(event) => {
                                            void handleRepairPhotoUpload(
                                              vehicle.id,
                                              repair.id,
                                              "post",
                                              event.target.files
                                            );
                                            event.currentTarget.value = "";
                                          }}
                                        />
                                        <Button size="sm" variant="outline" asChild disabled={postUploading}>
                                          <Label htmlFor={postCameraId} className="cursor-pointer">
                                            <Camera className="mr-1 h-4 w-4" />
                                            Camera
                                          </Label>
                                        </Button>
                                        <input
                                          id={postUploadId}
                                          type="file"
                                          accept="image/*"
                                          multiple
                                          className="hidden"
                                          onChange={(event) => {
                                            void handleRepairPhotoUpload(
                                              vehicle.id,
                                              repair.id,
                                              "post",
                                              event.target.files
                                            );
                                            event.currentTarget.value = "";
                                          }}
                                        />
                                        <Button size="sm" variant="outline" asChild disabled={postUploading}>
                                          <Label htmlFor={postUploadId} className="cursor-pointer">
                                            <Upload className="mr-1 h-4 w-4" />
                                            Upload
                                          </Label>
                                        </Button>
                                        {postUploading && (
                                          <span className="text-xs text-muted-foreground">
                                            Uploading...
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                {/* Cost Entry */}
                                <div className="grid grid-cols-3 gap-4 pt-2 border-t">
                                  <div className="space-y-1">
                                    <Label className="text-xs">Total Cost</Label>
                                    <div className="flex items-center gap-1">
                                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                                      <Input
                                        type="number"
                                        value={repair.totalCost || ""}
                                        onChange={(e) =>
                                          handleUpdateRepairCost(
                                            vehicle.id,
                                            repair.id,
                                            parseFloat(e.target.value) || 0
                                          )
                                        }
                                        className="h-8"
                                      />
                                    </div>
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs text-blue-400">
                                      Labour (70%)
                                    </Label>
                                    <p className="font-medium text-blue-400">
                                      ${repair.labourCost.toFixed(2)}
                                    </p>
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs text-amber-400">
                                      Materials (30%)
                                    </Label>
                                    <p className="font-medium text-amber-400">
                                      ${repair.materialsCost.toFixed(2)}
                                    </p>
                                  </div>
                                </div>
                                </CardContent>
                              </Card>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Microfiber Disks - Only show for scratch/graffiti repairs */}
                    {vehicleHasScratchGraffitiRepair(vehicle) && (
                      <div className="space-y-3">
                        <Label className="text-sm font-medium">Microfibre Disks Used</Label>
                        <Card className="bg-muted/20">
                          <CardContent className="p-4">
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b">
                                    <th className="text-left py-2 pr-4">Grade</th>
                                    {MICROFIBER_DISK_SIZES.map((size) => (
                                      <th key={size.value} className="text-center py-2 px-2">
                                        {size.label}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {MICROFIBER_DISK_GRADES.map((grade) => (
                                    <tr key={grade.value} className="border-b last:border-0">
                                      <td className="py-2 pr-4 font-medium">{grade.label}</td>
                                      {MICROFIBER_DISK_SIZES.map((size) => (
                                        <td key={size.value} className="py-2 px-2">
                                          <Input
                                            type="number"
                                            min="0"
                                            value={getMicrofiberQuantity(
                                              vehicle,
                                              grade.value,
                                              size.value
                                            ) || ""}
                                            onChange={(e) =>
                                              handleUpdateMicrofiberUsage(
                                                vehicle.id,
                                                grade.value,
                                                size.value,
                                                parseInt(e.target.value) || 0
                                              )
                                            }
                                            className="h-8 w-16 text-center"
                                          />
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    )}

                    {/* Vehicle Summary */}
                    <Card className="bg-primary/5 border-primary/20">
                      <CardContent className="p-4">
                        <div className="grid grid-cols-4 gap-4 text-sm">
                          <div>
                            <Label className="text-xs text-muted-foreground">
                              Total Cost
                            </Label>
                            <p className="text-lg font-bold">
                              ${vehicle.totalCost.toFixed(2)}
                            </p>
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Labour</Label>
                            <p className="font-medium text-blue-400">
                              ${vehicle.totalLabourCost.toFixed(2)}
                            </p>
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">
                              Materials
                            </Label>
                            <p className="font-medium text-amber-400">
                              ${vehicle.totalMaterialsCost.toFixed(2)}
                            </p>
                          </div>
                          <div className="flex items-end gap-2">
                            <Select
                              value={vehicle.status}
                              onValueChange={(val) =>
                                handleUpdateVehicleStatus(
                                  vehicle.id,
                                  val as JobVehicle["status"]
                                )
                              }
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="pending">Pending</SelectItem>
                                <SelectItem value="in_progress">In Progress</SelectItem>
                                <SelectItem value="completed">Completed</SelectItem>
                                <SelectItem value="on_hold">On Hold</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        {vehicle.status === "on_hold" && (
                          <div className="mt-3">
                            <Input
                              placeholder="Reason for hold (e.g., Parts on order, Awaiting approval)"
                              value={vehicle.holdReason || ""}
                              onChange={(e) =>
                                handleUpdateVehicleStatus(
                                  vehicle.id,
                                  "on_hold",
                                  e.target.value
                                )
                              }
                            />
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    {/* Delete Vehicle Button */}
                    <div className="flex justify-end">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDeleteVehicle(vehicle.id)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Remove Vehicle
                      </Button>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </TabsContent>

        {/* Job Summary Tab */}
        <TabsContent value="summary" className="space-y-4">
          <Card className="bg-card/50 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-primary" />
                Job Cost Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {jobVehicles.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  Add vehicles and repair sites to see job summary
                </p>
              ) : (
                <>
                  {/* Per Vehicle Summary */}
                  <div className="space-y-4">
                    {jobVehicles.map((vehicle) => (
                      <Card key={vehicle.id} className="bg-muted/30">
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <Car className="h-5 w-5 text-primary" />
                              <span className="font-mono font-medium">
                                {vehicle.registration || vehicle.vin}
                              </span>
                              <Badge className={vehicleStatusColors[vehicle.status]}>
                                {vehicle.status === "on_hold"
                                  ? `On Hold: ${vehicle.holdReason || "No reason"}`
                                  : vehicle.status.replace("_", " ")}
                              </Badge>
                            </div>
                            <span className="text-lg font-bold">
                              ${vehicle.totalCost.toFixed(2)}
                            </span>
                          </div>
                          {vehicle.poWorksOrderNumber && (
                            <p className="text-sm text-muted-foreground mb-2">
                              Works Order: {vehicle.poWorksOrderNumber}
                            </p>
                          )}
                          <div className="space-y-1 text-sm">
                            {vehicle.repairSites.map((repair) => (
                              <div
                                key={repair.id}
                                className="flex items-center justify-between py-1 border-b border-border/30 last:border-0"
                              >
                                <div className="flex items-center gap-2">
                                  {repair.isCompleted ? (
                                    <CheckCircle className="h-4 w-4 text-green-400" />
                                  ) : (
                                    <CircleDot className="h-4 w-4 text-muted-foreground" />
                                  )}
                                  <span>
                                    {BOOKING_TYPE_LABELS[repair.repairType]} - {repair.location}
                                  </span>
                                </div>
                                <span className="font-medium">${repair.totalCost.toFixed(2)}</span>
                              </div>
                            ))}
                          </div>
                          <div className="flex gap-4 mt-3 pt-3 border-t text-sm">
                            <span className="text-blue-400">
                              Labour: ${vehicle.totalLabourCost.toFixed(2)}
                            </span>
                            <span className="text-amber-400">
                              Materials: ${vehicle.totalMaterialsCost.toFixed(2)}
                            </span>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {/* Grand Total */}
                  <Card className="bg-primary/10 border-primary/30">
                    <CardContent className="p-6">
                      <div className="grid grid-cols-3 gap-6 text-center">
                        <div>
                          <Label className="text-xs text-muted-foreground">Total Labour</Label>
                          <p className="text-2xl font-bold text-blue-400">
                            ${jobTotals.totalLabour.toFixed(2)}
                          </p>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Total Materials</Label>
                          <p className="text-2xl font-bold text-amber-400">
                            ${jobTotals.totalMaterials.toFixed(2)}
                          </p>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Grand Total</Label>
                          <p className="text-2xl font-bold text-primary">
                            ${jobTotals.totalCost.toFixed(2)}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}
            </CardContent>
          </Card>
          <Card className="bg-card/50 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Management Close-off
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>Invoice number</Label>
                  <Input
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    placeholder="INV-0001"
                    disabled={!canManageCloseOff || isClosed}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Invoice date</Label>
                  <Input
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    disabled={!canManageCloseOff || isClosed}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Invoice sent date</Label>
                  <Input
                    type="date"
                    value={invoiceSentDate}
                    onChange={(e) => setInvoiceSentDate(e.target.value)}
                    disabled={!canManageCloseOff || isClosed}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span>
                  Management approved:{" "}
                  {job.managementApprovedAt ? formatDate(job.managementApprovedAt) : "Not yet"}
                </span>
                <span>
                  Invoice sent: {job.invoiceSentAt ? formatDate(job.invoiceSentAt) : "Not yet"}
                </span>
                <Badge className={statusColors[job.status]} variant="outline">
                  {job.status.replace("_", " ").toUpperCase()}
                </Badge>
              </div>

              {canManageCloseOff ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={handleSaveInvoiceDetails} disabled={isClosed}>
                    Save invoicing details
                  </Button>
                  <Button onClick={handleManagementCloseOff} disabled={isClosed}>
                    Mark job as closed
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Only admins can close jobs after invoicing.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Team Tab */}
        <TabsContent value="team" className="space-y-4">
          <Card className="bg-card/50 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Assigned Team
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {assignedTechs.map((tech) => (
                <div
                  key={tech.technicianId}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/30"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
                      <Wrench className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">{tech.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {tech.role} Technician
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className="capitalize">
                    {tech.role}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* History Tab */}
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
                      <div
                        className={`h-3 w-3 rounded-full ${statusColors[entry.status].split(" ")[0]}`}
                      />
                      {index < job.statusLog.length - 1 && (
                        <div className="w-px flex-1 bg-border/50 my-1" />
                      )}
                    </div>
                    <div className="flex-1 pb-4">
                      <div className="flex items-center gap-2">
                        <Badge className={statusColors[entry.status]} variant="outline">
                          {entry.status.replace("_", " ")}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(entry.changedAt)}
                        </span>
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
      </Tabs>

      <Dialog
        open={holdDialogOpen}
        onOpenChange={(open) => {
          setHoldDialogOpen(open);
          if (!open) {
            setHoldTarget(null);
            setHoldReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Place Repair On Hold</DialogTitle>
            <DialogDescription>
              Provide a reason so the client knows why work paused.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="repair-hold-reason">Hold Reason</Label>
            <Input
              id="repair-hold-reason"
              placeholder="e.g., Awaiting parts, Client approval required"
              value={holdReason}
              onChange={(e) => setHoldReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHoldDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!holdTarget) return;
                const reason = holdReason.trim();
                if (!reason) return;
                await handleRepairAction(holdTarget.vehicleId, holdTarget.repairId, "hold", reason);
                setHoldDialogOpen(false);
                setHoldTarget(null);
                setHoldReason("");
              }}
              disabled={!holdReason.trim()}
            >
              Set Hold
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!photoPreview}
        onOpenChange={(open) => {
          if (!open) setPhotoPreview(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{photoPreview?.label || "Photo Preview"}</DialogTitle>
            <DialogDescription>Tap or click outside the image to close.</DialogDescription>
          </DialogHeader>
          {photoPreview && (
            <div className="flex items-center justify-center">
              <img
                src={photoPreview.url}
                alt={photoPreview.label}
                className="max-h-[70vh] w-full rounded-md object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Vehicle Dialog */}
      <Dialog open={showAddVehicleDialog} onOpenChange={setShowAddVehicleDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Vehicle</DialogTitle>
            <DialogDescription>
              Enter vehicle details. Registration is required.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="registration">Registration *</Label>
                <Input
                  id="registration"
                  placeholder="ABC-123"
                  value={newVehicle.registration}
                  onChange={(e) =>
                    setNewVehicle({ ...newVehicle, registration: e.target.value.toUpperCase() })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vin">VIN</Label>
                <Input
                  id="vin"
                  placeholder="Vehicle Identification Number"
                  value={newVehicle.vin}
                  onChange={(e) => setNewVehicle({ ...newVehicle, vin: e.target.value.toUpperCase() })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="fleetAsset">Fleet/Asset Number</Label>
                <Input
                  id="fleetAsset"
                  placeholder="Optional"
                  value={newVehicle.fleetAssetNumber}
                  onChange={(e) =>
                    setNewVehicle({ ...newVehicle, fleetAssetNumber: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bodyManufacturer">Body Manufacturer</Label>
                <Input
                  id="bodyManufacturer"
                  placeholder="e.g., Volgren, Custom Denning"
                  value={newVehicle.bodyManufacturer}
                  onChange={(e) =>
                    setNewVehicle({ ...newVehicle, bodyManufacturer: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="year">Year</Label>
                <Input
                  id="year"
                  type="number"
                  placeholder="e.g., 2024"
                  value={newVehicle.year}
                  onChange={(e) => setNewVehicle({ ...newVehicle, year: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="poNumber">PO/Works Order Number</Label>
                <Input
                  id="poNumber"
                  placeholder="e.g., PO-12345"
                  value={newVehicle.poWorksOrderNumber}
                  onChange={(e) =>
                    setNewVehicle({ ...newVehicle, poWorksOrderNumber: e.target.value })
                  }
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant={canLookupFleet ? "default" : "outline"}
              className={canLookupFleet ? "bg-emerald-600 text-white hover:bg-emerald-700" : ""}
              onClick={handleFleetLookup}
              disabled={!canLookupFleet}
            >
              Lookup fleet
            </Button>
            <Button variant="outline" onClick={() => setShowAddVehicleDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddVehicle}
              disabled={!newVehicle.registration.trim()}
            >
              Add Vehicle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Repair Site Dialog */}
      <Dialog open={showAddRepairDialog} onOpenChange={setShowAddRepairDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Repair Site</DialogTitle>
            <DialogDescription>Document a repair or damage site on this vehicle</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Repair Type *</Label>
              <Select
                value={newRepair.repairType}
                onValueChange={(val) => setNewRepair({ ...newRepair, repairType: val as RepairType })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select repair type" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(BOOKING_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="repairLocation">Location on Vehicle *</Label>
              <Input
                id="repairLocation"
                placeholder="e.g., Front windscreen - driver side"
                value={newRepair.location}
                onChange={(e) => setNewRepair({ ...newRepair, location: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="repairDescription">Description</Label>
              <Textarea
                id="repairDescription"
                placeholder="Optional description of the damage/repair"
                value={newRepair.description}
                onChange={(e) => setNewRepair({ ...newRepair, description: e.target.value })}
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="repairCost">Cost ($)</Label>
              <Input
                id="repairCost"
                type="number"
                placeholder="0.00"
                value={newRepair.totalCost}
                onChange={(e) => setNewRepair({ ...newRepair, totalCost: e.target.value })}
              />
              {newRepair.totalCost && (
                <p className="text-xs text-muted-foreground">
                  Labour: ${(parseFloat(newRepair.totalCost) * 0.7).toFixed(2)} | Materials: $
                  {(parseFloat(newRepair.totalCost) * 0.3).toFixed(2)}
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddRepairDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddRepairSite}
              disabled={!newRepair.repairType || !newRepair.location}
            >
              Add Repair Site
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
