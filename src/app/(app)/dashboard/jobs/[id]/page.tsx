"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDoc,
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
  ConsumableUsage,
  RepairWorkStatus,
  Job,
  JobRiskAssessment,
  JobRiskAssessmentHazard,
  ImsRiskRegisterEntry,
} from "@/lib/types";
import {
  BOOKING_TYPE_LABELS,
  MICROFIBER_DISK_GRADES,
  MICROFIBER_DISK_SIZES,
  calculateCostBreakdown,
} from "@/lib/types";
import { getPublicEnv } from "@/lib/public-env";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
  Navigation,
  Upload,
  Shield,
  Bot,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { InternalKnowledgeAssistant } from "@/components/assistant/internal-knowledge-assistant";

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

const DEFAULT_RISK_HAZARDS: JobRiskAssessmentHazard[] = [
  {
    id: "vehicle_movement",
    label: "Vehicle or bus movement in depot/work zone",
    present: false,
    riskLevel: "medium",
    controls: "Traffic management plan, spotter, exclusion zone.",
  },
  {
    id: "working_at_height",
    label: "Working at height (steps, ladders, platforms)",
    present: false,
    riskLevel: "medium",
    controls: "Use approved access equipment, maintain 3 points of contact.",
  },
  {
    id: "manual_handling",
    label: "Manual handling or heavy lifting",
    present: false,
    riskLevel: "medium",
    controls: "Use team lift or mechanical aids, follow safe lifting technique.",
  },
  {
    id: "chemicals",
    label: "Chemical exposure (cleaners, solvents, coatings)",
    present: false,
    riskLevel: "medium",
    controls: "Review SDS, wear PPE, ensure ventilation.",
  },
  {
    id: "electrical",
    label: "Electrical hazards or powered tools",
    present: false,
    riskLevel: "medium",
    controls: "Inspect leads/tools, use RCD, isolate where required.",
  },
  {
    id: "hot_work",
    label: "Hot work or heat sources",
    present: false,
    riskLevel: "high",
    controls: "Permit if required, fire watch, keep extinguisher nearby.",
  },
  {
    id: "noise",
    label: "Noise exposure",
    present: false,
    riskLevel: "low",
    controls: "Use hearing protection, limit exposure time.",
  },
  {
    id: "slips_trips",
    label: "Slips, trips, or uneven surfaces",
    present: false,
    riskLevel: "medium",
    controls: "Housekeeping, clear walkways, use signage.",
  },
  {
    id: "public_interaction",
    label: "Public or client interaction in work area",
    present: false,
    riskLevel: "medium",
    controls: "Set barriers, communicate with site contact.",
  },
  {
    id: "weather",
    label: "Weather exposure (heat, rain, wind)",
    present: false,
    riskLevel: "medium",
    controls: "Monitor conditions, adjust schedule, hydrate.",
  },
  {
    id: "confined_space",
    label: "Confined or restricted spaces",
    present: false,
    riskLevel: "high",
    controls: "Permit, monitoring, standby, rescue plan.",
  },
];

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
    jobs,
  } = useJobs();
  const { user, firebaseUser } = useAuth();
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
    filmProduct: "" as RepairSite["filmProduct"] | "",
    tintRemovalRequired: false,
    substrateQaPassed: true,
    remediationType: "" as RepairSite["remediationType"] | "",
    location: "",
    description: "",
    totalCost: "",
  });
  const [aiRequest, setAiRequest] = useState("");
  const [aiResult, setAiResult] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [showRiskDialog, setShowRiskDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<{ url: string; label: string } | null>(
    null
  );
  const [uploadingPhotos, setUploadingPhotos] = useState<Record<string, boolean>>({});
  const [consumableDrafts, setConsumableDrafts] = useState<
    Record<string, { item: string; quantity: string }>
  >({});
  const saveTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
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

  const buildRiskAssessmentDraft = (
    existing?: JobRiskAssessment
  ): JobRiskAssessment => {
    const base: JobRiskAssessment = {
      siteConditions: {
        weather: "",
        lighting: "good",
        accessClear: true,
        trafficControlInPlace: false,
        emergencyAccessClear: true,
      },
      ppe: {
        gloves: true,
        eyeProtection: true,
        hiVis: true,
        hearingProtection: false,
        respirator: false,
        hardHat: false,
        safetyBoots: true,
        other: "",
      },
      hazards: DEFAULT_RISK_HAZARDS.map((hazard) => ({ ...hazard })),
      additionalControls: "",
      supervisorNotified: false,
      stopWorkAuthorityConfirmed: false,
      notes: "",
    };

    if (!existing) return base;

    const existingHazards = existing.hazards || [];
    const mergedHazards = base.hazards.map((hazard) => {
      const match = existingHazards.find((item) => item.id === hazard.id);
      return match ? { ...hazard, ...match } : hazard;
    });

    return {
      ...base,
      ...existing,
      siteConditions: { ...base.siteConditions, ...existing.siteConditions },
      ppe: { ...base.ppe, ...existing.ppe },
      hazards: mergedHazards,
    };
  };

  const [riskAssessment, setRiskAssessment] = useState<JobRiskAssessment>(() =>
    buildRiskAssessmentDraft(job?.riskAssessment)
  );
  const [showNextJobDialog, setShowNextJobDialog] = useState(false);
  const [nextJobCandidate, setNextJobCandidate] = useState<Job | null>(null);
  const [sendingCompletionNotice, setSendingCompletionNotice] = useState(false);
  const [sendingClientNotice, setSendingClientNotice] = useState<
    "job_started" | "job_on_hold" | "job_completed" | null
  >(null);
  const [auditRunning, setAuditRunning] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
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
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
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

  const mapsApiKey = getPublicEnv("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY") || "";

  const getJobDateValue = (targetJob: Job) =>
    targetJob.scheduledDate?.toDate?.() || targetJob.booking?.preferredDate?.toDate?.() || null;

  const getJobMinutes = (targetJob: Job) => {
    const time = targetJob.booking?.preferredTime;
    if (!time) return null;
    const [hours, minutes] = time.split(":").map((val) => Number.parseInt(val, 10));
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    return hours * 60 + minutes;
  };

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const findNextJobCandidate = () => {
    if (!job) return null;
    const currentDate = getJobDateValue(job);
    if (!currentDate) return null;
    const currentMinutes = getJobMinutes(job) ?? -1;

    return (
      jobs
        .filter((item) => item.id !== job.id)
        .filter((item) => item.status !== "completed" && item.status !== "closed")
        .filter((item) => !item.isDeleted)
        .filter((item) => {
          if (user?.uid && item.assignedTechnicianIds?.length) {
            return item.assignedTechnicianIds.includes(user.uid);
          }
          return true;
        })
        .map((item) => ({
          job: item,
          date: getJobDateValue(item),
          minutes: getJobMinutes(item) ?? 24 * 60 + 1,
        }))
        .filter((entry) => entry.date && isSameDay(entry.date, currentDate))
        .filter((entry) => entry.minutes > currentMinutes)
        .sort((a, b) => a.minutes - b.minutes)[0]?.job || null
    );
  };

  const promptNextJobDirections = () => {
    const next = findNextJobCandidate();
    if (!next || !next.siteLocation?.address) return false;
    setNextJobCandidate(next);
    setShowNextJobDialog(true);
    return true;
  };

  const nextJobMapQuery = nextJobCandidate?.siteLocation?.address
    ? encodeURIComponent(nextJobCandidate.siteLocation.address)
    : "";
  const nextJobEmbedUrl =
    mapsApiKey && nextJobMapQuery
      ? `https://www.google.com/maps/embed/v1/place?key=${mapsApiKey}&q=${nextJobMapQuery}`
      : "";
  const nextJobDirectionsUrl = nextJobMapQuery
    ? `https://www.google.com/maps/dir/?api=1&destination=${nextJobMapQuery}`
    : "";

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
    setRiskAssessment(buildRiskAssessmentDraft(job.riskAssessment));
  }, [job?.id, job?.riskAssessment]);

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
            const payload: Record<string, unknown> = {
              organizationId,
              registration: vehicle.registration.toUpperCase(),
              createdAt: now,
              updatedAt: now,
            };
            if (vehicle.vin) payload.vin = vehicle.vin.toUpperCase();
            if (vehicle.fleetAssetNumber) payload.fleetAssetNumber = vehicle.fleetAssetNumber;
            if (vehicle.bodyManufacturer) payload.bodyManufacturer = vehicle.bodyManufacturer;
            if (typeof vehicle.year === "number") payload.year = vehicle.year;
            return setDoc(docRef, payload, { merge: true });
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
    subject: string,
    sendEmail = false
  ) => {
    try {
      if (!job.organizationId) {
        if (sendEmail && job.clientEmail) {
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
      if (snapshot.empty && sendEmail && job.clientEmail) {
        await queueEmail(job.clientEmail, subject, message);
        return;
      }
      await Promise.all(
        snapshot.docs.map(async (docSnap) => {
          const data = docSnap.data() as { email?: string };
          await queueNotification(docSnap.id, title, message, type);
          if (sendEmail && data.email) {
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

  const triggerCompletionAudit = async (mode: "auto" | "manual") => {
    if (!job || !firebaseUser) return;
    if (auditRunning) return;
    setAuditError(null);
    setAuditRunning(true);
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/knowledge-assistant/job-audit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ jobId: job.id }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Job audit failed.");
      }
      if (mode === "manual") {
        toast({
          title: "Audit generated",
          description: "Completion audit saved to the job card.",
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Job audit failed.";
      setAuditError(message);
    } finally {
      setAuditRunning(false);
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
      `ASI Job Complete: ${job.jobNumber}`,
      false
    );
    void triggerCompletionAudit("auto");
  };

  const handleSendCompletionNotice = async () => {
    if (!job) return;
    if (!job.clientEmail && !job.organizationId) {
      toast({
        title: "Missing client email",
        description: "This job does not have a client email on file.",
        variant: "destructive",
      });
      return;
    }
    setSendingCompletionNotice(true);
    try {
      await notifyClients(
        "job_completed",
        `Job ${job.jobNumber} completed`,
        `Your job ${job.jobNumber} with ASI is complete. We'll be in touch shortly.`,
        `ASI Job Complete: ${job.jobNumber}`,
        true
      );
      toast({
        title: "Completion notice sent",
        description: "The client has been notified.",
      });
    } catch (error) {
      console.warn("Failed to send completion notice:", error);
      toast({
        title: "Notification failed",
        description: "Unable to send the completion notice.",
        variant: "destructive",
      });
    } finally {
      setSendingCompletionNotice(false);
    }
  };

  const resolveHoldReason = () => {
    const vehicleHold = jobVehicles.find((vehicle) => vehicle.status === "on_hold");
    if (vehicleHold?.holdReason) return vehicleHold.holdReason;
    const repairHold = jobVehicles
      .flatMap((vehicle) => vehicle.repairSites)
      .find((repair) => getRepairStatus(repair) === "on_hold");
    if (repairHold?.holdReason) return repairHold.holdReason;
    return "Awaiting update";
  };

  const handleSendClientNotice = async (
    type: "job_started" | "job_on_hold" | "job_completed"
  ) => {
    if (!job) return;
    if (!job.clientEmail && !job.organizationId) {
      toast({
        title: "Missing client contact",
        description: "This job does not have a client email or organization linked.",
        variant: "destructive",
      });
      return;
    }
    setSendingClientNotice(type);
    try {
      if (type === "job_started") {
        await notifyClients(
          "job_started",
          `Job ${job.jobNumber} started`,
          `Our technician has started work on job ${job.jobNumber}.`,
          `ASI Job Started: ${job.jobNumber}`,
          true
        );
      }
      if (type === "job_on_hold") {
        const reason = resolveHoldReason();
        await notifyClients(
          "job_on_hold",
          `Job ${job.jobNumber} on hold`,
          `Job ${job.jobNumber} is on hold. Reason: ${reason}.`,
          `ASI Job On Hold: ${job.jobNumber}`,
          true
        );
      }
      if (type === "job_completed") {
        await notifyClients(
          "job_completed",
          `Job ${job.jobNumber} completed`,
          `Your job ${job.jobNumber} with ASI is complete. We'll be in touch shortly.`,
          `ASI Job Complete: ${job.jobNumber}`,
          true
        );
      }
      toast({
        title: "Client notified",
        description: "The notification has been sent.",
      });
    } catch (error) {
      console.warn("Failed to send client notice:", error);
      toast({
        title: "Notification failed",
        description: "Unable to send this notification.",
        variant: "destructive",
      });
    } finally {
      setSendingClientNotice(null);
    }
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
        description: "Job marked complete. Client notification is manual.",
      });
      if (!promptNextJobDirections()) {
        router.push("/dashboard/bookings");
      }
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
      consumablesUsed: [],
      status: "pending",
      totalCost: 0,
      totalLabourCost: 0,
      totalMaterialsCost: 0,
    };

    const updatedVehicles = [...jobVehicles, vehicle];
    setJobVehicles(updatedVehicles);
    scheduleJobVehiclesSave(updatedVehicles);
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
      filmProduct:
        newRepair.repairType === "film_installation" && newRepair.filmProduct
          ? (newRepair.filmProduct as RepairSite["filmProduct"])
          : undefined,
      tintRemovalRequired:
        newRepair.repairType === "film_installation"
          ? Boolean(newRepair.tintRemovalRequired)
          : undefined,
      substrateQaPassed:
        newRepair.repairType === "film_installation"
          ? Boolean(newRepair.substrateQaPassed)
          : undefined,
      remediationType:
        newRepair.repairType === "film_installation" && newRepair.remediationType
          ? (newRepair.remediationType as RepairSite["remediationType"])
          : undefined,
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

    const updatedVehicles = jobVehicles.map((v) =>
      v.id === selectedVehicleId
        ? {
            ...v,
            repairSites: [...v.repairSites, repairSite],
            totalCost: v.totalCost + cost,
            totalLabourCost: v.totalLabourCost + labourCost,
            totalMaterialsCost: v.totalMaterialsCost + materialsCost,
          }
        : v
    );

    setJobVehicles(updatedVehicles);
    scheduleJobVehiclesSave(updatedVehicles);

    setNewRepair({
      repairType: "",
      filmProduct: "",
      tintRemovalRequired: false,
      substrateQaPassed: true,
      remediationType: "",
      location: "",
      description: "",
      totalCost: "",
    });
    setShowAddRepairDialog(false);
  };

  const scheduleJobVehiclesSave = (updatedVehicles: JobVehicle[]) => {
    const key = "jobVehicles";
    const existing = saveTimeouts.current[key];
    if (existing) clearTimeout(existing);
    saveTimeouts.current[key] = setTimeout(() => {
      void updateJob(job.id, { jobVehicles: updatedVehicles });
    }, 600);
  };

  const handleSaveRiskAssessment = async (markComplete: boolean) => {
    if (!job) return;
    const now = Timestamp.now();
    const staffNames =
      job.assignedTechnicians
        ?.map((tech) => tech.technicianName)
        .filter((name): name is string => Boolean(name)) ?? [];
    const nextAssessment: JobRiskAssessment = {
      ...riskAssessment,
      hazards: riskAssessment.hazards.map((hazard) => ({
        ...hazard,
        controls: hazard.controls.trim(),
      })),
      additionalControls: riskAssessment.additionalControls.trim(),
      notes: riskAssessment.notes.trim(),
    };

    if (markComplete) {
      nextAssessment.completedAt = now;
      nextAssessment.completedBy = {
        id: user?.uid || "system",
        name: user?.name || user?.email || "ASI Staff",
      };
      nextAssessment.coveredStaffIds = job.assignedTechnicianIds || [];
      nextAssessment.coveredStaffNames = staffNames;
    }

    await updateJob(job.id, {
      riskAssessment: nextAssessment,
      updatedAt: now,
    });

    // Sync hazards into the company Risk & Opportunities Register for traceability.
    try {
      const hazards = nextAssessment.hazards || [];
      await Promise.all(
        hazards.map(async (hazard) => {
          const riskId = `job-${job.id}-${hazard.id}`;
          const refDoc = doc(db, COLLECTIONS.IMS_RISK_REGISTER, riskId);
          const existing = await getDoc(refDoc);

          const payload: Omit<ImsRiskRegisterEntry, "id"> = {
            entryType: "risk",
            domain: "whs",
            title: hazard.label,
            description: `Identified from SWMS/JSA for job ${job.jobNumber}.`,
            riskLevel: hazard.riskLevel,
            present: hazard.present,
            existingControls: hazard.controls,
            additionalControls: nextAssessment.additionalControls || "",
            status: hazard.present ? "open" : "closed",
            source: {
              type: "job_risk_assessment",
              id: job.id,
              label: job.jobNumber,
              url: `/dashboard/jobs/${job.id}`,
            },
            createdAt: existing.exists() ? (existing.data()?.createdAt as Timestamp) : now,
            createdById: existing.exists()
              ? (existing.data()?.createdById as string)
              : (user?.uid || "system"),
            createdByName: existing.exists()
              ? (existing.data()?.createdByName as string)
              : (user?.name || user?.email || "ASI Staff"),
            updatedAt: now,
          };

          await setDoc(refDoc, payload, { merge: true });
        })
      );
    } catch (error) {
      // Non-blocking: job should still be startable even if risk register sync fails.
      console.warn("Risk register sync failed", error);
    }

    setRiskAssessment(nextAssessment);
    setShowRiskDialog(false);
    toast({
      title: markComplete ? "Risk Assessment Completed" : "Risk Assessment Saved",
      description: markComplete
        ? "Site risk assessment recorded. You can now start work."
        : "Risk assessment draft saved.",
    });
  };

  const handleUpdateRepairDetails = (
    vehicleId: string,
    repairId: string,
    updates: Partial<RepairSite>
  ) => {
    const updatedVehicles = jobVehicles.map((vehicle) => {
      if (vehicle.id !== vehicleId) return vehicle;
      const updatedRepairs = vehicle.repairSites.map((repair) =>
        repair.id === repairId ? { ...repair, ...updates } : repair
      );
      return { ...vehicle, repairSites: updatedRepairs };
    });
    setJobVehicles(updatedVehicles);
    scheduleJobVehiclesSave(updatedVehicles);
  };

  // Update repair site cost
  const handleUpdateRepairCost = (vehicleId: string, repairId: string, newCost: number) => {
    const { labourCost, materialsCost } = calculateCostBreakdown(newCost);

    const updatedVehicles = jobVehicles.map((v) => {
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
    });

    setJobVehicles(updatedVehicles);
    scheduleJobVehiclesSave(updatedVehicles);
  };

  // Update microfiber disk usage
  const handleUpdateMicrofiberUsage = (
    vehicleId: string,
    grade: MicrofiberDiskGrade,
    size: MicrofiberDiskSize,
    quantity: number
  ) => {
    const updatedVehicles = jobVehicles.map((v) => {
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
    });

    setJobVehicles(updatedVehicles);
    scheduleJobVehiclesSave(updatedVehicles);
  };

  const handleUpdateConsumable = (
    vehicleId: string,
    index: number,
    updates: Partial<ConsumableUsage>
  ) => {
    const updatedVehicles = jobVehicles.map((vehicle) => {
      if (vehicle.id !== vehicleId) return vehicle;
      const consumables = vehicle.consumablesUsed ? [...vehicle.consumablesUsed] : [];
      if (!consumables[index]) return vehicle;
      consumables[index] = { ...consumables[index], ...updates };
      return { ...vehicle, consumablesUsed: consumables };
    });
    setJobVehicles(updatedVehicles);
    scheduleJobVehiclesSave(updatedVehicles);
  };

  const handleRemoveConsumable = (vehicleId: string, index: number) => {
    const updatedVehicles = jobVehicles.map((vehicle) => {
      if (vehicle.id !== vehicleId) return vehicle;
      const consumables = vehicle.consumablesUsed ? [...vehicle.consumablesUsed] : [];
      consumables.splice(index, 1);
      return { ...vehicle, consumablesUsed: consumables };
    });
    setJobVehicles(updatedVehicles);
    scheduleJobVehiclesSave(updatedVehicles);
  };

  const handleAddConsumable = (vehicleId: string) => {
    const draft = consumableDrafts[vehicleId] || { item: "", quantity: "" };
    const item = draft.item.trim();
    const quantity = Number.parseFloat(draft.quantity);
    if (!item || Number.isNaN(quantity)) return;

    const updatedVehicles = jobVehicles.map((vehicle) => {
      if (vehicle.id !== vehicleId) return vehicle;
      const consumables = vehicle.consumablesUsed ? [...vehicle.consumablesUsed] : [];
      consumables.push({ item, quantity });
      return { ...vehicle, consumablesUsed: consumables };
    });

    setJobVehicles(updatedVehicles);
    setConsumableDrafts((prev) => ({ ...prev, [vehicleId]: { item: "", quantity: "" } }));
    scheduleJobVehiclesSave(updatedVehicles);
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
    if ((action === "start" || action === "resume") && !riskAssessment.completedAt) {
      setShowRiskDialog(true);
      toast({
        title: "Site Risk Assessment Required",
        description: "Complete the SWMS/JSA before starting work.",
      });
      return;
    }
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
            `ASI Job Started: ${job.jobNumber}`,
            false
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
          `ASI Job On Hold: ${job.jobNumber}`,
          false
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

  const handleRemoveRepairPhoto = (
    vehicleId: string,
    repairId: string,
    kind: "pre" | "post",
    url: string
  ) => {
    const updatedVehicles = jobVehicles.map((vehicle) => {
      if (vehicle.id !== vehicleId) return vehicle;
      const updatedRepairs = vehicle.repairSites.map((repair) => {
        if (repair.id !== repairId) return repair;
        const photos = kind === "pre" ? repair.preWorkPhotos ?? [] : repair.postWorkPhotos ?? [];
        const next = photos.filter((photo) => photo !== url);
        return kind === "pre"
          ? { ...repair, preWorkPhotos: next }
          : { ...repair, postWorkPhotos: next };
      });
      return { ...vehicle, repairSites: updatedRepairs };
    });
    setJobVehicles(updatedVehicles);
    scheduleJobVehiclesSave(updatedVehicles);
  };

  // Delete vehicle
  const handleDeleteVehicle = (vehicleId: string) => {
    const updatedVehicles = jobVehicles.filter((v) => v.id !== vehicleId);
    setJobVehicles(updatedVehicles);
    scheduleJobVehiclesSave(updatedVehicles);
  };

  // Delete repair site
  const handleDeleteRepair = (vehicleId: string, repairId: string) => {
    const updatedVehicles = jobVehicles.map((v) => {
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
    });
    setJobVehicles(updatedVehicles);
    scheduleJobVehiclesSave(updatedVehicles);
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
  const completionAudit = job.completionAudit;
  const auditCompliance = completionAudit?.complianceChecks ?? [];
  const auditIssues = completionAudit?.issues ?? [];
  const auditBilling = completionAudit?.billingNotes ?? [];
  const auditOpportunities = completionAudit?.commercialOpportunities ?? [];
  const auditImprovements = completionAudit?.improvements ?? [];

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
          <div className="flex flex-wrap gap-2">
            {(job.status === "completed" || job.status === "closed") && (
              <Button
                variant="outline"
                onClick={handleSendCompletionNotice}
                disabled={sendingCompletionNotice}
              >
                <Mail className="mr-2 h-4 w-4" />
                {sendingCompletionNotice ? "Sending..." : "Send Completion Notice"}
              </Button>
            )}
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
                    This will alert admins to review and invoice the job. Client notification is manual.
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
                      if (!promptNextJobDirections()) {
                        router.push("/dashboard/bookings");
                      }
                    }}
                  >
                    Confirm Complete
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog open={showNextJobDialog} onOpenChange={setShowNextJobDialog}>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Next Job Directions</DialogTitle>
                  <DialogDescription>
                    We found another job booked later today. Want directions to the next site?
                  </DialogDescription>
                </DialogHeader>
                {nextJobCandidate ? (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-border/40 bg-muted/20 p-3 text-sm">
                      <p className="font-medium">
                        {nextJobCandidate.jobNumber} • {nextJobCandidate.clientName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {nextJobCandidate.siteLocation?.address || "Address unavailable"}
                      </p>
                    </div>
                    {nextJobEmbedUrl ? (
                      <iframe
                        title="Next job map"
                        className="h-64 w-full rounded-xl border border-border/40"
                        loading="lazy"
                        referrerPolicy="no-referrer-when-downgrade"
                        src={nextJobEmbedUrl}
                      />
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Map preview requires NEXT_PUBLIC_GOOGLE_MAPS_API_KEY.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No next job found.</p>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowNextJobDialog(false)}>
                    Not now
                  </Button>
                  <Button
                    onClick={() => {
                      if (nextJobDirectionsUrl) {
                        window.open(nextJobDirectionsUrl, "_blank", "noopener,noreferrer");
                      }
                    }}
                    disabled={!nextJobDirectionsUrl}
                  >
                    <Navigation className="mr-2 h-4 w-4" />
                    Open directions
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
                <Shield className="h-4 w-4 text-primary" />
                Site Risk Assessment (SWMS / JSA)
              </CardTitle>
              <CardDescription>
                Must be completed before work starts (ISO 45001:2016 aligned).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge
                  variant="outline"
                  className={
                    riskAssessment.completedAt
                      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                      : "bg-amber-500/15 text-amber-300 border-amber-500/30"
                  }
                >
                  {riskAssessment.completedAt ? "Completed" : "Not Completed"}
                </Badge>
                {riskAssessment.completedAt && (
                  <span className="text-muted-foreground">
                    Completed by {riskAssessment.completedBy?.name || "ASI Staff"} on{" "}
                    {formatDate(riskAssessment.completedAt)}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => setShowRiskDialog(true)}>
                  {riskAssessment.completedAt ? "View / Update Assessment" : "Begin Site Risk Assessment"}
                </Button>
                {!riskAssessment.completedAt && (
                  <span className="text-xs text-muted-foreground">
                    Repairs cannot be started until this is completed.
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

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

          <Dialog open={showRiskDialog} onOpenChange={setShowRiskDialog}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Site Risk Assessment (SWMS / JSA)</DialogTitle>
                <DialogDescription>
                  Complete prior to starting work. One assigned staff member can complete on behalf
                  of the team.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-6">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Weather Conditions</Label>
                    <Input
                      value={riskAssessment.siteConditions.weather}
                      onChange={(e) =>
                        setRiskAssessment((prev) => ({
                          ...prev,
                          siteConditions: { ...prev.siteConditions, weather: e.target.value },
                        }))
                      }
                      placeholder="e.g., Clear, light rain, hot"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Lighting</Label>
                    <Select
                      value={riskAssessment.siteConditions.lighting}
                      onValueChange={(val) =>
                        setRiskAssessment((prev) => ({
                          ...prev,
                          siteConditions: {
                            ...prev.siteConditions,
                            lighting: val as "good" | "poor",
                          },
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="good">Good</SelectItem>
                        <SelectItem value="poor">Poor</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={riskAssessment.siteConditions.accessClear}
                      onCheckedChange={(checked) =>
                        setRiskAssessment((prev) => ({
                          ...prev,
                          siteConditions: {
                            ...prev.siteConditions,
                            accessClear: Boolean(checked),
                          },
                        }))
                      }
                    />
                    <Label>Access/egress clear</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={riskAssessment.siteConditions.trafficControlInPlace}
                      onCheckedChange={(checked) =>
                        setRiskAssessment((prev) => ({
                          ...prev,
                          siteConditions: {
                            ...prev.siteConditions,
                            trafficControlInPlace: Boolean(checked),
                          },
                        }))
                      }
                    />
                    <Label>Traffic control in place</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={riskAssessment.siteConditions.emergencyAccessClear}
                      onCheckedChange={(checked) =>
                        setRiskAssessment((prev) => ({
                          ...prev,
                          siteConditions: {
                            ...prev.siteConditions,
                            emergencyAccessClear: Boolean(checked),
                          },
                        }))
                      }
                    />
                    <Label>Emergency access clear</Label>
                  </div>
                </div>

                <div className="space-y-3">
                  <Label>Required PPE</Label>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {[
                      { key: "hiVis", label: "Hi-vis" },
                      { key: "safetyBoots", label: "Safety boots" },
                      { key: "gloves", label: "Gloves" },
                      { key: "eyeProtection", label: "Eye protection" },
                      { key: "hearingProtection", label: "Hearing protection" },
                      { key: "respirator", label: "Respirator" },
                      { key: "hardHat", label: "Hard hat" },
                    ].map((ppe) => (
                      <div key={ppe.key} className="flex items-center gap-2">
                        <Checkbox
                          checked={Boolean(riskAssessment.ppe[ppe.key as keyof JobRiskAssessment["ppe"]])}
                          onCheckedChange={(checked) =>
                            setRiskAssessment((prev) => ({
                              ...prev,
                              ppe: {
                                ...prev.ppe,
                                [ppe.key]: Boolean(checked),
                              },
                            }))
                          }
                        />
                        <Label>{ppe.label}</Label>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <Label>Other PPE</Label>
                    <Input
                      value={riskAssessment.ppe.other}
                      onChange={(e) =>
                        setRiskAssessment((prev) => ({
                          ...prev,
                          ppe: { ...prev.ppe, other: e.target.value },
                        }))
                      }
                      placeholder="e.g., face shield"
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <Label>Hazard Identification & Controls</Label>
                  <div className="space-y-3">
                    {riskAssessment.hazards.map((hazard, index) => (
                      <div
                        key={hazard.id}
                        className="rounded-lg border border-border/50 p-3 space-y-3"
                      >
                        <div className="flex flex-wrap items-center gap-3">
                          <Checkbox
                            checked={hazard.present}
                            onCheckedChange={(checked) =>
                              setRiskAssessment((prev) => {
                                const hazards = [...prev.hazards];
                                hazards[index] = { ...hazard, present: Boolean(checked) };
                                return { ...prev, hazards };
                              })
                            }
                          />
                          <span className="font-medium">{hazard.label}</span>
                          <Select
                            value={hazard.riskLevel}
                            onValueChange={(val) =>
                              setRiskAssessment((prev) => {
                                const hazards = [...prev.hazards];
                                hazards[index] = {
                                  ...hazard,
                                  riskLevel: val as JobRiskAssessmentHazard["riskLevel"],
                                };
                                return { ...prev, hazards };
                              })
                            }
                          >
                            <SelectTrigger className="w-[140px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="low">Low</SelectItem>
                              <SelectItem value="medium">Medium</SelectItem>
                              <SelectItem value="high">High</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">Controls</Label>
                          <Input
                            value={hazard.controls}
                            onChange={(e) =>
                              setRiskAssessment((prev) => {
                                const hazards = [...prev.hazards];
                                hazards[index] = { ...hazard, controls: e.target.value };
                                return { ...prev, hazards };
                              })
                            }
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Additional Controls / Notes</Label>
                  <Textarea
                    value={riskAssessment.additionalControls}
                    onChange={(e) =>
                      setRiskAssessment((prev) => ({
                        ...prev,
                        additionalControls: e.target.value,
                      }))
                    }
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <Label>General Notes</Label>
                  <Textarea
                    value={riskAssessment.notes}
                    onChange={(e) =>
                      setRiskAssessment((prev) => ({
                        ...prev,
                        notes: e.target.value,
                      }))
                    }
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={riskAssessment.supervisorNotified}
                      onCheckedChange={(checked) =>
                        setRiskAssessment((prev) => ({
                          ...prev,
                          supervisorNotified: Boolean(checked),
                        }))
                      }
                    />
                    <Label>Supervisor/site contact notified of risks</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={riskAssessment.stopWorkAuthorityConfirmed}
                      onCheckedChange={(checked) =>
                        setRiskAssessment((prev) => ({
                          ...prev,
                          stopWorkAuthorityConfirmed: Boolean(checked),
                        }))
                      }
                    />
                    <Label>
                      Stop work authority confirmed (unsafe conditions require immediate stop)
                    </Label>
                  </div>
                </div>
              </div>

              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="outline" onClick={() => setShowRiskDialog(false)}>
                  Cancel
                </Button>
                <Button variant="outline" onClick={() => handleSaveRiskAssessment(false)}>
                  Save Draft
                </Button>
                <Button onClick={() => handleSaveRiskAssessment(true)}>
                  Save & Mark Complete
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
                                      <div className="grid gap-2 md:grid-cols-2">
                                        <div className="grid gap-1">
                                          <Label className="text-xs text-muted-foreground">Repair Type</Label>
                                          <Select
                                            value={repair.repairType}
                                            onValueChange={(val) =>
                                              handleUpdateRepairDetails(vehicle.id, repair.id, {
                                                repairType: val as RepairType,
                                              })
                                            }
                                          >
                                            <SelectTrigger className="h-8">
                                              <SelectValue />
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
                                        <div className="grid gap-1">
                                          <Label className="text-xs text-muted-foreground">Location</Label>
                                          <Input
                                            value={repair.location}
                                            onChange={(event) =>
                                              handleUpdateRepairDetails(vehicle.id, repair.id, {
                                                location: event.target.value,
                                              })
                                            }
                                            className="h-8"
                                          />
                                        </div>
                                      </div>
                                      <div className="grid gap-1 pt-2">
                                        <Label className="text-xs text-muted-foreground">Description</Label>
                                        <Textarea
                                          value={repair.description || ""}
                                          onChange={(event) =>
                                            handleUpdateRepairDetails(vehicle.id, repair.id, {
                                              description: event.target.value,
                                            })
                                          }
                                          rows={2}
                                        />
                                      </div>
                                      {repair.repairType === "film_installation" && (
                                        <div className="grid gap-2 pt-2 md:grid-cols-2">
                                          <div className="grid gap-1">
                                            <Label className="text-xs text-muted-foreground">Film product</Label>
                                            <Select
                                              value={repair.filmProduct || ""}
                                              onValueChange={(val) =>
                                                handleUpdateRepairDetails(vehicle.id, repair.id, {
                                                  filmProduct: val as RepairSite["filmProduct"],
                                                })
                                              }
                                            >
                                              <SelectTrigger className="h-8">
                                                <SelectValue placeholder="Select film" />
                                              </SelectTrigger>
                                              <SelectContent>
                                                <SelectItem value="optishield">Optishield</SelectItem>
                                                <SelectItem value="grafshield">Grafshield</SelectItem>
                                                <SelectItem value="bodyshield">BodyShield</SelectItem>
                                                <SelectItem value="radshield">Radshield</SelectItem>
                                              </SelectContent>
                                            </Select>
                                          </div>
                                          <div className="grid gap-1">
                                            <Label className="text-xs text-muted-foreground">
                                              Tint removal required?
                                            </Label>
                                            <Select
                                              value={repair.tintRemovalRequired ? "yes" : "no"}
                                              onValueChange={(val) =>
                                                handleUpdateRepairDetails(vehicle.id, repair.id, {
                                                  tintRemovalRequired: val === "yes",
                                                })
                                              }
                                            >
                                              <SelectTrigger className="h-8">
                                                <SelectValue />
                                              </SelectTrigger>
                                              <SelectContent>
                                                <SelectItem value="yes">Yes</SelectItem>
                                                <SelectItem value="no">No</SelectItem>
                                              </SelectContent>
                                            </Select>
                                          </div>
                                          <div className="grid gap-1">
                                            <Label className="text-xs text-muted-foreground">
                                              Substrate QA passed?
                                            </Label>
                                            <Select
                                              value={repair.substrateQaPassed ? "yes" : "no"}
                                              onValueChange={(val) =>
                                                handleUpdateRepairDetails(vehicle.id, repair.id, {
                                                  substrateQaPassed: val === "yes",
                                                })
                                              }
                                            >
                                              <SelectTrigger className="h-8">
                                                <SelectValue />
                                              </SelectTrigger>
                                              <SelectContent>
                                                <SelectItem value="yes">Yes</SelectItem>
                                                <SelectItem value="no">No</SelectItem>
                                              </SelectContent>
                                            </Select>
                                          </div>
                                          {!repair.substrateQaPassed && (
                                            <div className="grid gap-1">
                                              <Label className="text-xs text-muted-foreground">
                                                Remediation type
                                              </Label>
                                              <Select
                                                value={repair.remediationType || ""}
                                                onValueChange={(val) =>
                                                  handleUpdateRepairDetails(vehicle.id, repair.id, {
                                                    remediationType: val as RepairSite["remediationType"],
                                                  })
                                                }
                                              >
                                                <SelectTrigger className="h-8">
                                                  <SelectValue placeholder="Select remediation" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                  <SelectItem value="scratch_removal">Scratch Removal</SelectItem>
                                                  <SelectItem value="decontamination">Decontamination</SelectItem>
                                                  <SelectItem value="prep_polish">Prep-Polish</SelectItem>
                                                  <SelectItem value="none">None</SelectItem>
                                                </SelectContent>
                                              </Select>
                                            </div>
                                          )}
                                        </div>
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
                                          <div
                                            key={`${url}-${idx}`}
                                            className="relative h-16 w-16 overflow-hidden rounded border border-border/50"
                                          >
                                            <button
                                              type="button"
                                              className="h-full w-full"
                                              onClick={() => setPhotoPreview({ url, label: "Pre-Work Photo" })}
                                            >
                                              <img
                                                src={url}
                                                alt="Pre-work"
                                                className="h-full w-full object-cover"
                                                loading="lazy"
                                              />
                                            </button>
                                            <button
                                              type="button"
                                              className="absolute -right-2 -top-2 h-5 w-5 rounded-full bg-destructive text-xs text-white"
                                              onClick={() =>
                                                handleRemoveRepairPhoto(vehicle.id, repair.id, "pre", url)
                                              }
                                            >
                                              ×
                                            </button>
                                          </div>
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
                                          <div
                                            key={`${url}-${idx}`}
                                            className="relative h-16 w-16 overflow-hidden rounded border border-border/50"
                                          >
                                            <button
                                              type="button"
                                              className="h-full w-full"
                                              onClick={() => setPhotoPreview({ url, label: "Post-Work Photo" })}
                                            >
                                              <img
                                                src={url}
                                                alt="Post-work"
                                                className="h-full w-full object-cover"
                                                loading="lazy"
                                              />
                                            </button>
                                            <button
                                              type="button"
                                              className="absolute -right-2 -top-2 h-5 w-5 rounded-full bg-destructive text-xs text-white"
                                              onClick={() =>
                                                handleRemoveRepairPhoto(vehicle.id, repair.id, "post", url)
                                              }
                                            >
                                              ×
                                            </button>
                                          </div>
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
                                <div className="grid grid-cols-1 gap-4 pt-2 border-t">
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
                                </div>
                                </CardContent>
                              </Card>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Consumables Used */}
                    <div className="space-y-3">
                      <Label className="text-sm font-medium">Consumables Used</Label>
                      <Card className="bg-muted/20">
                        <CardContent className="space-y-4 p-4">
                          {vehicleHasScratchGraffitiRepair(vehicle) && (
                            <div className="space-y-3">
                              <p className="text-xs font-semibold uppercase text-muted-foreground">
                                Microfibre Disks
                              </p>
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
                                              value={
                                                getMicrofiberQuantity(
                                                  vehicle,
                                                  grade.value,
                                                  size.value
                                                ) || ""
                                              }
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
                            </div>
                          )}

                          <div className="space-y-2">
                            <p className="text-xs font-semibold uppercase text-muted-foreground">
                              Other Consumables
                            </p>
                            <div className="space-y-2">
                              {(vehicle.consumablesUsed || []).map((consumable, index) => (
                                <div
                                  key={`${vehicle.id}-consumable-${index}`}
                                  className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_auto]"
                                >
                                  <Input
                                    placeholder="Item"
                                    value={consumable.item}
                                    onChange={(e) =>
                                      handleUpdateConsumable(vehicle.id, index, {
                                        item: e.target.value,
                                      })
                                    }
                                    className="h-8"
                                  />
                                  <Input
                                    placeholder="Qty"
                                    type="number"
                                    min="0"
                                    value={consumable.quantity}
                                    onChange={(e) =>
                                      handleUpdateConsumable(vehicle.id, index, {
                                        quantity: Number.parseFloat(e.target.value) || 0,
                                      })
                                    }
                                    className="h-8"
                                  />
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => handleRemoveConsumable(vehicle.id, index)}
                                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              ))}

                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_auto]">
                                <Input
                                  placeholder="Item"
                                  value={consumableDrafts[vehicle.id]?.item || ""}
                                  onChange={(e) =>
                                    setConsumableDrafts((prev) => ({
                                      ...prev,
                                      [vehicle.id]: {
                                        item: e.target.value,
                                        quantity: prev[vehicle.id]?.quantity || "",
                                      },
                                    }))
                                  }
                                  className="h-8"
                                />
                                <Input
                                  placeholder="Qty"
                                  type="number"
                                  min="0"
                                  value={consumableDrafts[vehicle.id]?.quantity || ""}
                                  onChange={(e) =>
                                    setConsumableDrafts((prev) => ({
                                      ...prev,
                                      [vehicle.id]: {
                                        item: prev[vehicle.id]?.item || "",
                                        quantity: e.target.value,
                                      },
                                    }))
                                  }
                                  className="h-8"
                                />
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="outline"
                                  onClick={() => handleAddConsumable(vehicle.id)}
                                  className="h-8 w-8"
                                >
                                  <Plus className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>

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
                <Mail className="h-5 w-5 text-primary" />
                Client Notification Sends
              </CardTitle>
              <CardDescription>
                Send manual status updates to the client (in-app + email).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>Client:</span>
                <span className="font-medium text-foreground">
                  {job.clientEmail || "Organization-linked users"}
                </span>
                <Badge variant="outline" className={statusColors[job.status]}>
                  {job.status.replace("_", " ").toUpperCase()}
                </Badge>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <Button
                  variant="outline"
                  onClick={() => handleSendClientNotice("job_started")}
                  disabled={sendingClientNotice !== null}
                >
                  <Mail className="mr-2 h-4 w-4" />
                  {sendingClientNotice === "job_started" ? "Sending..." : "Send Started Update"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleSendClientNotice("job_on_hold")}
                  disabled={sendingClientNotice !== null}
                >
                  <Mail className="mr-2 h-4 w-4" />
                  {sendingClientNotice === "job_on_hold" ? "Sending..." : "Send On-Hold Update"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleSendClientNotice("job_completed")}
                  disabled={sendingClientNotice !== null}
                >
                  <Mail className="mr-2 h-4 w-4" />
                  {sendingClientNotice === "job_completed"
                    ? "Sending..."
                    : "Send Completion Update"}
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">
                These updates only send when you click. Automatic emails remain off.
              </div>
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

          {user?.role === "admin" && (job.status === "completed" || job.status === "closed") && (
            <Card className="bg-card/50 backdrop-blur">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bot className="h-5 w-5 text-primary" />
                  Completion Audit (AI)
                </CardTitle>
                <CardDescription>
                  Quick audit for compliance, billing readiness, and improvement opportunities.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {completionAudit ? (
                  <>
                    <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                      <Badge
                        variant="outline"
                        className={
                          completionAudit.status === "needs_attention"
                            ? "border-amber-500/40 text-amber-300"
                            : "border-emerald-500/40 text-emerald-300"
                        }
                      >
                        {completionAudit.status === "needs_attention"
                          ? "Needs attention"
                          : "Pass"}
                      </Badge>
                      <span>
                        Generated: {formatDateTime(completionAudit.generatedAt)}
                      </span>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <div className="text-xs uppercase text-muted-foreground">
                          Compliance checks
                        </div>
                        <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                          {(auditCompliance.length
                            ? auditCompliance
                            : ["No compliance gaps flagged."])}
                        </ul>
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs uppercase text-muted-foreground">
                          Issues & risks
                        </div>
                        <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                          {(auditIssues.length
                            ? auditIssues
                            : ["No critical issues flagged."])}
                        </ul>
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs uppercase text-muted-foreground">
                          Billing notes
                        </div>
                        <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                          {(auditBilling.length
                            ? auditBilling
                            : ["No billing notes flagged."])}
                        </ul>
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs uppercase text-muted-foreground">
                          Commercial opportunities
                        </div>
                        <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                          {(auditOpportunities.length
                            ? auditOpportunities
                            : ["No opportunities flagged."])}
                        </ul>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-xs uppercase text-muted-foreground">
                        Continuous improvement
                      </div>
                      <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                        {(auditImprovements.length
                          ? auditImprovements
                          : ["No improvement actions flagged."])}
                      </ul>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No audit has been generated for this job yet.
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => triggerCompletionAudit("manual")}
                    disabled={auditRunning}
                  >
                    {auditRunning ? "Running audit..." : "Run completion audit"}
                  </Button>
                  {auditError && <span className="text-xs text-destructive">{auditError}</span>}
                </div>
              </CardContent>
            </Card>
          )}
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
            {newRepair.repairType === "film_installation" && (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Film product *</Label>
                  <Select
                    value={newRepair.filmProduct}
                    onValueChange={(val) =>
                      setNewRepair({ ...newRepair, filmProduct: val as RepairSite["filmProduct"] })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select film" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="optishield">Optishield</SelectItem>
                      <SelectItem value="grafshield">Grafshield</SelectItem>
                      <SelectItem value="bodyshield">BodyShield</SelectItem>
                      <SelectItem value="radshield">Radshield</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Existing tint removal required?</Label>
                  <Select
                    value={newRepair.tintRemovalRequired ? "yes" : "no"}
                    onValueChange={(val) =>
                      setNewRepair({ ...newRepair, tintRemovalRequired: val === "yes" })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yes">Yes</SelectItem>
                      <SelectItem value="no">No</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Substrate QA passed?</Label>
                  <Select
                    value={newRepair.substrateQaPassed ? "yes" : "no"}
                    onValueChange={(val) =>
                      setNewRepair({ ...newRepair, substrateQaPassed: val === "yes" })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yes">Yes</SelectItem>
                      <SelectItem value="no">No</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {!newRepair.substrateQaPassed && (
                  <div className="grid gap-2">
                    <Label>Remediation type *</Label>
                    <Select
                      value={newRepair.remediationType}
                      onValueChange={(val) =>
                        setNewRepair({
                          ...newRepair,
                          remediationType: val as RepairSite["remediationType"],
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select remediation" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="scratch_removal">Scratch Removal</SelectItem>
                        <SelectItem value="decontamination">Decontamination</SelectItem>
                        <SelectItem value="prep_polish">Prep-Polish</SelectItem>
                        <SelectItem value="none">None</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}
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

      {(user?.role === "admin" || user?.role === "technician") && (
        <Sheet>
          <SheetTrigger asChild>
            <Button
              className="fixed bottom-6 right-6 z-40 rounded-full shadow-lg"
              size="lg"
            >
              <Bot className="mr-2 h-4 w-4" />
              Assistant
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>ASI Knowledge Assistant</SheetTitle>
              <SheetDescription>
                Technical procedures, QA support, and job guidance in one place.
              </SheetDescription>
            </SheetHeader>
            <div className="mt-4">
              <InternalKnowledgeAssistant
                context="job"
                jobId={job.id}
                variant="embedded"
                compact={false}
                className="rounded-2xl border border-border/30 bg-background/40 p-4"
              />
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
