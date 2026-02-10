
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import {
  ArrowLeft,
  Briefcase,
  Calendar as CalendarIcon,
  Camera,
  Car,
  CheckCircle,
  ClipboardCheck,
  FileText,
  Plus,
  Trash2,
  Upload,
  User,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useJobs } from "@/contexts/JobsContext";
import { generateInspectionSummaryAction } from "@/app/actions/ai";
import { db, storage } from "@/lib/firebaseClient";
import { buildFleetDocId, getFleetSeedForOrgName, normalizeVehicleKey } from "@/lib/fleet-data";
import { COLLECTIONS, generateBookingNumber, generateJobNumber } from "@/lib/firestore";
import {
  BOOKING_TYPE_LABELS,
  calculateCostBreakdown,
  ContactCategory,
  CONTACT_CATEGORY_LABELS,
  ContactOrganization,
  DamageItem,
  DamageReportItem,
  FleetVehicle,
  Inspection,
  InspectionStatus,
  OrganizationContact,
  RepairType,
  SiteLocation,
  Vehicle,
  VehicleReport,
} from "@/lib/types";
import { createWorksRegisterEntry } from "@/lib/jobs-data";

type StaffMember = {
  id: string;
  name: string;
  type: "asi_staff" | "subcontractor";
  email?: string;
};

const STATUS_BADGE: Record<InspectionStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  approved: "bg-green-500/20 text-green-400 border-green-500/30",
  converted: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  rejected: "bg-red-500/20 text-red-400 border-red-500/30",
};

const timeSlots = [
  "07:00", "07:30", "08:00", "08:30", "09:00", "09:30",
  "10:00", "10:30", "11:00", "11:30", "12:00", "12:30",
  "13:00", "13:30", "14:00", "14:30", "15:00", "15:30",
  "16:00", "16:30", "17:00",
];

const DEFAULT_INSPECTION_BOOKING_TYPE: RepairType = "scratch_graffiti_removal";

function deriveBookingTypeFromVehicleReports(reports: VehicleReport[]): RepairType {
  const weights = new Map<RepairType, number>();
  reports.forEach((report) => {
    report.damages.forEach((damage) => {
      const weight = damage.totalCost ?? damage.estimatedCost ?? 1;
      weights.set(damage.repairType, (weights.get(damage.repairType) ?? 0) + weight);
    });
  });

  if (weights.size === 0) return DEFAULT_INSPECTION_BOOKING_TYPE;

  let bestType: RepairType = DEFAULT_INSPECTION_BOOKING_TYPE;
  let bestWeight = -1;
  weights.forEach((weight, type) => {
    if (weight > bestWeight) {
      bestWeight = weight;
      bestType = type;
    }
  });

  return bestType;
}

function isTraversableObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (value instanceof Timestamp) return false;
  if (value instanceof Date) return false;
  if (Array.isArray(value)) return false;
  return true;
}

function pruneUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((item) => pruneUndefined(item))
      .filter((item) => item !== undefined) as unknown as T;
  }

  if (isTraversableObject(value)) {
    const cleaned: Record<string, unknown> = {};
    Object.entries(value).forEach(([key, val]) => {
      if (val === undefined) return;
      const nextVal = pruneUndefined(val);
      if (nextVal !== undefined) {
        cleaned[key] = nextVal;
      }
    });
    return cleaned as T;
  }

  return value;
}

export default function InspectionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const { updateJobStatus, updateJob, worksRegister, getJobById, deleteJob } = useJobs();
  const inspectionId = params.id as string;

  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [loading, setLoading] = useState(true);
  const [organizations, setOrganizations] = useState<ContactOrganization[]>([]);
  const [contacts, setContacts] = useState<OrganizationContact[]>([]);
  const [userStaffList, setUserStaffList] = useState<StaffMember[]>([]);
  const [asiContactStaffList, setAsiContactStaffList] = useState<StaffMember[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [selectedOrganization, setSelectedOrganization] = useState<ContactOrganization | null>(null);
  const [selectedContact, setSelectedContact] = useState<OrganizationContact | null>(null);
  const selectedOrgId = selectedOrganization?.id ?? inspection?.organizationId ?? "";
  const selectedOrgName =
    selectedOrganization?.name ?? inspection?.organizationName ?? inspection?.clientName ?? "";
  const [selectedSite, setSelectedSite] = useState<SiteLocation | null>(null);
  const [scheduledDate, setScheduledDate] = useState<Date | undefined>();
  const [scheduledTime, setScheduledTime] = useState("");
  const [selectedStaff, setSelectedStaff] = useState<StaffMember[]>([]);
  const [notes, setNotes] = useState("");
  const [reportSummary, setReportSummary] = useState("");
  const [summaryGenerating, setSummaryGenerating] = useState(false);
  const [vehicleReports, setVehicleReports] = useState<VehicleReport[]>([]);
  const [showAddVehicleDialog, setShowAddVehicleDialog] = useState(false);
  const [showAddDamageDialog, setShowAddDamageDialog] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [uploadingPhotos, setUploadingPhotos] = useState<Record<string, boolean>>({});
  const [photoPreview, setPhotoPreview] = useState<{ url: string; label: string } | null>(null);
  const [showRecycleDialog, setShowRecycleDialog] = useState(false);
  const [linkedBookingId, setLinkedBookingId] = useState<string | null>(null);
  const [bookingSyncing, setBookingSyncing] = useState(false);
  const [showNewContactDialog, setShowNewContactDialog] = useState(false);
  const [isCreatingNewOrg, setIsCreatingNewOrg] = useState(false);
  const [newContactData, setNewContactData] = useState({
    organisationId: "",
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    mobile: "",
    jobTitle: "",
  });
  const [newOrgData, setNewOrgData] = useState({
    name: "",
    category: "trade_client" as ContactCategory,
    abn: "",
    phone: "",
    email: "",
    street: "",
    suburb: "",
    state: "VIC",
    postcode: "",
  });
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
  const [newDamage, setNewDamage] = useState({
    repairType: "" as RepairType | "",
    location: "",
    description: "",
    totalCost: "",
  });

  useEffect(() => {
    const inspectionRef = doc(db, COLLECTIONS.INSPECTIONS, inspectionId);
    const unsubscribe = onSnapshot(
      inspectionRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setInspection(null);
          setLoading(false);
          return;
        }
        const data = snapshot.data() as Omit<Inspection, "id">;
        setInspection({ id: snapshot.id, ...data });
        setLoading(false);
      },
      (error) => {
        console.warn("Failed to load inspection:", error);
        setInspection(null);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [inspectionId]);

  useEffect(() => {
    const orgQuery = query(
      collection(db, COLLECTIONS.CONTACT_ORGANIZATIONS),
      orderBy("name", "asc")
    );
    const unsubscribe = onSnapshot(orgQuery, (snapshot) => {
      const loaded = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<ContactOrganization, "id">),
      }));
      setOrganizations(loaded);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!selectedOrganization) {
      setContacts([]);
      return;
    }
    const contactQuery = query(
      collection(db, COLLECTIONS.ORGANIZATION_CONTACTS),
      where("organizationId", "==", selectedOrganization.id)
    );
    const unsubscribe = onSnapshot(contactQuery, (snapshot) => {
      const loaded = snapshot.docs
        .map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<OrganizationContact, "id">),
        }))
        .sort((a, b) =>
          `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)
        );
      setContacts(loaded);
    });
    return () => unsubscribe();
  }, [selectedOrganization]);

  useEffect(() => {
    const usersQuery = query(
      collection(db, COLLECTIONS.USERS),
      where("role", "in", ["technician", "contractor", "admin"])
    );
    const unsubscribe = onSnapshot(
      usersQuery,
      (snapshot) => {
        const loaded = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as { name?: string; email?: string; role?: string };
          return {
            id: docSnap.id,
            name: data.name || data.email || "Staff",
            type: data.role === "contractor" ? "subcontractor" : "asi_staff",
            email: data.email,
          } satisfies StaffMember;
        });
        setUserStaffList(loaded.sort((a, b) => a.name.localeCompare(b.name)));
      },
      (error) => {
        console.warn("Failed to load staff list:", error);
        setUserStaffList([]);
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const asiOrgIds = organizations
      .filter(
        (org) =>
          org.category === "asi_staff" ||
          org.domains?.some(
            (domain) => domain.toLowerCase().trim() === "asi-australia.com.au"
          )
      )
      .map((org) => org.id);

    if (asiOrgIds.length === 0) {
      setAsiContactStaffList([]);
      return;
    }

    const staffByOrg = new Map<string, StaffMember[]>();
    const mergeStaff = () => {
      const merged = new Map<string, StaffMember>();
      for (const orgStaff of staffByOrg.values()) {
        orgStaff.forEach((staff) => {
          const key = staff.email?.toLowerCase().trim() || staff.id;
          if (!merged.has(key)) {
            merged.set(key, staff);
          }
        });
      }
      setAsiContactStaffList(
        Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name))
      );
    };

    const unsubscribers = asiOrgIds.map((orgId) => {
      const contactQuery = query(
        collection(db, COLLECTIONS.ORGANIZATION_CONTACTS),
        where("organizationId", "==", orgId)
      );

      return onSnapshot(
        contactQuery,
        (snapshot) => {
          const loaded = snapshot.docs.reduce<StaffMember[]>((acc, docSnap) => {
            const data = docSnap.data() as OrganizationContact;
            if (data.status === "inactive") return acc;
            const fullName = `${data.firstName} ${data.lastName}`.trim();
            acc.push({
              id: data.portalUserId || docSnap.id,
              name: fullName || data.email || "Staff",
              type: "asi_staff",
              email: data.email || undefined,
            });
            return acc;
          }, []);
          loaded.sort((a, b) => a.name.localeCompare(b.name));
          staffByOrg.set(orgId, loaded);
          mergeStaff();
        },
        (error) => {
          console.warn("Failed to load ASI contact staff:", error);
          staffByOrg.set(orgId, []);
          mergeStaff();
        }
      );
    });

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [organizations]);

  useEffect(() => {
    const merged = new Map<string, StaffMember>();
    const addStaff = (staff: StaffMember) => {
      const key = staff.email?.toLowerCase().trim() || staff.id;
      if (!merged.has(key)) {
        merged.set(key, staff);
      }
    };

    userStaffList.forEach(addStaff);
    asiContactStaffList.forEach(addStaff);
    setStaffList(Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name)));
  }, [userStaffList, asiContactStaffList]);

  useEffect(() => {
    if (!inspection) return;
    const toDateValue = (value?: unknown) => {
      if (!value) return undefined;
      if (value instanceof Timestamp) return value.toDate();
      if (value instanceof Date) return value;
      const seconds = (value as { seconds?: unknown }).seconds;
      const nanoseconds = (value as { nanoseconds?: unknown }).nanoseconds;
      if (typeof seconds === "number" && typeof nanoseconds === "number") {
        return new Timestamp(seconds, nanoseconds).toDate();
      }
      const hasToDate = (value as { toDate?: () => Date }).toDate;
      if (typeof hasToDate === "function") return hasToDate.call(value);
      if (typeof value === "string" || typeof value === "number") {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? undefined : date;
      }
      return undefined;
    };
    setVehicleReports(inspection.vehicleReports || []);
    setNotes(inspection.notes || "");
    setReportSummary(inspection.reportSummary || "");
    setScheduledDate(toDateValue(inspection.scheduledDate));
    setScheduledTime(inspection.scheduledTime || "");
    setSelectedStaff(inspection.assignedStaff || []);
  }, [inspection]);

  useEffect(() => {
    const jobId = inspection?.convertedToJobId;
    if (!jobId) {
      setLinkedBookingId(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const bookingQuery = query(
          collection(db, COLLECTIONS.BOOKINGS),
          where("convertedJobId", "==", jobId),
          limit(1)
        );
        const snap = await getDocs(bookingQuery);
        if (cancelled) return;
        setLinkedBookingId(snap.empty ? null : snap.docs[0].id);
      } catch (error) {
        if (cancelled) return;
        console.warn("Failed to resolve linked booking:", error);
        setLinkedBookingId(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [inspection?.convertedToJobId]);

  useEffect(() => {
    if (!inspection || organizations.length === 0) return;
    const matchedOrg =
      organizations.find((org) => org.id === inspection.organizationId) || null;
    setSelectedOrganization(matchedOrg);
    if (matchedOrg) {
      const defaultSite = matchedOrg.sites.find((site) => site.isDefault) || matchedOrg.sites[0];
      const resolvedSite =
        defaultSite && matchedOrg.address && defaultSite.isDefault
          ? { ...defaultSite, address: matchedOrg.address }
          : defaultSite;
      setSelectedSite(resolvedSite || null);
    }
  }, [inspection, organizations]);

  useEffect(() => {
    if (!inspection || contacts.length === 0) return;
    const matchedContact =
      contacts.find((contact) => contact.id === inspection.contactId) ||
      contacts.find((contact) => contact.isPrimary) ||
      null;
    setSelectedContact(matchedContact);
  }, [inspection, contacts]);

  useEffect(() => {
    setFleetSeeded(false);
  }, [selectedOrgId]);

  useEffect(() => {
    if (!selectedOrgId) {
      setFleetVehicles([]);
      return;
    }
    const fleetQuery = query(
      collection(db, COLLECTIONS.FLEET_VEHICLES),
      where("organizationId", "==", selectedOrgId)
    );
    const unsubscribe = onSnapshot(fleetQuery, (snapshot) => {
      const loaded = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<FleetVehicle, "id">),
      }));
      setFleetVehicles(loaded);
    });
    return () => unsubscribe();
  }, [selectedOrgId]);

  useEffect(() => {
    if (!selectedOrgId || !selectedOrgName) return;
    if (fleetVehicles.length > 0 || fleetSeeded) return;
    const seeds = getFleetSeedForOrgName(selectedOrgName);
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
            const docId = buildFleetDocId(selectedOrgId, vehicle.registration);
            const docRef = doc(db, COLLECTIONS.FLEET_VEHICLES, docId);
            const payload: Record<string, unknown> = {
              organizationId: selectedOrgId,
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
  }, [selectedOrgId, selectedOrgName, fleetSeeded, fleetVehicles.length]);

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
      ? getFleetSeedForOrgName(selectedOrgName).find((vehicle) => {
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

  const totals = useMemo(() => {
    let totalCost = 0;
    let totalLabour = 0;
    let totalMaterials = 0;
    vehicleReports.forEach((vehicle) => {
      vehicle.damages.forEach((damage) => {
        const cost = damage.totalCost ?? damage.estimatedCost ?? 0;
        const breakdown = calculateCostBreakdown(cost);
        totalCost += cost;
        totalLabour += damage.labourCost ?? breakdown.labourCost;
        totalMaterials += damage.materialsCost ?? breakdown.materialsCost;
      });
    });
    return { totalCost, totalLabour, totalMaterials };
  }, [vehicleReports]);

  const handleSelectOrganization = (orgId: string) => {
    const org = organizations.find((item) => item.id === orgId) || null;
    setSelectedOrganization(org);
    setSelectedContact(null);
    if (org) {
      const defaultSite = org.sites.find((site) => site.isDefault) || org.sites[0];
      const resolvedSite =
        defaultSite && org.address && defaultSite.isDefault
          ? { ...defaultSite, address: org.address }
          : defaultSite;
      setSelectedSite(resolvedSite || null);
    }
  };

  const handleToggleStaff = (staff: StaffMember) => {
    setSelectedStaff((prev) => {
      const exists = prev.find((item) => item.id === staff.id);
      if (exists) return prev.filter((item) => item.id !== staff.id);
      return [...prev, staff];
    });
  };
  const handleAddVehicle = () => {
    if (!newVehicle.registration.trim()) {
      toast({
        title: "Missing vehicle details",
        description: "Add the registration before saving.",
        variant: "destructive",
      });
      return;
    }
    const vehicle: Vehicle = {
      registration: newVehicle.registration.trim().toUpperCase(),
      vin: newVehicle.vin.trim().toUpperCase() || undefined,
      fleetAssetNumber: newVehicle.fleetAssetNumber.trim() || undefined,
      bodyManufacturer: newVehicle.bodyManufacturer.trim() || undefined,
      year: newVehicle.year ? parseInt(newVehicle.year, 10) : undefined,
      poWorksOrderNumber: newVehicle.poWorksOrderNumber.trim() || undefined,
    };
    const report: VehicleReport = {
      vehicleId: `vehicle-${Date.now()}`,
      vehicle,
      damages: [],
      overallCondition: "good",
    };
    setVehicleReports((prev) => [...prev, report]);
    setShowAddVehicleDialog(false);
    setNewVehicle({
      registration: "",
      vin: "",
      fleetAssetNumber: "",
      bodyManufacturer: "",
      year: "",
      poWorksOrderNumber: "",
    });
  };

  const handleAddDamage = () => {
    if (!selectedVehicleId) return;
    if (!newDamage.repairType || !newDamage.location) {
      toast({
        title: "Missing damage details",
        description: "Add a repair type and location before saving.",
        variant: "destructive",
      });
      return;
    }
    const cost = parseFloat(newDamage.totalCost) || 0;
    const { labourCost, materialsCost } = calculateCostBreakdown(cost);
    const damage: DamageReportItem = {
      id: `damage-${Date.now()}`,
      repairType: newDamage.repairType as RepairType,
      location: newDamage.location,
      description: newDamage.description,
      severity: "minor",
      photoUrls: [],
      preWorkPhotos: [],
      postWorkPhotos: [],
      totalCost: cost,
      estimatedCost: cost,
      labourCost,
      materialsCost,
    };
    setVehicleReports((prev) =>
      prev.map((vehicle) =>
        vehicle.vehicleId === selectedVehicleId
          ? { ...vehicle, damages: [...vehicle.damages, damage] }
          : vehicle
      )
    );
    setShowAddDamageDialog(false);
    setNewDamage({
      repairType: "",
      location: "",
      description: "",
      totalCost: "",
    });
  };

  const handleDeleteVehicle = (vehicleId: string) => {
    setVehicleReports((prev) => prev.filter((vehicle) => vehicle.vehicleId !== vehicleId));
  };

  const handleDeleteDamage = (vehicleId: string, damageId: string) => {
    setVehicleReports((prev) =>
      prev.map((vehicle) =>
        vehicle.vehicleId === vehicleId
          ? { ...vehicle, damages: vehicle.damages.filter((damage) => damage.id !== damageId) }
          : vehicle
      )
    );
  };

  const handleUpdateDamageCost = (
    vehicleId: string,
    damageId: string,
    newCost: number
  ) => {
    const { labourCost, materialsCost } = calculateCostBreakdown(newCost);
    setVehicleReports((prev) =>
      prev.map((vehicle) => {
        if (vehicle.vehicleId !== vehicleId) return vehicle;
        const damages = vehicle.damages.map((damage) =>
          damage.id === damageId
            ? {
                ...damage,
                totalCost: newCost,
                estimatedCost: newCost,
                labourCost,
                materialsCost,
              }
            : damage
        );
        return { ...vehicle, damages };
      })
    );
  };

  const handleDamagePhotoUpload = async (
    vehicleId: string,
    damageId: string,
    kind: "pre" | "post",
    files: FileList | null
  ) => {
    if (!files || files.length === 0) return;
    const key = `${vehicleId}-${damageId}-${kind}`;
    setUploadingPhotos((prev) => ({ ...prev, [key]: true }));

    try {
      const uploadedUrls = await Promise.all(
        Array.from(files).map(async (file) => {
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
          const path = `inspections/${inspectionId}/vehicles/${vehicleId}/repairs/${damageId}/${kind}/${Date.now()}-${safeName}`;
          const fileRef = ref(storage, path);
          await uploadBytes(fileRef, file, { contentType: file.type });
          return getDownloadURL(fileRef);
        })
      );

      setVehicleReports((prev) =>
        prev.map((vehicle) => {
          if (vehicle.vehicleId !== vehicleId) return vehicle;
          const damages = vehicle.damages.map((damage) => {
            if (damage.id !== damageId) return damage;
            const existingPre = damage.preWorkPhotos ?? damage.photoUrls ?? [];
            const existingPost = damage.postWorkPhotos ?? [];
            if (kind === "pre") {
              return { ...damage, preWorkPhotos: [...existingPre, ...uploadedUrls] };
            }
            return { ...damage, postWorkPhotos: [...existingPost, ...uploadedUrls] };
          });
          return { ...vehicle, damages };
        })
      );
    } catch (error: any) {
      toast({
        title: "Photo upload failed",
        description: error.message || "Unable to upload photos. Please try again.",
        variant: "destructive",
      });
    } finally {
      setUploadingPhotos((prev) => ({ ...prev, [key]: false }));
    }
  };

  const buildInspectionPayload = (statusOverride?: InspectionStatus) => {
    if (!inspection) return null;
    const organizationName = selectedOrganization?.name || inspection.organizationName || "";
    const contactName = selectedContact
      ? `${selectedContact.firstName} ${selectedContact.lastName}`.trim()
      : inspection.contactName || "";
    const contactEmail = selectedContact?.email || inspection.clientEmail || "";
    const contactPhone = selectedContact?.mobile || selectedContact?.phone || inspection.clientPhone;
    const siteLocation = selectedSite
      ? { name: selectedSite.name, address: selectedSite.address }
      : inspection.siteLocation;

    const payload = {
      organizationId: selectedOrganization?.id,
      organizationName,
      contactId: selectedContact?.id,
      contactName,
      clientId: selectedOrganization?.id || inspection.clientId,
      clientName: organizationName || inspection.clientName,
      clientEmail: contactEmail,
      clientPhone: contactPhone,
      scheduledDate: scheduledDate ? Timestamp.fromDate(scheduledDate) : undefined,
      scheduledTime: scheduledTime || undefined,
      assignedStaff: selectedStaff,
      assignedStaffIds: selectedStaff.map((staff) => staff.id),
      notes: notes || undefined,
      siteLocation,
      vehicleReports,
      status: statusOverride || inspection.status,
      updatedAt: Timestamp.now(),
    };
    return pruneUndefined(payload) as Partial<Inspection>;
  };

  const upsertBookingForConvertedJob = async (jobId: string) => {
    if (!inspection) return null;

    const resolvedOrgId = selectedOrganization?.id || inspection.organizationId || inspection.clientId || "";
    const resolvedOrgName =
      selectedOrganization?.name || inspection.organizationName || inspection.clientName || "";
    const resolvedContactId = selectedContact?.id || inspection.contactId || "";
    const resolvedContactName = selectedContact
      ? `${selectedContact.firstName} ${selectedContact.lastName}`.trim()
      : inspection.contactName || "";
    const resolvedContactEmail = selectedContact?.email || inspection.clientEmail || "";
    const resolvedContactPhone =
      selectedContact?.mobile || selectedContact?.phone || inspection.clientPhone || undefined;

    const resolvedScheduledDate =
      scheduledDate ||
      (() => {
        const value = inspection.scheduledDate;
        if (!value) return undefined;
        if (value instanceof Timestamp) return value.toDate();
        const seconds = (value as { seconds?: unknown }).seconds;
        const nanoseconds = (value as { nanoseconds?: unknown }).nanoseconds;
        if (typeof seconds === "number" && typeof nanoseconds === "number") {
          return new Timestamp(seconds, nanoseconds).toDate();
        }
        const hasToDate = (value as { toDate?: () => Date }).toDate;
        if (typeof hasToDate === "function") return hasToDate.call(value);
        return undefined;
      })();

    const resolvedScheduledTime = scheduledTime || inspection.scheduledTime || "";
    const allocatedStaff = selectedStaff.length > 0 ? selectedStaff : inspection.assignedStaff || [];

    const resolvedSiteLocation = selectedSite
      ? {
          id: selectedSite.id,
          name: selectedSite.name,
          address: selectedSite.address,
        }
      : inspection.siteLocation
        ? {
            name: inspection.siteLocation.name,
            address: inspection.siteLocation.address,
          }
        : selectedOrganization?.address
          ? {
              name: resolvedOrgName || "Site",
              address: selectedOrganization.address,
            }
          : null;

    if (!resolvedOrgId || !resolvedOrgName) {
      throw new Error("Missing organisation details for booking creation.");
    }
    if (!resolvedContactEmail) {
      throw new Error("Missing contact email for booking creation.");
    }
    if (!resolvedScheduledDate || !resolvedScheduledTime) {
      throw new Error("Missing schedule details for booking creation.");
    }
    if (!resolvedSiteLocation) {
      throw new Error("Missing site location for booking creation.");
    }

    const now = Timestamp.now();
    const bookingType = deriveBookingTypeFromVehicleReports(vehicleReports.length ? vehicleReports : inspection.vehicleReports || []);

    const existingQuery = query(
      collection(db, COLLECTIONS.BOOKINGS),
      where("convertedJobId", "==", jobId),
      limit(1)
    );
    const existingSnap = await getDocs(existingQuery);
    if (!existingSnap.empty) {
      const existingRef = existingSnap.docs[0].ref;
      await updateDoc(
        existingRef,
        pruneUndefined({
          bookingType,
          organizationId: resolvedOrgId,
          organizationName: resolvedOrgName,
          contactId: resolvedContactId,
          contactName: resolvedContactName,
          contactEmail: resolvedContactEmail,
          contactPhone: resolvedContactPhone,
          siteLocation: resolvedSiteLocation,
          scheduledDate: Timestamp.fromDate(resolvedScheduledDate),
          scheduledTime: resolvedScheduledTime,
          allocatedStaff,
          allocatedStaffIds: allocatedStaff.map((staff) => staff.id),
          notes: notes || inspection.notes || undefined,
          status: "converted_to_job",
          updatedAt: now,
        }) as any
      );
      return existingSnap.docs[0].id;
    }

    const bookingNumber = await generateBookingNumber();
    const bookingRef = doc(collection(db, COLLECTIONS.BOOKINGS));
    await setDoc(
      bookingRef,
      pruneUndefined({
        id: bookingRef.id,
        bookingNumber,
        bookingType,
        organizationId: resolvedOrgId,
        organizationName: resolvedOrgName,
        contactId: resolvedContactId,
        contactName: resolvedContactName,
        contactEmail: resolvedContactEmail,
        contactPhone: resolvedContactPhone,
        siteLocation: resolvedSiteLocation,
        scheduledDate: Timestamp.fromDate(resolvedScheduledDate),
        scheduledTime: resolvedScheduledTime,
        allocatedStaff,
        allocatedStaffIds: allocatedStaff.map((staff) => staff.id),
        notes: notes || inspection.notes || undefined,
        status: "converted_to_job",
        convertedJobId: jobId,
        createdAt: now,
        createdBy: user?.uid || inspection.createdBy,
        updatedAt: now,
      }) as any
    );

    return bookingRef.id;
  };

  const handleSyncBookingRecord = async () => {
    if (!inspection?.convertedToJobId) return;
    if (bookingSyncing) return;
    setBookingSyncing(true);
    try {
      const bookingId = await upsertBookingForConvertedJob(inspection.convertedToJobId);
      if (bookingId) setLinkedBookingId(bookingId);
      if (inspection.status === "approved") {
        await updateDoc(doc(db, COLLECTIONS.INSPECTIONS, inspection.id), {
          status: "converted",
          updatedAt: Timestamp.now(),
        });
      }
      toast({
        title: "Booking record created",
        description: "This RFQ will now appear in the Bookings page for scheduling.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create booking record.";
      toast({
        title: "Booking sync failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setBookingSyncing(false);
    }
  };

  const buildSummaryInput = () => {
    if (!inspection) return "";
    const organizationName = selectedOrganization?.name || inspection.organizationName || "";
    const contactName = selectedContact
      ? `${selectedContact.firstName} ${selectedContact.lastName}`.trim()
      : inspection.contactName || "";
    const contactEmail = selectedContact?.email || inspection.clientEmail || "";
    const contactPhone =
      selectedContact?.mobile || selectedContact?.phone || inspection.clientPhone || "";
    const siteLocation = selectedSite
      ? { name: selectedSite.name, address: selectedSite.address }
      : inspection.siteLocation;

    const summaryPayload = {
      inspectionNumber: inspection.inspectionNumber,
      organisation: {
        name: organizationName,
      },
      contact: {
        name: contactName,
        email: contactEmail,
        phone: contactPhone,
      },
      schedule: {
        date: scheduledDate ? scheduledDate.toLocaleDateString("en-AU") : "",
        time: scheduledTime,
      },
      site: siteLocation || undefined,
      notes: notes || "",
      vehicles: vehicleReports.map((report) => ({
        registration: report.vehicle.registration,
        fleetAssetNumber: report.vehicle.fleetAssetNumber,
        year: report.vehicle.year,
        bodyManufacturer: report.vehicle.bodyManufacturer,
        poWorksOrderNumber: report.vehicle.poWorksOrderNumber,
        overallCondition: report.overallCondition,
        damages: report.damages.map((damage) => ({
          repairType: BOOKING_TYPE_LABELS[damage.repairType],
          location: damage.location,
          description: damage.description,
          totalCost: damage.totalCost ?? damage.estimatedCost ?? 0,
        })),
      })),
      totals: {
        labour: totals.totalLabour,
        materials: totals.totalMaterials,
        total: totals.totalCost,
      },
    };

    return JSON.stringify(summaryPayload, null, 2);
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

  const handleSaveInspection = async () => {
    if (!inspection) return;
    const payload = buildInspectionPayload();
    if (!payload) return;
    await updateDoc(doc(db, COLLECTIONS.INSPECTIONS, inspection.id), payload);
    toast({
      title: "Inspection saved",
      description: "Inspection details have been updated.",
    });
  };

  const handleCompleteInspection = async () => {
    if (!inspection) return;
    if (!selectedOrganization || !selectedContact || !scheduledDate || !scheduledTime) {
      toast({
        title: "Missing details",
        description: "Add the organisation, contact, and inspection schedule before completing.",
        variant: "destructive",
      });
      return;
    }
    if (vehicleReports.length === 0) {
      toast({
        title: "Add vehicle reports",
        description: "Log at least one vehicle and damage report before completing.",
        variant: "destructive",
      });
      return;
    }
    const now = Timestamp.now();
    const payload = buildInspectionPayload("submitted");
    if (!payload) return;
    await updateDoc(doc(db, COLLECTIONS.INSPECTIONS, inspection.id), {
      ...payload,
      submittedAt: now,
    });

    if (!inspection.convertedToJobId) {
      const jobNumber = await generateJobNumber(selectedOrganization);
      const jobRef = doc(collection(db, COLLECTIONS.JOBS));
      const assignedTechnicians = selectedStaff.map((staff, index) => ({
        technicianId: staff.id,
        technicianName: staff.name,
        role: index === 0 ? "primary" : "secondary",
        assignedAt: now,
        assignedBy: user?.uid || "system",
      }));

      const inspectionDamage: DamageItem[] = vehicleReports.flatMap((report) =>
        report.damages.map((damage) => ({
          id: damage.id,
          description: `${BOOKING_TYPE_LABELS[damage.repairType]} - ${damage.description || "Inspection repair site"}`,
          severity: damage.severity ?? "minor",
          location: damage.location,
          photoUrls: damage.preWorkPhotos ?? damage.photoUrls ?? [],
          estimatedCost: damage.totalCost ?? damage.estimatedCost,
        }))
      );

      const job = {
        id: jobRef.id,
        jobNumber,
        clientId: selectedOrganization.id,
        clientName: selectedOrganization.name,
        clientEmail: selectedContact.email,
        clientPhone: selectedContact.mobile || selectedContact.phone,
        organizationId: selectedOrganization.id,
        vehicles: [],
        jobVehicles: [],
        damage: inspectionDamage,
        status: "pending",
        assignedTechnicians,
        assignedTechnicianIds: assignedTechnicians.map((tech) => tech.technicianId),
        booking: {
          preferredDate: Timestamp.fromDate(scheduledDate),
          preferredTime: scheduledTime,
          urgency: "medium",
          specialInstructions: notes || undefined,
        },
        statusLog: [
          {
            status: "pending",
            changedAt: now,
            changedBy: user?.uid || "System",
            notes: `RFQ created from inspection ${inspection.inspectionNumber}`,
          },
        ],
        scheduledDate: Timestamp.fromDate(scheduledDate),
        createdAt: now,
        createdBy: user?.uid || inspection.createdBy,
        updatedAt: now,
        notes: `Inspection RFQ: ${inspection.inspectionNumber}`,
        totalJobCost: totals.totalCost,
        totalLabourCost: totals.totalLabour,
        totalMaterialsCost: totals.totalMaterials,
      };

      await setDoc(jobRef, job);

      const existingEntry =
        (inspection.worksRegisterId
          ? worksRegister.find((entry) => entry.id === inspection.worksRegisterId)
          : null) || worksRegister.find((entry) => entry.jobId === jobRef.id);
      if (existingEntry) {
        await updateDoc(doc(db, COLLECTIONS.WORKS_REGISTER, existingEntry.id), {
          jobId: jobRef.id,
          jobNumber: job.jobNumber,
          recordType: "job",
          organizationId: job.organizationId || job.clientId,
          clientName: job.clientName,
          technicianId: selectedStaff[0]?.id || "unassigned",
          technicianName: selectedStaff[0]?.name || "Unassigned",
          startDate: job.scheduledDate || now,
        });
      } else {
        const entryRef = doc(collection(db, COLLECTIONS.WORKS_REGISTER));
        const entry = createWorksRegisterEntry({
          job: job as any,
          serviceType: "Inspection RFQ",
          technicianName: selectedStaff[0]?.name || "Unassigned",
          entryId: entryRef.id,
        });
        await setDoc(entryRef, entry);
      }

      await updateDoc(doc(db, COLLECTIONS.INSPECTIONS, inspection.id), {
        convertedToJobId: jobRef.id,
      });
    }

    setSummaryGenerating(true);
    try {
      const summaryText = await generateInspectionSummaryAction(buildSummaryInput());
      const cleanedSummary = summaryText.trim();
      if (cleanedSummary) {
        setReportSummary(cleanedSummary);
        await updateDoc(doc(db, COLLECTIONS.INSPECTIONS, inspection.id), {
          reportSummary: cleanedSummary,
          reportSummaryUpdatedAt: Timestamp.now(),
        });

        const recipientEmail = selectedContact?.email || inspection.clientEmail;
        if (recipientEmail) {
          const contactName = selectedContact
            ? `${selectedContact.firstName} ${selectedContact.lastName}`.trim()
            : inspection.contactName || "there";
          const subject = `Inspection report: ${inspection.inspectionNumber}`;
          const message = `Hi ${contactName || "there"},

Thanks for arranging the inspection with ASI. Here is your inspection summary:

${cleanedSummary}

If you have any questions, reply to this email and we will help.

Regards,
ASI Australia`;
          await queueEmail(recipientEmail, subject, message);
        }
      }
    } catch (error) {
      console.warn("Failed to generate inspection summary:", error);
    } finally {
      setSummaryGenerating(false);
    }

    toast({
      title: "Inspection completed",
      description: "The RFQ has been sent and is awaiting approval.",
    });
  };

  const handleApproveInspection = async () => {
    if (!inspection) return;
    if (!inspection.convertedToJobId) {
      toast({
        title: "No RFQ job created",
        description: "Complete the inspection first to generate an RFQ job.",
        variant: "destructive",
      });
      return;
    }
    const now = Timestamp.now();
    await updateDoc(doc(db, COLLECTIONS.INSPECTIONS, inspection.id), {
      status: "converted",
      approvedAt: now,
      clientApprovalStatus: "approved",
      clientApprovalUpdatedAt: now,
      updatedAt: now,
    });

    const changedBy = user?.name || user?.email || user?.uid || "System";
    const jobId = inspection.convertedToJobId;
    await updateJob(jobId, {
      scheduledDate: scheduledDate ? Timestamp.fromDate(scheduledDate) : undefined,
    });
    await updateJobStatus(jobId, "scheduled", changedBy, "RFQ approved");

    const existingEntry =
      (inspection.worksRegisterId
        ? worksRegister.find((entry) => entry.id === inspection.worksRegisterId)
        : null) || worksRegister.find((entry) => entry.jobId === jobId);
    if (existingEntry) {
      await updateDoc(doc(db, COLLECTIONS.WORKS_REGISTER, existingEntry.id), {
        jobId,
        jobNumber: getJobById(jobId)?.jobNumber || existingEntry.jobNumber,
        recordType: "job",
        organizationId: inspection.organizationId || inspection.clientId || existingEntry.organizationId,
        clientName: inspection.clientName || existingEntry.clientName,
        technicianId: selectedStaff[0]?.id || "unassigned",
        technicianName: selectedStaff[0]?.name || "Unassigned",
        startDate: scheduledDate ? Timestamp.fromDate(scheduledDate) : existingEntry.startDate,
      });
    } else {
      const job = getJobById(jobId) || (await getDoc(doc(db, COLLECTIONS.JOBS, jobId))).data();
      if (job) {
        const entryRef = doc(collection(db, COLLECTIONS.WORKS_REGISTER));
        const entry = createWorksRegisterEntry({
          job: job as any,
          serviceType: "Inspection RFQ",
          technicianName: selectedStaff[0]?.name || "Unassigned",
          entryId: entryRef.id,
        });
        await setDoc(entryRef, entry);
      }
    }

    try {
      await upsertBookingForConvertedJob(jobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create booking for the approved RFQ.";
      toast({
        title: "Booking sync failed",
        description: message,
        variant: "destructive",
      });
    }

    toast({
      title: "RFQ approved",
      description: "The job has been scheduled and moved into the pipeline.",
    });
  };

  const handleRejectInspection = async () => {
    if (!inspection) return;
    await updateDoc(doc(db, COLLECTIONS.INSPECTIONS, inspection.id), {
      status: "rejected",
      updatedAt: Timestamp.now(),
    });
    if (inspection.convertedToJobId) {
      const changedBy = user?.name || user?.email || user?.uid || "System";
      await updateJobStatus(inspection.convertedToJobId, "cancelled", changedBy, "RFQ rejected");
    }
    toast({
      title: "RFQ rejected",
      description: "The inspection has been marked as rejected.",
    });
  };

  const handleRecycleJob = async () => {
    if (!inspection?.convertedToJobId) return;
    await deleteJob(inspection.convertedToJobId, user?.uid || "system");
    toast({
      title: "Job sent to recycle bin",
      description: "The RFQ job has been removed from active lists.",
    });
    setShowRecycleDialog(false);
  };

  const handleCreateContact = async () => {
    let targetOrgId = newContactData.organisationId;
    let targetOrg: ContactOrganization | null = null;

    if (isCreatingNewOrg) {
      const newOrg: ContactOrganization = {
        id: `org-${Date.now()}`,
        name: newOrgData.name,
        category: newOrgData.category,
        type: "customer",
        status: "active",
        abn: newOrgData.abn,
        phone: newOrgData.phone,
        email: newOrgData.email,
        address: {
          street: newOrgData.street,
          suburb: newOrgData.suburb,
          state: newOrgData.state,
          postcode: newOrgData.postcode,
          country: "Australia",
        },
        sites: [
          {
            id: `site-${Date.now()}`,
            name: "Main Location",
            address: {
              street: newOrgData.street,
              suburb: newOrgData.suburb,
              state: newOrgData.state,
              postcode: newOrgData.postcode,
              country: "Australia",
            },
            isDefault: true,
          },
        ],
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };

      const orgRef = await addDoc(collection(db, COLLECTIONS.CONTACT_ORGANIZATIONS), newOrg);
      targetOrgId = orgRef.id;
      targetOrg = { ...newOrg, id: orgRef.id };
    } else {
      targetOrg = organizations.find((org) => org.id === targetOrgId) || null;
    }

    if (!targetOrg) return;

    const newContact: OrganizationContact = {
      id: `contact-${Date.now()}`,
      organizationId: targetOrgId,
      firstName: newContactData.firstName,
      lastName: newContactData.lastName,
      email: newContactData.email,
      phone: newContactData.phone,
      mobile: newContactData.mobile,
      role: "primary",
      jobTitle: newContactData.jobTitle,
      status: "active",
      isPrimary: false,
      hasPortalAccess: true,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };

    const contactRef = await addDoc(
      collection(db, COLLECTIONS.ORGANIZATION_CONTACTS),
      newContact
    );

    setSelectedOrganization(targetOrg);
    setSelectedContact({ ...newContact, id: contactRef.id });
    setSelectedSite(targetOrg.sites.find((site) => site.isDefault) || targetOrg.sites[0] || null);
    setShowNewContactDialog(false);
  };
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">
        Loading inspection...
      </div>
    );
  }

  if (!inspection) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <ClipboardCheck className="h-16 w-16 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Inspection Not Found</h2>
        <p className="text-muted-foreground">The requested inspection could not be found.</p>
        <Button onClick={() => router.push("/dashboard/inspections")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to inspections
        </Button>
      </div>
    );
  }

  const canApprove = inspection.status === "submitted" && user?.role === "admin";
  const needsBookingSync =
    !!inspection.convertedToJobId &&
    !linkedBookingId &&
    (inspection.status === "approved" || inspection.status === "converted") &&
    user?.role === "admin";

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Button variant="ghost" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Button>
          <Badge className={STATUS_BADGE[inspection.status]} variant="outline">
            {inspection.status.replace("_", " ").toUpperCase()}
          </Badge>
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <Briefcase className="h-8 w-8 text-primary" />
              <h1 className="text-2xl font-bold tracking-tight">
                {inspection.inspectionNumber}
              </h1>
            </div>
            <p className="text-muted-foreground">
              {selectedOrganization?.name || inspection.organizationName || "Organisation"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleSaveInspection} variant="outline">
              Save changes
            </Button>
            <Button onClick={handleCompleteInspection}>
              Complete inspection & send report
            </Button>
            {canApprove && (
              <>
                <Button variant="outline" onClick={handleApproveInspection}>
                  Approve RFQ
                </Button>
                <Button variant="destructive" onClick={handleRejectInspection}>
                  Reject RFQ
                </Button>
              </>
            )}
            {inspection.convertedToJobId && (
              <Button asChild variant="outline">
                <Link href={`/dashboard/jobs/${inspection.convertedToJobId}`}>View RFQ job</Link>
              </Button>
            )}
            {inspection.convertedToJobId && (
              <Dialog open={showRecycleDialog} onOpenChange={setShowRecycleDialog}>
                <DialogTrigger asChild>
                  <Button variant="destructive">Send job to recycle bin</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Send job to recycle bin?</DialogTitle>
                  </DialogHeader>
                  <p className="text-sm text-muted-foreground">
                    This removes the RFQ job from active lists. You can restore it from the
                    recycle bin later.
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setShowRecycleDialog(false)}>
                      Cancel
                    </Button>
                    <Button variant="destructive" onClick={handleRecycleJob}>
                      Send to recycle bin
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>
      </div>

      {needsBookingSync && (
        <Card className="border-amber-500/30 bg-amber-500/10">
          <CardHeader>
            <CardTitle className="text-base">Booking record missing</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-muted-foreground">
              This inspection has been converted to a job but doesn’t have a Booking record yet, so
              it won’t appear in the Bookings page.
            </p>
            <Button onClick={handleSyncBookingRecord} disabled={bookingSyncing}>
              {bookingSyncing ? "Creating..." : "Create booking record"}
            </Button>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="details" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 bg-muted/50">
          <TabsTrigger value="details">Inspection details</TabsTrigger>
          <TabsTrigger value="vehicles">Vehicles & damage</TabsTrigger>
          <TabsTrigger value="summary">Quote summary</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="space-y-4">
          <Card className="bg-card/50 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5 text-primary" />
                Customer details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Organisation</Label>
                  <Select
                    value={selectedOrganization?.id || ""}
                    onValueChange={handleSelectOrganization}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select organisation" />
                    </SelectTrigger>
                    <SelectContent>
                      {organizations.map((org) => (
                        <SelectItem key={org.id} value={org.id}>
                          {org.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Point of contact</Label>
                    <Dialog
                      open={showNewContactDialog}
                      onOpenChange={setShowNewContactDialog}
                    >
                      <DialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-6 px-2">
                          + New contact
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
                        <DialogHeader>
                          <DialogTitle>Add contact</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 py-2">
                          <div className="space-y-2">
                            <Label>Organisation</Label>
                            <Select
                              value={isCreatingNewOrg ? "__new__" : newContactData.organisationId}
                              onValueChange={(value) => {
                                if (value === "__new__") {
                                  setIsCreatingNewOrg(true);
                                  setNewContactData({ ...newContactData, organisationId: "" });
                                } else {
                                  setIsCreatingNewOrg(false);
                                  setNewContactData({ ...newContactData, organisationId: value });
                                }
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select organisation" />
                              </SelectTrigger>
                              <SelectContent>
                                {organizations.map((org) => (
                                  <SelectItem key={org.id} value={org.id}>
                                    {org.name}
                                  </SelectItem>
                                ))}
                                <SelectItem value="__new__" className="text-primary font-medium">
                                  + Add new organisation
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          {isCreatingNewOrg && (
                            <div className="space-y-3 rounded-md border border-dashed p-4">
                              <div className="grid gap-3 md:grid-cols-2">
                                <div className="md:col-span-2 space-y-2">
                                  <Label>Organisation name</Label>
                                  <Input
                                    value={newOrgData.name}
                                    onChange={(e) =>
                                      setNewOrgData({ ...newOrgData, name: e.target.value })
                                    }
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>Category</Label>
                                  <Select
                                    value={newOrgData.category}
                                    onValueChange={(value: ContactCategory) =>
                                      setNewOrgData({ ...newOrgData, category: value })
                                    }
                                  >
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {(Object.entries(CONTACT_CATEGORY_LABELS) as [
                                        ContactCategory,
                                        string
                                      ][]).map(([value, label]) => (
                                        <SelectItem key={value} value={value}>
                                          {label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-2">
                                  <Label>ABN</Label>
                                  <Input
                                    value={newOrgData.abn}
                                    onChange={(e) =>
                                      setNewOrgData({ ...newOrgData, abn: e.target.value })
                                    }
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>Phone</Label>
                                  <Input
                                    value={newOrgData.phone}
                                    onChange={(e) =>
                                      setNewOrgData({ ...newOrgData, phone: e.target.value })
                                    }
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>Email</Label>
                                  <Input
                                    value={newOrgData.email}
                                    onChange={(e) =>
                                      setNewOrgData({ ...newOrgData, email: e.target.value })
                                    }
                                  />
                                </div>
                                <div className="md:col-span-2 space-y-2">
                                  <Label>Street</Label>
                                  <Input
                                    value={newOrgData.street}
                                    onChange={(e) =>
                                      setNewOrgData({ ...newOrgData, street: e.target.value })
                                    }
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>Suburb</Label>
                                  <Input
                                    value={newOrgData.suburb}
                                    onChange={(e) =>
                                      setNewOrgData({ ...newOrgData, suburb: e.target.value })
                                    }
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>State</Label>
                                  <Input
                                    value={newOrgData.state}
                                    onChange={(e) =>
                                      setNewOrgData({ ...newOrgData, state: e.target.value })
                                    }
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>Postcode</Label>
                                  <Input
                                    value={newOrgData.postcode}
                                    onChange={(e) =>
                                      setNewOrgData({ ...newOrgData, postcode: e.target.value })
                                    }
                                  />
                                </div>
                              </div>
                            </div>
                          )}

                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="space-y-2">
                              <Label>First name</Label>
                              <Input
                                value={newContactData.firstName}
                                onChange={(e) =>
                                  setNewContactData({ ...newContactData, firstName: e.target.value })
                                }
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Last name</Label>
                              <Input
                                value={newContactData.lastName}
                                onChange={(e) =>
                                  setNewContactData({ ...newContactData, lastName: e.target.value })
                                }
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Email</Label>
                              <Input
                                value={newContactData.email}
                                onChange={(e) =>
                                  setNewContactData({ ...newContactData, email: e.target.value })
                                }
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Mobile</Label>
                              <Input
                                value={newContactData.mobile}
                                onChange={(e) =>
                                  setNewContactData({ ...newContactData, mobile: e.target.value })
                                }
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Phone</Label>
                              <Input
                                value={newContactData.phone}
                                onChange={(e) =>
                                  setNewContactData({ ...newContactData, phone: e.target.value })
                                }
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Job title</Label>
                              <Input
                                value={newContactData.jobTitle}
                                onChange={(e) =>
                                  setNewContactData({ ...newContactData, jobTitle: e.target.value })
                                }
                              />
                            </div>
                          </div>
                          <Button onClick={handleCreateContact} className="w-full">
                            Save contact
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                  <Select
                    value={selectedContact?.id || ""}
                    onValueChange={(value) =>
                      setSelectedContact(contacts.find((contact) => contact.id === value) || null)
                    }
                    disabled={!selectedOrganization}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select contact" />
                    </SelectTrigger>
                    <SelectContent>
                      {contacts.map((contact) => (
                        <SelectItem key={contact.id} value={contact.id}>
                          {contact.firstName} {contact.lastName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Inspection date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-start">
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {scheduledDate
                          ? scheduledDate.toLocaleDateString("en-AU")
                          : "Select date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={scheduledDate}
                        onSelect={(date) => setScheduledDate(date || undefined)}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <Label>Inspection time</Label>
                  <Select value={scheduledTime} onValueChange={setScheduledTime}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select time" />
                    </SelectTrigger>
                    <SelectContent>
                      {timeSlots.map((slot) => (
                        <SelectItem key={slot} value={slot}>
                          {slot}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Inspection notes</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add inspection notes for the client or internal team..."
                />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/50 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Assigned staff
              </CardTitle>
            </CardHeader>
            <CardContent>
              {staffList.length === 0 ? (
                <p className="text-sm text-muted-foreground">No staff available.</p>
              ) : (
                <div className="grid gap-3 md:grid-cols-3">
                  {staffList.map((staff) => {
                    const selected = selectedStaff.some((item) => item.id === staff.id);
                    return (
                      <Card
                        key={staff.id}
                        className={cn(
                          "cursor-pointer border-border/60 transition-colors",
                          selected ? "border-primary bg-primary/5" : "hover:border-primary/40"
                        )}
                        onClick={() => handleToggleStaff(staff)}
                      >
                        <CardContent className="p-3 flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium">{staff.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {staff.type === "asi_staff" ? "ASI staff" : "Subcontractor"}
                            </p>
                          </div>
                          {selected && <CheckCircle className="h-4 w-4 text-primary" />}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="vehicles" className="space-y-4">
          <Card className="bg-card/50 backdrop-blur">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5 text-primary" />
                Vehicles and damage report
              </CardTitle>
              <Dialog open={showAddVehicleDialog} onOpenChange={setShowAddVehicleDialog}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-2">
                    <Plus className="h-4 w-4" />
                    Add vehicle
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Add vehicle</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Registration *</Label>
                        <Input
                          value={newVehicle.registration}
                          onChange={(e) =>
                            setNewVehicle({
                              ...newVehicle,
                              registration: e.target.value.toUpperCase(),
                            })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>VIN</Label>
                        <Input
                          value={newVehicle.vin}
                          onChange={(e) =>
                            setNewVehicle({
                              ...newVehicle,
                              vin: e.target.value.toUpperCase(),
                            })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Fleet/Stock No.</Label>
                        <Input
                          value={newVehicle.fleetAssetNumber}
                          onChange={(e) =>
                            setNewVehicle({ ...newVehicle, fleetAssetNumber: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Body Manufacturer</Label>
                        <Input
                          value={newVehicle.bodyManufacturer}
                          onChange={(e) =>
                            setNewVehicle({ ...newVehicle, bodyManufacturer: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Year</Label>
                        <Input
                          type="number"
                          value={newVehicle.year}
                          onChange={(e) =>
                            setNewVehicle({ ...newVehicle, year: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>PO/Works Order Number</Label>
                        <Input
                          value={newVehicle.poWorksOrderNumber}
                          onChange={(e) =>
                            setNewVehicle({
                              ...newVehicle,
                              poWorksOrderNumber: e.target.value,
                            })
                          }
                        />
                      </div>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <Button
                        type="button"
                        variant={canLookupFleet ? "default" : "outline"}
                        className={canLookupFleet ? "bg-emerald-600 text-white hover:bg-emerald-700" : ""}
                        onClick={handleFleetLookup}
                        disabled={!canLookupFleet}
                      >
                        Lookup fleet
                      </Button>
                      <Button onClick={handleAddVehicle} className="w-full sm:w-auto">
                        Save vehicle
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent className="space-y-6">
              {vehicleReports.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  Add vehicles and repair sites to build the inspection report.
                </p>
              ) : (
                <Accordion type="multiple" className="space-y-4">
                  {vehicleReports.map((vehicle) => {
                    const vehicleTotals = vehicle.damages.reduce(
                      (acc, damage) => {
                        const cost = damage.totalCost ?? damage.estimatedCost ?? 0;
                        const breakdown = calculateCostBreakdown(cost);
                        return {
                          totalCost: acc.totalCost + cost,
                          totalLabour: acc.totalLabour + (damage.labourCost ?? breakdown.labourCost),
                          totalMaterials: acc.totalMaterials + (damage.materialsCost ?? breakdown.materialsCost),
                        };
                      },
                      { totalCost: 0, totalLabour: 0, totalMaterials: 0 }
                    );

                    return (
                      <AccordionItem
                        key={vehicle.vehicleId}
                        value={vehicle.vehicleId}
                        className="border border-border/50 rounded-lg"
                      >
                        <AccordionTrigger className="px-4">
                          <div className="flex flex-1 items-center gap-3">
                            <Car className="h-4 w-4 text-primary" />
                            <span className="font-mono font-medium">
                              {vehicle.vehicle.registration || "Vehicle"}
                            </span>
                            {vehicle.vehicle.poWorksOrderNumber && (
                              <Badge variant="outline">PO: {vehicle.vehicle.poWorksOrderNumber}</Badge>
                            )}
                          </div>
                          <span className="text-sm text-muted-foreground ml-auto mr-4">
                            {vehicle.damages.length} repair(s) - ${vehicleTotals.totalCost.toFixed(2)}
                          </span>
                        </AccordionTrigger>
                        <AccordionContent className="pt-4 space-y-6">
                          <div className="grid gap-4 md:grid-cols-5 p-4 bg-muted/30 rounded-lg">
                            <div>
                              <Label className="text-xs text-muted-foreground">Registration</Label>
                              <p className="font-medium">{vehicle.vehicle.registration || "-"}</p>
                            </div>
                            <div>
                              <Label className="text-xs text-muted-foreground">Fleet/Stock No.</Label>
                              <p className="font-medium">{vehicle.vehicle.fleetAssetNumber || "-"}</p>
                            </div>
                            <div>
                              <Label className="text-xs text-muted-foreground">Body Manufacturer</Label>
                              <p className="font-medium">{vehicle.vehicle.bodyManufacturer || "-"}</p>
                            </div>
                            <div>
                              <Label className="text-xs text-muted-foreground">Year</Label>
                              <p className="font-medium">{vehicle.vehicle.year || "-"}</p>
                            </div>
                            <div>
                              <Label className="text-xs text-muted-foreground">PO/Works Order</Label>
                              <p className="font-medium">{vehicle.vehicle.poWorksOrderNumber || "-"}</p>
                            </div>
                          </div>

                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <Label className="text-sm font-medium">Repair Sites</Label>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setSelectedVehicleId(vehicle.vehicleId);
                                  setShowAddDamageDialog(true);
                                }}
                              >
                                <Plus className="mr-1 h-3 w-3" />
                                Add Repair
                              </Button>
                            </div>

                            {vehicle.damages.length === 0 ? (
                              <p className="text-sm text-muted-foreground py-4 text-center">
                                No repair sites added yet
                              </p>
                            ) : (
                              <div className="space-y-3">
                                {vehicle.damages.map((damage) => {
                                  const preKey = `${vehicle.vehicleId}-${damage.id}-pre`;
                                  const postKey = `${vehicle.vehicleId}-${damage.id}-post`;
                                  const preCameraId = `${preKey}-camera`;
                                  const preUploadId = `${preKey}-upload`;
                                  const postCameraId = `${postKey}-camera`;
                                  const postUploadId = `${postKey}-upload`;
                                  const preUploading = uploadingPhotos[preKey];
                                  const postUploading = uploadingPhotos[postKey];
                                  const prePhotos = damage.preWorkPhotos ?? damage.photoUrls ?? [];
                                  const postPhotos = damage.postWorkPhotos ?? [];
                                  const damageCost = damage.totalCost ?? damage.estimatedCost ?? 0;
                                  const breakdown = calculateCostBreakdown(damageCost);
                                  const labourCost = damage.labourCost ?? breakdown.labourCost;
                                  const materialsCost = damage.materialsCost ?? breakdown.materialsCost;

                                  return (
                                    <Card key={damage.id} className="bg-muted/20">
                                      <CardContent className="p-4 space-y-4">
                                        <div className="flex items-start justify-between">
                                          <div>
                                            <Badge variant="outline" className="mb-2">
                                              {BOOKING_TYPE_LABELS[damage.repairType]}
                                            </Badge>
                                            <p className="font-medium">{damage.location}</p>
                                            {damage.description && (
                                              <p className="text-sm text-muted-foreground">
                                                {damage.description}
                                              </p>
                                            )}
                                          </div>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className="text-destructive"
                                            onClick={() => handleDeleteDamage(vehicle.vehicleId, damage.id)}
                                          >
                                            <Trash2 className="h-4 w-4" />
                                          </Button>
                                        </div>

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
                                                  void handleDamagePhotoUpload(
                                                    vehicle.vehicleId,
                                                    damage.id,
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
                                                  void handleDamagePhotoUpload(
                                                    vehicle.vehicleId,
                                                    damage.id,
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
                                                  void handleDamagePhotoUpload(
                                                    vehicle.vehicleId,
                                                    damage.id,
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
                                                  void handleDamagePhotoUpload(
                                                    vehicle.vehicleId,
                                                    damage.id,
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

                                        <div className="grid grid-cols-3 gap-4 pt-2 border-t">
                                          <div className="space-y-1">
                                            <Label className="text-xs">Total Cost</Label>
                                            <div className="flex items-center gap-1">
                                              <Input
                                                type="number"
                                                value={damageCost || ""}
                                                onChange={(e) =>
                                                  handleUpdateDamageCost(
                                                    vehicle.vehicleId,
                                                    damage.id,
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
                                              ${labourCost.toFixed(2)}
                                            </p>
                                          </div>
                                          <div className="space-y-1">
                                            <Label className="text-xs text-amber-400">
                                              Materials (30%)
                                            </Label>
                                            <p className="font-medium text-amber-400">
                                              ${materialsCost.toFixed(2)}
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

                          <Card className="bg-primary/5 border-primary/20">
                            <CardContent className="p-4">
                              <div className="grid grid-cols-3 gap-4 text-sm">
                                <div>
                                  <Label className="text-xs text-muted-foreground">Total Cost</Label>
                                  <p className="text-lg font-bold">${vehicleTotals.totalCost.toFixed(2)}</p>
                                </div>
                                <div>
                                  <Label className="text-xs text-muted-foreground">Labour</Label>
                                  <p className="font-medium text-blue-400">${vehicleTotals.totalLabour.toFixed(2)}</p>
                                </div>
                                <div>
                                  <Label className="text-xs text-muted-foreground">Materials</Label>
                                  <p className="font-medium text-amber-400">${vehicleTotals.totalMaterials.toFixed(2)}</p>
                                </div>
                              </div>
                            </CardContent>
                          </Card>

                          <div className="flex justify-end">
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleDeleteVehicle(vehicle.vehicleId)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Remove Vehicle
                            </Button>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="summary" className="space-y-4">
          <Card className="bg-card/50 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Quote summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {vehicleReports.length === 0 ? (
                <p className="text-center text-muted-foreground py-6">
                  Add vehicles and repair sites to see the quote summary.
                </p>
              ) : (
                <div className="space-y-4">
                  {vehicleReports.map((vehicle) => {
                    const vehicleTotals = vehicle.damages.reduce(
                      (acc, damage) => {
                        const cost = damage.totalCost ?? damage.estimatedCost ?? 0;
                        const breakdown = calculateCostBreakdown(cost);
                        return {
                          totalCost: acc.totalCost + cost,
                          totalLabour: acc.totalLabour + (damage.labourCost ?? breakdown.labourCost),
                          totalMaterials:
                            acc.totalMaterials + (damage.materialsCost ?? breakdown.materialsCost),
                        };
                      },
                      { totalCost: 0, totalLabour: 0, totalMaterials: 0 }
                    );

                    return (
                      <Card key={vehicle.vehicleId} className="bg-muted/30">
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <Car className="h-5 w-5 text-primary" />
                              <span className="font-mono font-medium">
                                {vehicle.vehicle.registration || "Vehicle"}
                              </span>
                            </div>
                            <span className="text-lg font-bold">
                              ${vehicleTotals.totalCost.toFixed(2)}
                            </span>
                          </div>
                          <div className="grid gap-2 text-sm text-muted-foreground md:grid-cols-4">
                            <span>Fleet/Stock: {vehicle.vehicle.fleetAssetNumber || "-"}</span>
                            <span>Body: {vehicle.vehicle.bodyManufacturer || "-"}</span>
                            <span>Year: {vehicle.vehicle.year || "-"}</span>
                            <span>PO: {vehicle.vehicle.poWorksOrderNumber || "-"}</span>
                          </div>
                          <div className="space-y-1 text-sm">
                            {vehicle.damages.map((damage) => {
                              const cost = damage.totalCost ?? damage.estimatedCost ?? 0;
                              return (
                                <div
                                  key={damage.id}
                                  className="flex items-center justify-between py-1 border-b border-border/30 last:border-0"
                                >
                                  <div>
                                    <span className="font-medium">
                                      {BOOKING_TYPE_LABELS[damage.repairType]} - {damage.location}
                                    </span>
                                    {damage.description && (
                                      <p className="text-xs text-muted-foreground">
                                        {damage.description}
                                      </p>
                                    )}
                                  </div>
                                  <span className="font-medium">${cost.toFixed(2)}</span>
                                </div>
                              );
                            })}
                          </div>
                          <div className="flex gap-4 pt-3 border-t text-sm">
                            <span className="text-blue-400">
                              Labour: ${vehicleTotals.totalLabour.toFixed(2)}
                            </span>
                            <span className="text-amber-400">
                              Materials: ${vehicleTotals.totalMaterials.toFixed(2)}
                            </span>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
              <div className="grid gap-4 md:grid-cols-3">
                <Card className="bg-muted/40">
                  <CardContent className="p-4">
                    <Label className="text-xs text-muted-foreground">Labour estimate</Label>
                    <p className="text-2xl font-bold text-blue-400">
                      ${totals.totalLabour.toFixed(2)}
                    </p>
                  </CardContent>
                </Card>
                <Card className="bg-muted/40">
                  <CardContent className="p-4">
                    <Label className="text-xs text-muted-foreground">Materials estimate</Label>
                    <p className="text-2xl font-bold text-amber-400">
                      ${totals.totalMaterials.toFixed(2)}
                    </p>
                  </CardContent>
                </Card>
                <Card className="bg-primary/10 border-primary/30">
                  <CardContent className="p-4">
                    <Label className="text-xs text-muted-foreground">Total estimate</Label>
                    <p className="text-2xl font-bold text-primary">
                      ${totals.totalCost.toFixed(2)}
                    </p>
                  </CardContent>
                </Card>
              </div>
              <p className="text-sm text-muted-foreground">
                Totals are calculated using the same labour/materials split as live job costing.
              </p>
            </CardContent>
          </Card>
          <Card className="bg-card/50 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                AI inspection summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {summaryGenerating ? (
                <p className="text-sm text-muted-foreground">Generating summary...</p>
              ) : reportSummary ? (
                <Textarea value={reportSummary} readOnly className="min-h-[180px]" />
              ) : (
                <p className="text-sm text-muted-foreground">
                  The summary appears after the inspection is completed.
                </p>
              )}
              {inspection?.reportSummaryUpdatedAt ? (
                <p className="text-xs text-muted-foreground">
                  Last updated{" "}
                  {inspection.reportSummaryUpdatedAt.toDate().toLocaleString("en-AU")}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog
        open={!!photoPreview}
        onOpenChange={(open) => {
          if (!open) setPhotoPreview(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{photoPreview?.label || "Photo preview"}</DialogTitle>
          </DialogHeader>
          {photoPreview && (
            <div className="flex justify-center">
              <img
                src={photoPreview.url}
                alt={photoPreview.label}
                className="max-h-[70vh] rounded-md object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showAddDamageDialog} onOpenChange={setShowAddDamageDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add repair site</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Repair type</Label>
              <Select
                value={newDamage.repairType}
                onValueChange={(value: RepairType) =>
                  setNewDamage({ ...newDamage, repairType: value })
                }
              >
                <SelectTrigger>
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
            <div className="space-y-2">
              <Label>Location</Label>
              <Input
                value={newDamage.location}
                onChange={(e) => setNewDamage({ ...newDamage, location: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={newDamage.description}
                onChange={(e) => setNewDamage({ ...newDamage, description: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Total cost</Label>
              <Input
                type="number"
                value={newDamage.totalCost}
                onChange={(e) => setNewDamage({ ...newDamage, totalCost: e.target.value })}
              />
              {newDamage.totalCost && (
                <p className="text-xs text-muted-foreground">
                  Labour: ${(parseFloat(newDamage.totalCost) * 0.7).toFixed(2)} | Materials: $
                  {(parseFloat(newDamage.totalCost) * 0.3).toFixed(2)}
                </p>
              )}
            </div>
            <Button onClick={handleAddDamage} className="w-full">
              Save damage
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
