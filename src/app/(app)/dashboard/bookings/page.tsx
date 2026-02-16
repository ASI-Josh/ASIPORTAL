"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Timestamp,
  collection,
  doc,
  deleteField,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { format, startOfDay } from "date-fns";
import {
  CalendarIcon,
  Clock,
  Plus,
  Search,
  Building2,
  User,
  MapPin,
  Phone,
  Mail,
  Users,
  CheckCircle,
  AlertCircle,
  ArrowRight,
  FileText,
  Briefcase,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ADMIN_EMAILS, determineUserRole } from "@/lib/auth";
import { HOURS_PER_WORKDAY, calculateEndFromWorkHours } from "@/lib/scheduling";

import {
  Booking,
  BookingType,
  BOOKING_TYPE_LABELS,
  Job,
  ContactCategory,
  CONTACT_CATEGORY_LABELS,
  CLIENT_CONTACT_CATEGORIES,
  ContactOrganization,
  OrganizationContact,
  SiteLocation,
  Address,
} from "@/lib/types";
import { initialOrganizations, initialContacts } from "@/lib/contacts-data";
import { COLLECTIONS, addDocument, createDocument } from "@/lib/firestore";
import { createWorksRegisterEntry, isJobOnHold } from "@/lib/jobs-data";
import { db } from "@/lib/firebaseClient";
import { useJobs } from "@/contexts/JobsContext";
import { useAuth } from "@/contexts/AuthContext";

interface NewOrganisationFormData {
  name: string;
  category: ContactCategory;
  abn: string;
  phone: string;
  email: string;
  street: string;
  suburb: string;
  state: string;
  postcode: string;
}

interface NewContactFormData {
  organisationId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  mobile: string;
  jobTitle: string;
}

type StaffMember = {
  id: string;
  name: string;
  type: "asi_staff" | "subcontractor";
  email?: string;
};

type CalendarEventPayload = {
  summary: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  attendees?: string[];
  createMeet?: boolean;
};

type BookingCalendarPayloadInput = {
  bookingNumber: string;
  jobNumber?: string;
  bookingTypeLabel: string;
  organizationName: string;
  contactName: string;
  contactEmail?: string;
  contactPhone?: string;
  siteName?: string;
  siteAddress?: Address;
  scheduledDate: Date;
  scheduledTime: string;
  finishDate?: Date;
  finishTime?: string;
  durationHours?: number;
  notes?: string;
  assignedStaff?: string[];
  attendees?: string[];
  createMeet?: boolean;
};

const DEFAULT_EVENT_DURATION_MINUTES = 60;

const padTime = (value: number) => String(value).padStart(2, "0");

const formatAddress = (address?: Address) => {
  if (!address) return "";
  return [address.street, address.suburb, address.state, address.postcode, address.country]
    .map((value) => value?.trim())
    .filter((value) => value)
    .join(", ");
};

const normalizePhone = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const resolveContactPhone = (contact?: { mobile?: unknown; phone?: unknown }) =>
  normalizePhone(contact?.mobile) || normalizePhone(contact?.phone);

const buildEventTimes = (
  date: Date,
  time: string,
  finishDate?: Date,
  finishTime?: string,
  durationHours?: number
) => {
  const [hours, minutes] = time.split(":").map((part) => Number(part));
  const start = new Date(date);
  if (Number.isFinite(hours)) start.setHours(hours);
  if (Number.isFinite(minutes)) start.setMinutes(minutes);
  start.setSeconds(0, 0);
  const end = (() => {
    if (finishDate && finishTime) {
      const [finishHours, finishMinutes] = finishTime
        .split(":")
        .map((part) => Number(part));
      const explicitEnd = new Date(finishDate);
      if (Number.isFinite(finishHours)) explicitEnd.setHours(finishHours);
      if (Number.isFinite(finishMinutes)) explicitEnd.setMinutes(finishMinutes);
      explicitEnd.setSeconds(0, 0);
      if (explicitEnd.getTime() > start.getTime()) return explicitEnd;
    }

    if (typeof durationHours === "number" && durationHours > 0) {
      return calculateEndFromWorkHours(start, durationHours, HOURS_PER_WORKDAY);
    }

    const fallback = new Date(start);
    fallback.setMinutes(fallback.getMinutes() + DEFAULT_EVENT_DURATION_MINUTES);
    return fallback;
  })();

  const formatLocal = (value: Date) =>
    `${value.getFullYear()}-${padTime(value.getMonth() + 1)}-${padTime(value.getDate())}T${padTime(
      value.getHours()
    )}:${padTime(value.getMinutes())}:00`;

  return { start: formatLocal(start), end: formatLocal(end) };
};

const buildBookingCalendarPayload = (input: BookingCalendarPayloadInput): CalendarEventPayload => {
  const addressText = formatAddress(input.siteAddress);
  const location =
    input.siteName && addressText
      ? `${input.siteName}, ${addressText}`
      : input.siteName || addressText || undefined;

  const lines: string[] = [`Booking: ${input.bookingNumber}`];
  if (input.jobNumber) {
    lines.push(`Job: ${input.jobNumber}`);
  }
  lines.push(`Service: ${input.bookingTypeLabel}`);
  lines.push(`Organisation: ${input.organizationName}`);

  if (input.contactName) {
    const contactLine = input.contactEmail
      ? `Contact: ${input.contactName} (${input.contactEmail})`
      : `Contact: ${input.contactName}`;
    lines.push(contactLine);
  } else if (input.contactEmail) {
    lines.push(`Contact: ${input.contactEmail}`);
  }

  if (input.contactPhone) {
    lines.push(`Phone: ${input.contactPhone}`);
  }

  if (input.siteName) {
    lines.push(`Site: ${input.siteName}`);
  }

  if (addressText) {
    lines.push(`Address: ${addressText}`);
  }

  if (input.assignedStaff?.length) {
    lines.push(`Assigned staff: ${input.assignedStaff.join(", ")}`);
  }

  if (typeof input.durationHours === "number" && input.durationHours > 0) {
    lines.push(`Estimated duration: ${input.durationHours}h (based on ${HOURS_PER_WORKDAY}h workdays)`);
  }

  if (input.notes) {
    lines.push("");
    lines.push("Notes:");
    lines.push(input.notes);
  }

  const { start, end } = buildEventTimes(
    input.scheduledDate,
    input.scheduledTime,
    input.finishDate,
    input.finishTime,
    input.durationHours
  );

  const payload: CalendarEventPayload = {
    summary: `Booking ${input.bookingNumber} - ${input.organizationName} - ${input.bookingTypeLabel}`,
    description: lines.join("\n"),
    location,
    start,
    end,
    attendees: input.attendees,
  };

  if (input.createMeet) {
    payload.createMeet = true;
  }

  return payload;
};

export default function BookingsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const {
    bookings,
    jobs,
    deletedJobs,
    deleteJob,
    createBooking,
    updateBooking,
    updateJob,
    worksRegister,
    updateWorksRegisterEntry,
  } = useJobs();
  const { user, firebaseUser } = useAuth();

  // Shared data state (Firestore-backed)
  const [organizations, setOrganizations] = useState<ContactOrganization[]>([]);
  const [contacts, setContacts] = useState<OrganizationContact[]>([]);
  const [roleStaffList, setRoleStaffList] = useState<StaffMember[]>([]);
  const [adminStaffList, setAdminStaffList] = useState<StaffMember[]>([]);
  const [asiContactStaffList, setAsiContactStaffList] = useState<StaffMember[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [orgsError, setOrgsError] = useState<string | null>(null);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [hasLoadedOrgs, setHasLoadedOrgs] = useState(false);
  const [hasSeededOrgs, setHasSeededOrgs] = useState(false);

  // State for booking list view
  const [searchQuery, setSearchQuery] = useState("");
  const [includeCancelledBookings, setIncludeCancelledBookings] = useState(false);

  // State for new booking form
  const [showNewBookingDialog, setShowNewBookingDialog] = useState(false);
  const [bookingStep, setBookingStep] = useState(1);
  
  // Booking form state
  const [bookingType, setBookingType] = useState<BookingType | "">("");
  const [selectedOrganization, setSelectedOrganization] = useState<ContactOrganization | null>(null);
  const [selectedContact, setSelectedContact] = useState<OrganizationContact | null>(null);
  const [selectedSite, setSelectedSite] = useState<SiteLocation | null>(null);
  const [useCustomSite, setUseCustomSite] = useState(false);
  const [customSite, setCustomSite] = useState<Address>({
    street: "",
    suburb: "",
    state: "VIC",
    postcode: "",
    country: "Australia",
  });
  const [isRetailBooking, setIsRetailBooking] = useState(false);
  const [retailContact, setRetailContact] = useState({
    firstName: "",
    lastName: "",
    mobile: "",
    email: "",
  });
  const [scheduledDate, setScheduledDate] = useState<Date | undefined>();
  const [scheduledTime, setScheduledTime] = useState("");
  const [finishDate, setFinishDate] = useState<Date | undefined>();
  const [finishTime, setFinishTime] = useState("");
  const [estimatedDurationHours, setEstimatedDurationHours] = useState("3");
  const [selectedStaff, setSelectedStaff] = useState<StaffMember[]>([]);
  const [bookingNotes, setBookingNotes] = useState("");
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);
  const [editScheduledDate, setEditScheduledDate] = useState<Date | undefined>();
  const [editScheduledTime, setEditScheduledTime] = useState("");
  const [editFinishDate, setEditFinishDate] = useState<Date | undefined>();
  const [editFinishTime, setEditFinishTime] = useState("");
  const [editStaff, setEditStaff] = useState<StaffMember[]>([]);
  const [editNotes, setEditNotes] = useState("");
  const [editOrganizationId, setEditOrganizationId] = useState("");
  const [editContactId, setEditContactId] = useState("");
  const [editContactsList, setEditContactsList] = useState<OrganizationContact[]>([]);
  const [editContactsError, setEditContactsError] = useState<string | null>(null);
  const [bookingToDelete, setBookingToDelete] = useState<Booking | null>(null);
  const [deletingBooking, setDeletingBooking] = useState(false);

  // New contact dialog (includes option to add new organisation)
  const [showNewContactDialog, setShowNewContactDialog] = useState(false);
  const [isCreatingNewOrg, setIsCreatingNewOrg] = useState(false);
  const [newOrgData, setNewOrgData] = useState<NewOrganisationFormData>({
    name: "",
    category: "trade_client",
    abn: "",
    phone: "",
    email: "",
    street: "",
    suburb: "",
    state: "VIC",
    postcode: "",
  });
  const [newContactData, setNewContactData] = useState<NewContactFormData>({
    organisationId: "",
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    mobile: "",
    jobTitle: "",
  });

  // Organization search
  const [orgSearchQuery, setOrgSearchQuery] = useState("");
  const [isCreatingBooking, setIsCreatingBooking] = useState(false);
  const clientOrganizations = useMemo(
    () => organizations.filter((org) => CLIENT_CONTACT_CATEGORIES.includes(org.category)),
    [organizations]
  );
  const filteredOrganizations = clientOrganizations.filter((org) => {
    const query = orgSearchQuery.toLowerCase();
    return org.name.toLowerCase().includes(query) || org.email?.toLowerCase().includes(query);
  });

  useEffect(() => {
    const orgQuery = query(collection(db, COLLECTIONS.CONTACT_ORGANIZATIONS), orderBy("name"));
    const staffQuery = query(
      collection(db, COLLECTIONS.USERS),
      where("role", "in", ["technician", "contractor", "admin"])
    );

    const unsubscribeOrgs = onSnapshot(
      orgQuery,
      (snapshot) => {
        const loaded = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<ContactOrganization, "id">),
        }));
        setOrganizations(loaded);
        setOrgsError(null);
        setHasLoadedOrgs(true);
      },
      (error) => {
        console.warn("Failed to load organisations:", error);
        setOrganizations([]);
        setOrgsError(error.message || "Unable to load organisations.");
        setHasLoadedOrgs(true);
      }
    );

    const unsubscribeStaff = onSnapshot(
      staffQuery,
      (snapshot) => {
        const loaded = snapshot.docs
          .map((docSnap) => {
            const data = docSnap.data() as { name?: string; role?: string; email?: string };
            const role = (data.role as string | undefined)
              ?? determineUserRole(data.email || "", "client");
            const staffType: StaffMember["type"] =
              role === "contractor" ? "subcontractor" : "asi_staff";
            return {
              id: docSnap.id,
              name: data.name || data.email || "Unknown",
              type: staffType,
              email: data.email,
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name));
        setRoleStaffList(loaded);
        setStaffError(null);
      },
      (error) => {
        console.warn("Failed to load staff list:", error);
        setRoleStaffList([]);
        setStaffError(error.message || "Unable to load staff.");
      }
    );

    return () => {
      unsubscribeOrgs();
      unsubscribeStaff();
    };
  }, []);

  useEffect(() => {
    if (ADMIN_EMAILS.length === 0) return;

    const adminQuery = query(
      collection(db, COLLECTIONS.USERS),
      where("email", "in", ADMIN_EMAILS)
    );

    const unsubscribeAdmins = onSnapshot(
      adminQuery,
      (snapshot) => {
        const loaded = snapshot.docs
          .map((docSnap) => {
            const data = docSnap.data() as { name?: string; role?: string; email?: string };
            const role = (data.role as string | undefined)
              ?? determineUserRole(data.email || "", "client");
            const staffType: StaffMember["type"] =
              role === "contractor" ? "subcontractor" : "asi_staff";
            return {
              id: docSnap.id,
              name: data.name || data.email || "Unknown",
              type: staffType,
              email: data.email,
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name));
        setAdminStaffList(loaded);
      },
      (error) => {
        console.warn("Failed to load admin staff list:", error);
        setAdminStaffList([]);
      }
    );

    return () => unsubscribeAdmins();
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
              name: fullName || data.email || "Unknown",
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
    if (!editOrganizationId) {
      setEditContactsList([]);
      setEditContactsError(null);
      return;
    }

    const contactQuery = query(
      collection(db, COLLECTIONS.ORGANIZATION_CONTACTS),
      where("organizationId", "==", editOrganizationId)
    );

    const unsubscribe = onSnapshot(
      contactQuery,
      (snapshot) => {
        const loaded = snapshot.docs
          .map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as Omit<OrganizationContact, "id">),
          }))
          .sort((a, b) =>
            `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)
          );
        setEditContactsList(loaded);
        setEditContactsError(null);
      },
      (error) => {
        console.warn("Failed to load edit contacts:", error);
        setEditContactsList([]);
        setEditContactsError(error.message || "Unable to load contacts.");
      }
    );

    return () => unsubscribe();
  }, [editOrganizationId]);

  useEffect(() => {
    const merged = new Map<string, StaffMember>();
    const addStaff = (staff: StaffMember) => {
      const key = staff.email?.toLowerCase().trim() || staff.id;
      if (!merged.has(key)) {
        merged.set(key, staff);
      }
    };

    roleStaffList.forEach(addStaff);
    adminStaffList.forEach(addStaff);
    asiContactStaffList.forEach(addStaff);

    setStaffList(
      Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name))
    );
  }, [roleStaffList, adminStaffList, asiContactStaffList]);

  useEffect(() => {
    if (!hasLoadedOrgs || hasSeededOrgs || orgsError) return;
    if (user?.role !== "admin" && user?.role !== "technician") return;

    const hasNonAsiOrg = organizations.some((org) => org.category !== "asi_staff");
    if (hasNonAsiOrg) return;

    const seedContacts = async () => {
      try {
        setHasSeededOrgs(true);
        const existingOrgIds = new Set(organizations.map((org) => org.id));
        const orgsToSeed = initialOrganizations.filter((org) => !existingOrgIds.has(org.id));
        if (orgsToSeed.length === 0) return;

        const seedOrgIds = new Set(orgsToSeed.map((org) => org.id));
        const contactsToSeed = initialContacts.filter((contact) =>
          seedOrgIds.has(contact.organizationId)
        );

        await Promise.all(
          orgsToSeed.map((org) =>
            createDocument(COLLECTIONS.CONTACT_ORGANIZATIONS, org.id, org)
          )
        );
        await Promise.all(
          contactsToSeed.map((contact) =>
            createDocument(COLLECTIONS.ORGANIZATION_CONTACTS, contact.id, contact)
          )
        );
      } catch (error) {
        console.warn("Failed to seed organisations:", error);
      }
    };

    seedContacts();
  }, [hasLoadedOrgs, hasSeededOrgs, orgsError, organizations.length, user?.role]);

  useEffect(() => {
    if (!selectedOrganization) {
      setContacts([]);
      setContactsError(null);
      return;
    }

    const contactQuery = query(
      collection(db, COLLECTIONS.ORGANIZATION_CONTACTS),
      where("organizationId", "==", selectedOrganization.id)
    );

    const unsubscribeContacts = onSnapshot(
      contactQuery,
      (snapshot) => {
        const loaded = snapshot.docs
          .map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as Omit<OrganizationContact, "id">),
          }))
          .sort((a, b) =>
            `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)
          );
        setContacts(loaded);
        setContactsError(null);
      },
      (error) => {
        console.warn("Failed to load organisation contacts:", error);
        setContacts([]);
        setContactsError(error.message || "Unable to load contacts.");
      }
    );

    return () => unsubscribeContacts();
  }, [selectedOrganization]);

  // Get contacts for selected organisation
  const organisationContacts = selectedOrganization
    ? contacts.filter((c) => c.organizationId === selectedOrganization.id)
    : [];

  // Get contacts for the selected org in new contact dialog
  const selectedDialogOrg = newContactData.organisationId 
    ? organizations.find(o => o.id === newContactData.organisationId)
    : null;
  const asiStaff = staffList.filter((s) => s.type === "asi_staff");
  const subcontractors = staffList.filter((s) => s.type === "subcontractor");
  const canSyncCalendar = user?.role === "admin" || user?.role === "technician";
  const RETAIL_ORG_NAME = "Retail End Users";
  const RETAIL_ORG_CATEGORY: ContactCategory = "retail_client";

  const staffEmailById = useMemo(
    () => new Map(staffList.map((staff) => [staff.id, staff.email])),
    [staffList]
  );

  const resolveStaffEmails = (staffMembers: StaffMember[]) =>
    staffMembers
      .map((staff) => staff.email || staffEmailById.get(staff.id))
      .filter((email): email is string => Boolean(email));

  const buildAttendeeEmails = (emails: (string | undefined)[]) => {
    const unique = new Set<string>();
    emails.forEach((email) => {
      const cleaned = email?.trim().toLowerCase();
      if (cleaned) unique.add(cleaned);
    });
    return Array.from(unique);
  };

  const syncCalendarEvent = async (
    payload: CalendarEventPayload,
    eventId?: string
  ): Promise<{ eventId?: string } | null> => {
    if (!firebaseUser || !canSyncCalendar) return null;
    const token = await firebaseUser.getIdToken();
    const endpoint = eventId
      ? "/api/google/calendar/update-event"
      : "/api/google/calendar/create-event";
    const body = eventId ? { eventId, ...payload } : payload;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null);
      const message =
        (errorPayload && typeof errorPayload.error === "string" && errorPayload.error) ||
        "Calendar sync failed.";
      throw new Error(message);
    }

    return (await response.json()) as { eventId?: string };
  };

  // Time slots
  const timeSlots = [
    "07:00", "07:30", "08:00", "08:30", "09:00", "09:30",
    "10:00", "10:30", "11:00", "11:30", "12:00", "12:30",
    "13:00", "13:30", "14:00", "14:30", "15:00", "15:30",
    "16:00", "16:30", "17:00",
  ];

  const handleSelectOrganization = (org: ContactOrganization) => {
    setSelectedOrganization(org);
    setSelectedContact(null);
    setOrgSearchQuery("");
    
    // Auto-select default site
    const defaultSite = org.sites.find((s) => s.isDefault) || org.sites[0];
    if (defaultSite) {
      const resolvedSite =
        org.address && defaultSite.isDefault
          ? { ...defaultSite, address: org.address }
          : defaultSite;
      setSelectedSite(resolvedSite);
    }
  };

  useEffect(() => {
    if (!selectedOrganization || selectedContact) return;
    const primaryContact = contacts.find((c) => c.isPrimary);
    if (primaryContact) {
      setSelectedContact(primaryContact);
    }
  }, [selectedOrganization, selectedContact, contacts]);

  useEffect(() => {
    if (!selectedOrganization) return;
    const updatedOrg = organizations.find((org) => org.id === selectedOrganization.id);
    if (!updatedOrg) return;
    if (updatedOrg !== selectedOrganization) {
      setSelectedOrganization(updatedOrg);
    }
    if (!updatedOrg.sites?.length) {
      return;
    }
    if (selectedSite) {
      const matchingSite = updatedOrg.sites.find((site) => site.id === selectedSite.id);
      if (matchingSite && matchingSite !== selectedSite) {
        setSelectedSite(matchingSite);
        return;
      }
    }
    const defaultSite = updatedOrg.sites.find((site) => site.isDefault) || updatedOrg.sites[0];
    if (defaultSite && (!selectedSite || defaultSite.id !== selectedSite.id)) {
      const resolvedSite =
        updatedOrg.address && defaultSite.isDefault
          ? { ...defaultSite, address: updatedOrg.address }
          : defaultSite;
      setSelectedSite(resolvedSite);
    }
  }, [organizations, selectedOrganization, selectedSite]);

  useEffect(() => {
    if (!isRetailBooking) return;
    setSelectedOrganization(null);
    setSelectedContact(null);
    setSelectedSite(null);
    setUseCustomSite(true);
  }, [isRetailBooking]);

  const handleCreateContact = async () => {
    let targetOrgId = newContactData.organisationId;
    let targetOrg: ContactOrganization | null = null;

    // If creating new organisation, create it first
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

      const createdOrgId = await addDocument(COLLECTIONS.CONTACT_ORGANIZATIONS, {
        ...newOrg,
      });
      targetOrgId = createdOrgId;
      targetOrg = { ...newOrg, id: createdOrgId };
    } else {
      targetOrg = organizations.find(o => o.id === targetOrgId) || null;
    }

    if (!targetOrg) return;

    // Get existing contacts for this org to determine if this is primary
    const existingContacts = contacts.filter(c => c.organizationId === targetOrgId);

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
      isPrimary: existingContacts.length === 0,
      hasPortalAccess: true,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };

    const createdContactId = await addDocument(COLLECTIONS.ORGANIZATION_CONTACTS, {
      ...newContact,
    });
    const createdContact = { ...newContact, id: createdContactId };
    
    // Auto-select the organisation and contact in the booking form
    setSelectedOrganization(targetOrg);
    setSelectedContact(createdContact);
    if (targetOrg.sites.length > 0) {
      setSelectedSite(targetOrg.sites.find(s => s.isDefault) || targetOrg.sites[0]);
    }

    // Reset and close dialog
    setShowNewContactDialog(false);
    resetNewContactForm();

    toast({
      title: "Contact Created",
      description: `${newContact.firstName} ${newContact.lastName} has been added to ${targetOrg.name}.`,
    });
  };

  const handleAddContactToExistingOrg = async () => {
    if (!selectedOrganization) return;

    const newContact: OrganizationContact = {
      id: `contact-${Date.now()}`,
      organizationId: selectedOrganization.id,
      firstName: newContactData.firstName,
      lastName: newContactData.lastName,
      email: newContactData.email,
      phone: newContactData.phone,
      mobile: newContactData.mobile,
      role: "primary",
      jobTitle: newContactData.jobTitle,
      status: "active",
      isPrimary: organisationContacts.length === 0,
      hasPortalAccess: true,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };

    const createdContactId = await addDocument(COLLECTIONS.ORGANIZATION_CONTACTS, {
      ...newContact,
    });
    setSelectedContact({ ...newContact, id: createdContactId });
    resetNewContactForm();

    toast({
      title: "Contact Created",
      description: `${newContact.firstName} ${newContact.lastName} has been added as a contact.`,
    });
  };

  const resetNewContactForm = () => {
    setNewContactData({
      organisationId: "",
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      mobile: "",
      jobTitle: "",
    });
    setNewOrgData({
      name: "",
      category: "trade_client",
      abn: "",
      phone: "",
      email: "",
      street: "",
      suburb: "",
      state: "VIC",
      postcode: "",
    });
    setIsCreatingNewOrg(false);
  };

  const handleToggleStaff = (staff: StaffMember) => {
    setSelectedStaff((prev) => {
      const exists = prev.find((s) => s.id === staff.id);
      if (exists) {
        return prev.filter((s) => s.id !== staff.id);
      }
      return [...prev, staff];
    });
  };

  const handleCreateBooking = async () => {
    if (isCreatingBooking) return;
    if (!bookingType || !scheduledDate || !scheduledTime) {
      toast({
        title: "Missing Information",
        description: "Please complete all required fields.",
        variant: "destructive",
      });
      return;
    }

    const durationHours = Number(estimatedDurationHours);
    if (!Number.isFinite(durationHours) || durationHours <= 0) {
      toast({
        title: "Missing duration",
        description: "Please enter an estimated duration (hours) for this booking.",
        variant: "destructive",
      });
      return;
    }

    if ((finishDate && !finishTime) || (!finishDate && finishTime)) {
      toast({
        title: "Finish time incomplete",
        description: "If you set a finish date/time, please set both fields.",
        variant: "destructive",
      });
      return;
    }

    if (finishDate && finishTime) {
      const [startHours, startMinutes] = scheduledTime
        .split(":")
        .map((part) => Number(part));
      const startAt = new Date(scheduledDate);
      if (Number.isFinite(startHours)) startAt.setHours(startHours);
      if (Number.isFinite(startMinutes)) startAt.setMinutes(startMinutes);
      startAt.setSeconds(0, 0);

      const [finishHours, finishMinutes] = finishTime
        .split(":")
        .map((part) => Number(part));
      const finishAt = new Date(finishDate);
      if (Number.isFinite(finishHours)) finishAt.setHours(finishHours);
      if (Number.isFinite(finishMinutes)) finishAt.setMinutes(finishMinutes);
      finishAt.setSeconds(0, 0);

      if (finishAt.getTime() <= startAt.getTime()) {
        toast({
          title: "Finish time invalid",
          description: "Finish date/time must be after the start date/time.",
          variant: "destructive",
        });
        return;
      }
    }

    if (
      isRetailBooking &&
      (!retailContact.firstName.trim() ||
        !retailContact.mobile.trim() ||
        !customSite.street.trim() ||
        !customSite.suburb.trim() ||
        !customSite.postcode.trim())
    ) {
      toast({
        title: "Missing retail details",
        description: "First name, mobile, and address are required for retail bookings.",
        variant: "destructive",
      });
      return;
    }

    if (
      !isRetailBooking &&
      (!selectedOrganization || !selectedContact || !selectedContact.email?.trim())
    ) {
      toast({
        title: "Missing Information",
        description: "Please select an organisation and contact (email required).",
        variant: "destructive",
      });
      return;
    }

    const isCustomSite = isRetailBooking || useCustomSite;
    const siteAddress = isCustomSite ? customSite : selectedSite?.address || customSite;

    setIsCreatingBooking(true);
    try {
      const bookingOrganization = isRetailBooking
        ? await ensureRetailOrganization()
        : selectedOrganization!;
      const bookingContact = isRetailBooking
        ? await createRetailContact(bookingOrganization.id)
        : selectedContact!;

      const created = await createBooking({
        bookingType: bookingType as BookingType,
        organization: bookingOrganization,
        contact: bookingContact,
        siteLocation: {
          id: isCustomSite ? undefined : selectedSite?.id,
          name: isCustomSite ? "Retail Address" : selectedSite?.name || "Custom Location",
          address: siteAddress,
          isDefault: false,
        },
        scheduledDate,
        scheduledTime,
        finishDate,
        finishTime: finishTime || undefined,
        resourceDurationTemplate: "na",
        resourceDurationOverrideHours: durationHours,
        allocatedStaff: selectedStaff.map((s) => ({ id: s.id, name: s.name, type: s.type })),
        notes: bookingNotes,
      });
      if (!created) {
        throw new Error("Unable to create booking.");
      }
      const { job, booking: createdBooking } = created;

      try {
        const attendeeEmails = buildAttendeeEmails([
          bookingContact.email,
          ...resolveStaffEmails(selectedStaff),
        ]);
        const calendarPayload = buildBookingCalendarPayload({
          bookingNumber: createdBooking.bookingNumber,
          jobNumber: job.jobNumber,
          bookingTypeLabel: BOOKING_TYPE_LABELS[bookingType as BookingType],
          organizationName: bookingOrganization.name,
          contactName: `${bookingContact.firstName} ${bookingContact.lastName}`.trim(),
          contactEmail: bookingContact.email?.trim(),
          contactPhone: resolveContactPhone(bookingContact),
          siteName: createdBooking.siteLocation.name,
          siteAddress: createdBooking.siteLocation.address,
          scheduledDate,
          scheduledTime,
          finishDate,
          finishTime: finishTime || undefined,
          durationHours,
          notes: bookingNotes || undefined,
          assignedStaff: selectedStaff.map((staff) => staff.name),
          attendees: attendeeEmails,
        });
        const calendarResult = await syncCalendarEvent(calendarPayload);
        if (calendarResult?.eventId) {
          await updateBooking(createdBooking.id, { calendarEventId: calendarResult.eventId });
        }
      } catch (calendarError: any) {
        toast({
          title: "Calendar sync skipped",
          description: calendarError?.message || "Booking saved without calendar sync.",
        });
      }

      toast({
        title: "Booking Created Successfully",
        description: (
          <div className="mt-2 space-y-1">
            <p>Your booking has been created.</p>
            {job && (
              <p className="text-sm text-muted-foreground">
                Job #{job.jobNumber} created {"->"} Added to Works Register {"->"} Updated Job Lifecycle
              </p>
            )}
          </div>
        ),
      });

      // Reset form
      resetBookingForm();
      setShowNewBookingDialog(false);

      // Navigate to the new job
      if (job) {
        router.push(`/dashboard/jobs/${job.id}`);
      }
    } catch (error: any) {
      toast({
        title: "Booking Failed",
        description: error.message || "Unable to create booking.",
        variant: "destructive",
      });
    } finally {
      setIsCreatingBooking(false);
    }
  };

  const resetBookingForm = () => {
    setBookingStep(1);
    setBookingType("");
    setSelectedOrganization(null);
    setSelectedContact(null);
    setSelectedSite(null);
    setUseCustomSite(false);
    setCustomSite({ street: "", suburb: "", state: "VIC", postcode: "", country: "Australia" });
    setIsRetailBooking(false);
    setRetailContact({ firstName: "", lastName: "", mobile: "", email: "" });
    setScheduledDate(undefined);
    setScheduledTime("");
    setFinishDate(undefined);
    setFinishTime("");
    setEstimatedDurationHours("3");
    setSelectedStaff([]);
    setBookingNotes("");
    setOrgSearchQuery("");
    resetNewContactForm();
  };

  const ensureRetailOrganization = async (): Promise<ContactOrganization> => {
    const existing = organizations.find(
      (org) => org.name === RETAIL_ORG_NAME && org.category === RETAIL_ORG_CATEGORY
    );
    if (existing) return existing;

    const now = Timestamp.now();
    const retailOrg: ContactOrganization = {
      id: `org-${Date.now()}`,
      name: RETAIL_ORG_NAME,
      category: RETAIL_ORG_CATEGORY,
      type: "customer",
      status: "active",
      jobCode: "RET",
      sites: [],
      createdAt: now,
      updatedAt: now,
    };

    const createdOrgId = await addDocument(COLLECTIONS.CONTACT_ORGANIZATIONS, {
      ...retailOrg,
    });
    return { ...retailOrg, id: createdOrgId };
  };

  const createRetailContact = async (
    organizationId: string
  ): Promise<OrganizationContact> => {
    const now = Timestamp.now();
    const contact: OrganizationContact = {
      id: `contact-${Date.now()}`,
      organizationId,
      firstName: retailContact.firstName.trim(),
      lastName: retailContact.lastName.trim(),
      email: retailContact.email.trim(),
      phone: "",
      mobile: retailContact.mobile.trim(),
      role: "primary",
      jobTitle: "",
      status: "active",
      isPrimary: true,
      hasPortalAccess: false,
      createdAt: now,
      updatedAt: now,
    };

    const createdContactId = await addDocument(COLLECTIONS.ORGANIZATION_CONTACTS, {
      ...contact,
    });
    return { ...contact, id: createdContactId };
  };

  const handleOpenEditBooking = (booking: Booking) => {
    setEditingBooking(booking);
    setEditScheduledDate(booking.scheduledDate.toDate());
    setEditScheduledTime(booking.scheduledTime);
    setEditFinishDate(booking.finishDate ? booking.finishDate.toDate() : undefined);
    setEditFinishTime(booking.finishTime || "");
    setEditNotes(booking.notes || "");
    setEditOrganizationId(booking.organizationId);
    setEditContactId(booking.contactId);
    setEditStaff(
      booking.allocatedStaff.map((staff) => ({
        id: staff.id,
        name: staff.name,
        type: staff.type,
      }))
    );
  };

  const handleCloseEditBooking = () => {
    setEditingBooking(null);
    setEditScheduledDate(undefined);
    setEditScheduledTime("");
    setEditFinishDate(undefined);
    setEditFinishTime("");
    setEditStaff([]);
    setEditNotes("");
    setEditOrganizationId("");
    setEditContactId("");
    setEditContactsList([]);
    setEditContactsError(null);
  };

  const handleToggleEditStaff = (staff: StaffMember) => {
    setEditStaff((prev) => {
      const exists = prev.find((s) => s.id === staff.id);
      if (exists) {
        return prev.filter((s) => s.id !== staff.id);
      }
      return [...prev, staff];
    });
  };

  const handleUpdateBooking = async () => {
    if (!editingBooking || !editScheduledDate || !editScheduledTime || editStaff.length === 0) {
      return;
    }

    if ((editFinishDate && !editFinishTime) || (!editFinishDate && editFinishTime)) {
      toast({
        title: "Finish time incomplete",
        description: "If you set a finish date/time, please set both fields.",
        variant: "destructive",
      });
      return;
    }

    if (editFinishDate && editFinishTime) {
      const [startHours, startMinutes] = editScheduledTime
        .split(":")
        .map((part) => Number(part));
      const startAt = new Date(editScheduledDate);
      if (Number.isFinite(startHours)) startAt.setHours(startHours);
      if (Number.isFinite(startMinutes)) startAt.setMinutes(startMinutes);
      startAt.setSeconds(0, 0);

      const [finishHours, finishMinutes] = editFinishTime
        .split(":")
        .map((part) => Number(part));
      const finishAt = new Date(editFinishDate);
      if (Number.isFinite(finishHours)) finishAt.setHours(finishHours);
      if (Number.isFinite(finishMinutes)) finishAt.setMinutes(finishMinutes);
      finishAt.setSeconds(0, 0);

      if (finishAt.getTime() <= startAt.getTime()) {
        toast({
          title: "Finish time invalid",
          description: "Finish date/time must be after the start date/time.",
          variant: "destructive",
        });
        return;
      }
    }

    const selectedOrg =
      organizations.find((org) => org.id === editOrganizationId) || selectedOrganization;
    if (!selectedOrg) {
      toast({
        title: "Missing Organisation",
        description: "Select an organisation before saving.",
        variant: "destructive",
      });
      return;
    }

    const selectedContact =
      editContactsList.find((contact) => contact.id === editContactId) || null;
    if (!selectedContact) {
      toast({
        title: "Missing Contact",
        description: "Select a contact before saving.",
        variant: "destructive",
      });
      return;
    }
    if (!selectedContact.email?.trim()) {
      toast({
        title: "Missing Contact Email",
        description: "The selected contact must have an email address.",
        variant: "destructive",
      });
      return;
    }

    const updatedStaff = editStaff.map((staff) => ({
      id: staff.id,
      name: staff.name,
      type: staff.type,
    }));

    const resolvedContactPhone = resolveContactPhone(selectedContact);

    const finishUpdates =
      editFinishDate && editFinishTime
        ? {
            finishDate: Timestamp.fromDate(editFinishDate),
            finishTime: editFinishTime,
          }
        : {
            finishDate: deleteField(),
            finishTime: deleteField(),
          };

    try {
      await updateBooking(editingBooking.id, {
        organizationId: selectedOrg.id,
        organizationName: selectedOrg.name,
        contactId: selectedContact.id,
        contactName: `${selectedContact.firstName} ${selectedContact.lastName}`.trim(),
        contactEmail: selectedContact.email.trim(),
        ...(resolvedContactPhone
          ? { contactPhone: resolvedContactPhone }
          : { contactPhone: deleteField() }),
        scheduledDate: Timestamp.fromDate(editScheduledDate),
        scheduledTime: editScheduledTime,
        ...finishUpdates,
        allocatedStaff: updatedStaff,
        allocatedStaffIds: updatedStaff.map((staff) => staff.id),
        ...(editNotes.trim() ? { notes: editNotes } : { notes: deleteField() }),
      });

      if (editingBooking.convertedJobId) {
        const now = Timestamp.now();
        const assignedTechnicians = updatedStaff.map((staff, index) => ({
          technicianId: staff.id,
          technicianName: staff.name,
          role: (index === 0 ? "primary" : "secondary") as "primary" | "secondary",
          assignedAt: now,
          assignedBy: user?.uid || "system",
        }));
        await updateJob(editingBooking.convertedJobId, {
          clientId: selectedOrg.id,
          clientName: selectedOrg.name,
          clientEmail: selectedContact.email.trim(),
          clientPhone: resolvedContactPhone,
          organizationId: selectedOrg.id,
          assignedTechnicians,
          assignedTechnicianIds: updatedStaff.map((staff) => staff.id),
          scheduledDate: Timestamp.fromDate(editScheduledDate),
          updatedAt: now,
        });

        const worksEntry = worksRegister.find(
          (entry) => entry.jobId === editingBooking.convertedJobId
        );
        if (worksEntry) {
          await updateWorksRegisterEntry(worksEntry.id, {
            organizationId: selectedOrg.id,
            clientName: selectedOrg.name,
            technicianId: updatedStaff[0]?.id || "unassigned",
            technicianName: updatedStaff[0]?.name || "Unassigned",
            startDate: Timestamp.fromDate(editScheduledDate),
          });
        }
      }

      try {
        const attendeeEmails = buildAttendeeEmails([
          selectedContact.email.trim(),
          ...resolveStaffEmails(editStaff),
        ]);
        const linkedJob = editingBooking.convertedJobId
          ? jobs.find((job) => job.id === editingBooking.convertedJobId)
          : null;
        const calendarPayload = buildBookingCalendarPayload({
          bookingNumber: editingBooking.bookingNumber,
          jobNumber: linkedJob?.jobNumber,
          bookingTypeLabel: BOOKING_TYPE_LABELS[editingBooking.bookingType],
          organizationName: selectedOrg.name,
          contactName: `${selectedContact.firstName} ${selectedContact.lastName}`.trim(),
          contactEmail: selectedContact.email.trim(),
          contactPhone: resolvedContactPhone,
          siteName: editingBooking.siteLocation.name,
          siteAddress: editingBooking.siteLocation.address,
          scheduledDate: editScheduledDate,
          scheduledTime: editScheduledTime,
          finishDate: editFinishDate,
          finishTime: editFinishTime || undefined,
          durationHours:
            typeof editingBooking.resourceDurationOverrideHours === "number"
              ? editingBooking.resourceDurationOverrideHours
              : undefined,
          notes: editNotes || undefined,
          assignedStaff: editStaff.map((staff) => staff.name),
          attendees: attendeeEmails,
        });
        const calendarResult = await syncCalendarEvent(
          calendarPayload,
          editingBooking.calendarEventId
        );
        if (!editingBooking.calendarEventId && calendarResult?.eventId) {
          await updateBooking(editingBooking.id, {
            calendarEventId: calendarResult.eventId,
          });
        }
      } catch (calendarError: any) {
        toast({
          title: "Calendar sync skipped",
          description: calendarError?.message || "Booking saved without calendar sync.",
        });
      }

      toast({
        title: "Booking Updated",
        description: "Booking details have been saved.",
      });
      handleCloseEditBooking();
    } catch (error: any) {
      toast({
        title: "Update Failed",
        description: error.message || "Unable to update booking.",
        variant: "destructive",
      });
    }
  };

  const handleRecycleBooking = async () => {
    if (!bookingToDelete) return;
    if (deletingBooking) return;
    if (!user) return;

    setDeletingBooking(true);
    try {
      const marker = `Job created from booking ${bookingToDelete.bookingNumber}`;
      const resolvedJobId =
        bookingToDelete.convertedJobId ||
        [...jobs, ...deletedJobs].find((job) =>
          job.statusLog?.some(
            (entry) => typeof entry.notes === "string" && entry.notes.includes(marker)
          )
        )?.id;

      const ensureWorksRegisterForJob = async (jobId: string) => {
        const existing =
          worksRegister.find((entry) => entry.jobId === jobId) ||
          (() => {
            const job = jobs.find((j) => j.id === jobId) || deletedJobs.find((j) => j.id === jobId);
            if (!job) return null;
            return worksRegister.find((entry) => entry.jobNumber === job.jobNumber) || null;
          })();
        if (existing) return;

        const job =
          jobs.find((j) => j.id === jobId) ||
          deletedJobs.find((j) => j.id === jobId) ||
          (await (async () => {
            const jobSnap = await getDoc(doc(db, COLLECTIONS.JOBS, jobId));
            if (!jobSnap.exists()) return null;
            return { id: jobSnap.id, ...(jobSnap.data() as Omit<Job, "id">) } as Job;
          })());
        if (!job) return;

        const worksRef = doc(collection(db, COLLECTIONS.WORKS_REGISTER));
        const primaryTech =
          job.assignedTechnicians?.find((tech) => tech.role === "primary") ||
          job.assignedTechnicians?.[0];
        const technicianName =
          primaryTech?.technicianName ||
          bookingToDelete.allocatedStaff?.[0]?.name ||
          "Unassigned";
        const serviceType = BOOKING_TYPE_LABELS[bookingToDelete.bookingType] || "Unknown";
        const worksEntry = createWorksRegisterEntry({
          job,
          serviceType,
          technicianName,
          entryId: worksRef.id,
        });
        await setDoc(worksRef, worksEntry);
      };

      if (resolvedJobId) {
        await ensureWorksRegisterForJob(resolvedJobId);
        await deleteJob(resolvedJobId, user.uid);
        await updateBooking(bookingToDelete.id, {
          status: "cancelled",
          ...(bookingToDelete.convertedJobId ? {} : { convertedJobId: resolvedJobId }),
        });
        toast({
          title: "Moved to Recycle Bin",
          description: "Job moved to Recycle Bin and booking marked as cancelled.",
        });
      } else {
        await updateBooking(bookingToDelete.id, { status: "cancelled" });
        toast({
          title: "Booking cancelled",
          description: "Booking marked as cancelled.",
        });
      }
      setBookingToDelete(null);
    } catch (error: any) {
      toast({
        title: "Recycle failed",
        description: error?.message || "Unable to recycle booking. Please try again.",
        variant: "destructive",
      });
    } finally {
      setDeletingBooking(false);
    }
  };

  const canProceedToStep2 = bookingType !== "";
  const retailContactValid =
    retailContact.firstName.trim() &&
    retailContact.mobile.trim() &&
    customSite.street.trim() &&
    customSite.suburb.trim() &&
    customSite.postcode.trim();
  const canProceedToStep3 = isRetailBooking
    ? Boolean(retailContactValid)
    : selectedOrganization !== null && selectedContact !== null;
  const showCustomSite = isRetailBooking || useCustomSite;
  const durationHoursValid =
    Number.isFinite(Number(estimatedDurationHours)) && Number(estimatedDurationHours) > 0;
  const canProceedToStep4 =
    scheduledDate !== undefined &&
    scheduledTime !== "" &&
    (selectedSite !== null || showCustomSite) &&
    durationHoursValid;
  const canSubmit = selectedStaff.length > 0;
  const summaryOrganizationName = isRetailBooking
    ? RETAIL_ORG_NAME
    : selectedOrganization?.name;
  const summaryContactName = isRetailBooking
    ? `${retailContact.firstName} ${retailContact.lastName}`.trim()
    : `${selectedContact?.firstName || ""} ${selectedContact?.lastName || ""}`.trim();

  const editStaffOptions = (() => {
    const merged = new Map<string, StaffMember>();
    const addStaff = (staff: StaffMember) => {
      const key = staff.email?.toLowerCase().trim() || staff.id;
      if (!merged.has(key)) {
        merged.set(key, staff);
      }
    };
    staffList.forEach(addStaff);
    editStaff.forEach(addStaff);
    return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
  })();
  const editAsiStaff = editStaffOptions.filter((s) => s.type === "asi_staff");
  const editSubcontractors = editStaffOptions.filter((s) => s.type === "subcontractor");

  const jobsById = useMemo(() => new Map(jobs.map((job) => [job.id, job])), [jobs]);
  const getBookingDisplayStatus = (booking: Booking) => {
    if (booking.status === "cancelled") return "cancelled";
    if (booking.convertedJobId) {
      const job = jobsById.get(booking.convertedJobId);
      if (job) {
        if (job.status === "completed" || job.status === "closed" || job.status === "cancelled") {
          return job.status;
        }
        if (isJobOnHold(job)) return "on_hold";
        return job.status;
      }
      return "converted_to_job";
    }
    return booking.status;
  };
  const getBookingStatusLabel = (status: string) =>
    status === "converted_to_job"
      ? "Converted"
      : status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  const getBookingStatusVariant = (status: string) => {
    switch (status) {
      case "completed":
      case "closed":
      case "in_progress":
        return "default";
      case "on_hold":
        return "secondary";
      case "scheduled":
      case "pending":
      case "confirmed":
        return "secondary";
      case "converted_to_job":
        return "outline";
      case "cancelled":
        return "destructive";
      default:
        return "secondary";
    }
  };

  const isClosedStatus = (status: string) => status === "completed" || status === "closed";

  const getBookingSortTimestamp = (booking: Booking) => {
    const scheduledDate = booking.scheduledDate?.toDate?.();
    if (scheduledDate) {
      const scheduledDateTime = new Date(scheduledDate);
      const [hours, minutes] = booking.scheduledTime
        ? booking.scheduledTime.split(":").map((part) => Number(part))
        : [];
      if (Number.isFinite(hours)) scheduledDateTime.setHours(hours);
      if (Number.isFinite(minutes)) scheduledDateTime.setMinutes(minutes);
      scheduledDateTime.setSeconds(0, 0);
      return scheduledDateTime.getTime();
    }
    return booking.createdAt?.toMillis?.() ?? 0;
  };

  const deletedJobIds = new Set(deletedJobs.map((job) => job.id));
  const filteredBookings = [...bookings.filter((booking) => {
    const matchesSearch =
      booking.bookingNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      booking.organizationName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      booking.contactName.toLowerCase().includes(searchQuery.toLowerCase());
    const hasDeletedJob =
      booking.convertedJobId && deletedJobIds.has(booking.convertedJobId);
    const matchesCancelled = includeCancelledBookings ? true : booking.status !== "cancelled";
    return matchesSearch && matchesCancelled && !hasDeletedJob;
  })].sort((a, b) => {
    const statusA = getBookingDisplayStatus(a);
    const statusB = getBookingDisplayStatus(b);
    const closedA = isClosedStatus(statusA);
    const closedB = isClosedStatus(statusB);
    if (closedA !== closedB) return closedA ? 1 : -1;

    const timeA = getBookingSortTimestamp(a);
    const timeB = getBookingSortTimestamp(b);
    if (timeA !== timeB) return timeA - timeB;
    return a.bookingNumber.localeCompare(b.bookingNumber);
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-3xl font-headline font-bold tracking-tight">Bookings</h2>
          <p className="text-muted-foreground">
            Create and manage service bookings
          </p>
        </div>
        <Dialog open={showNewBookingDialog} onOpenChange={(open) => {
          setShowNewBookingDialog(open);
          if (!open) resetBookingForm();
        }}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              New Booking
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle>Create New Booking</DialogTitle>
              <DialogDescription>
                Complete the booking details below. A job card will be automatically created upon confirmation.
              </DialogDescription>
            </DialogHeader>

            {/* Progress Steps */}
            <div className="flex items-center justify-between px-4 py-2 border-b">
              {[
                { step: 1, label: "Service Type" },
                { step: 2, label: "Customer" },
                { step: 3, label: "Schedule" },
                { step: 4, label: "Assign Staff" },
              ].map((item, idx) => (
                <div key={item.step} className="flex items-center">
                  <div
                    className={cn(
                      "flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium",
                      bookingStep >= item.step
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {bookingStep > item.step ? (
                      <CheckCircle className="h-5 w-5" />
                    ) : (
                      item.step
                    )}
                  </div>
                  <span
                    className={cn(
                      "ml-2 text-sm hidden sm:inline",
                      bookingStep >= item.step ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {item.label}
                  </span>
                  {idx < 3 && (
                    <ArrowRight className="h-4 w-4 mx-4 text-muted-foreground hidden sm:inline" />
                  )}
                </div>
              ))}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-1">
              <div className="p-4 space-y-6">
                {/* Step 1: Service Type */}
                {bookingStep === 1 && (
                  <div className="space-y-4">
                    <div>
                      <Label className="text-base font-semibold">Select Booking Type</Label>
                      <p className="text-sm text-muted-foreground mb-4">
                        Choose the type of service for this booking
                      </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {(Object.entries(BOOKING_TYPE_LABELS) as [BookingType, string][]).map(
                        ([value, label]) => (
                          <Card
                            key={value}
                            className={cn(
                              "cursor-pointer transition-all hover:border-primary/50",
                              bookingType === value
                                ? "border-primary bg-primary/5"
                                : "border-border/50"
                            )}
                            onClick={() => setBookingType(value)}
                          >
                            <CardContent className="flex items-center gap-3 p-4">
                              <div
                                className={cn(
                                  "w-4 h-4 rounded-full border-2 flex items-center justify-center",
                                  bookingType === value
                                    ? "border-primary"
                                    : "border-muted-foreground"
                                )}
                              >
                                {bookingType === value && (
                                  <div className="w-2 h-2 rounded-full bg-primary" />
                                )}
                              </div>
                              <span className="font-medium">{label}</span>
                            </CardContent>
                          </Card>
                        )
                      )}
                    </div>
                  </div>
                )}

                {/* Step 2: Customer Selection */}
                {bookingStep === 2 && (
                  <div className="space-y-6">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="retail-booking"
                        checked={isRetailBooking}
                        onCheckedChange={(checked) => setIsRetailBooking(checked as boolean)}
                      />
                      <Label htmlFor="retail-booking" className="cursor-pointer">
                        Retail end-user booking (no organisation)
                      </Label>
                    </div>

                    {isRetailBooking && (
                      <Card className="border-dashed">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-sm">Retail customer details</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <Label>First Name *</Label>
                              <Input
                                value={retailContact.firstName}
                                onChange={(e) =>
                                  setRetailContact({ ...retailContact, firstName: e.target.value })
                                }
                                placeholder="First name"
                              />
                            </div>
                            <div>
                              <Label>Last Name</Label>
                              <Input
                                value={retailContact.lastName}
                                onChange={(e) =>
                                  setRetailContact({ ...retailContact, lastName: e.target.value })
                                }
                                placeholder="Last name (optional)"
                              />
                            </div>
                            <div className="md:col-span-2">
                              <Label>Mobile *</Label>
                              <Input
                                value={retailContact.mobile}
                                onChange={(e) =>
                                  setRetailContact({ ...retailContact, mobile: e.target.value })
                                }
                                placeholder="0412 345 678"
                              />
                            </div>
                            <div className="md:col-span-2">
                              <Label>Email (optional)</Label>
                              <Input
                                type="email"
                                value={retailContact.email}
                                onChange={(e) =>
                                  setRetailContact({ ...retailContact, email: e.target.value })
                                }
                                placeholder="name@example.com"
                              />
                            </div>
                          </div>
                          <div className="space-y-3">
                            <Label className="text-sm font-semibold">Address</Label>
                            <div>
                              <Label>Street Address *</Label>
                              <Input
                                value={customSite.street}
                                onChange={(e) =>
                                  setCustomSite({ ...customSite, street: e.target.value })
                                }
                                placeholder="123 Work Site Road"
                              />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              <div>
                                <Label>Suburb *</Label>
                                <Input
                                  value={customSite.suburb}
                                  onChange={(e) =>
                                    setCustomSite({ ...customSite, suburb: e.target.value })
                                  }
                                  placeholder="Suburb"
                                />
                              </div>
                              <div>
                                <Label>State</Label>
                                <Select
                                  value={customSite.state}
                                  onValueChange={(value) =>
                                    setCustomSite({ ...customSite, state: value })
                                  }
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="NSW">NSW</SelectItem>
                                    <SelectItem value="VIC">VIC</SelectItem>
                                    <SelectItem value="QLD">QLD</SelectItem>
                                    <SelectItem value="WA">WA</SelectItem>
                                    <SelectItem value="SA">SA</SelectItem>
                                    <SelectItem value="TAS">TAS</SelectItem>
                                    <SelectItem value="NT">NT</SelectItem>
                                    <SelectItem value="ACT">ACT</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div>
                                <Label>Postcode *</Label>
                                <Input
                                  value={customSite.postcode}
                                  onChange={(e) =>
                                    setCustomSite({ ...customSite, postcode: e.target.value })
                                  }
                                  placeholder="2000"
                                />
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {!isRetailBooking && (
                      <>
                    {/* Organisation Selection */}
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <Label className="text-base font-semibold">Customer Organisation</Label>
                          <p className="text-sm text-muted-foreground">
                            Select an existing customer or add a new contact
                          </p>
                        </div>
                        <Dialog open={showNewContactDialog} onOpenChange={(open) => {
                          setShowNewContactDialog(open);
                          if (!open) resetNewContactForm();
                        }}>
                          <DialogTrigger asChild>
                            <Button variant="outline" size="sm" className="gap-2">
                              <Plus className="h-4 w-4" />
                              Add New Contact
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
                            <DialogHeader>
                              <DialogTitle>Add New Contact</DialogTitle>
                              <DialogDescription>
                                Add a contact to an existing organisation or create a new one
                              </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-6 py-4">
                              {/* Organisation Selection */}
                              <div className="space-y-3">
                                <Label className="text-sm font-semibold">Organisation</Label>
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
                                    <SelectValue placeholder="Select an organisation..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {clientOrganizations.map((org) => (
                                      <SelectItem key={org.id} value={org.id}>
                                        {org.name}
                                      </SelectItem>
                                    ))}
                                    <SelectItem value="__new__" className="text-primary font-medium">
                                      + Add New Organisation
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>

                              {/* New Organisation Fields */}
                              {isCreatingNewOrg && (
                                <Card className="border-dashed">
                                  <CardHeader className="pb-3">
                                    <CardTitle className="text-sm">New Organisation Details</CardTitle>
                                  </CardHeader>
                                  <CardContent className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                      <div className="col-span-2">
                                        <Label>Organisation Name *</Label>
                                        <Input
                                          value={newOrgData.name}
                                          onChange={(e) =>
                                            setNewOrgData({ ...newOrgData, name: e.target.value })
                                          }
                                          placeholder="Company Pty Ltd"
                                        />
                                      </div>
                                      <div>
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
                                            {CLIENT_CONTACT_CATEGORIES.map((category) => (
                                              <SelectItem key={category} value={category}>
                                                {CONTACT_CATEGORY_LABELS[category]}
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      </div>
                                      <div>
                                        <Label>ABN</Label>
                                        <Input
                                          value={newOrgData.abn}
                                          onChange={(e) =>
                                            setNewOrgData({ ...newOrgData, abn: e.target.value })
                                          }
                                          placeholder="12 345 678 901"
                                        />
                                      </div>
                                      <div>
                                        <Label>Organisation Phone</Label>
                                        <Input
                                          value={newOrgData.phone}
                                          onChange={(e) =>
                                            setNewOrgData({ ...newOrgData, phone: e.target.value })
                                          }
                                          placeholder="02 1234 5678"
                                        />
                                      </div>
                                      <div>
                                        <Label>Organisation Email</Label>
                                        <Input
                                          type="email"
                                          value={newOrgData.email}
                                          onChange={(e) =>
                                            setNewOrgData({ ...newOrgData, email: e.target.value })
                                          }
                                          placeholder="info@company.com.au"
                                        />
                                      </div>
                                      <div className="col-span-2">
                                        <Label>Street Address</Label>
                                        <Input
                                          value={newOrgData.street}
                                          onChange={(e) =>
                                            setNewOrgData({ ...newOrgData, street: e.target.value })
                                          }
                                          placeholder="123 Main Street"
                                        />
                                      </div>
                                      <div>
                                        <Label>Suburb</Label>
                                        <Input
                                          value={newOrgData.suburb}
                                          onChange={(e) =>
                                            setNewOrgData({ ...newOrgData, suburb: e.target.value })
                                          }
                                          placeholder="Sydney"
                                        />
                                      </div>
                                      <div className="grid grid-cols-2 gap-2">
                                        <div>
                                          <Label>State</Label>
                                          <Select
                                            value={newOrgData.state}
                                            onValueChange={(value) =>
                                              setNewOrgData({ ...newOrgData, state: value })
                                            }
                                          >
                                            <SelectTrigger>
                                              <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="NSW">NSW</SelectItem>
                                              <SelectItem value="VIC">VIC</SelectItem>
                                              <SelectItem value="QLD">QLD</SelectItem>
                                              <SelectItem value="WA">WA</SelectItem>
                                              <SelectItem value="SA">SA</SelectItem>
                                              <SelectItem value="TAS">TAS</SelectItem>
                                              <SelectItem value="NT">NT</SelectItem>
                                              <SelectItem value="ACT">ACT</SelectItem>
                                            </SelectContent>
                                          </Select>
                                        </div>
                                        <div>
                                          <Label>Postcode</Label>
                                          <Input
                                            value={newOrgData.postcode}
                                            onChange={(e) =>
                                              setNewOrgData({ ...newOrgData, postcode: e.target.value })
                                            }
                                            placeholder="2000"
                                          />
                                        </div>
                                      </div>
                                    </div>
                                  </CardContent>
                                </Card>
                              )}

                              {/* Primary Contact Details */}
                              {(isCreatingNewOrg || newContactData.organisationId) && (
                                <div className="space-y-4">
                                  <Label className="text-sm font-semibold">
                                    {isCreatingNewOrg ? "Primary Contact Details" : "Contact Details"}
                                  </Label>
                                  <div className="grid grid-cols-2 gap-4">
                                    <div>
                                      <Label>First Name *</Label>
                                      <Input
                                        value={newContactData.firstName}
                                        onChange={(e) =>
                                          setNewContactData({ ...newContactData, firstName: e.target.value })
                                        }
                                        placeholder="John"
                                      />
                                    </div>
                                    <div>
                                      <Label>Last Name *</Label>
                                      <Input
                                        value={newContactData.lastName}
                                        onChange={(e) =>
                                          setNewContactData({ ...newContactData, lastName: e.target.value })
                                        }
                                        placeholder="Smith"
                                      />
                                    </div>
                                    <div className="col-span-2">
                                      <Label>Email *</Label>
                                      <Input
                                        type="email"
                                        value={newContactData.email}
                                        onChange={(e) =>
                                          setNewContactData({ ...newContactData, email: e.target.value })
                                        }
                                        placeholder="john@company.com.au"
                                      />
                                    </div>
                                    <div>
                                      <Label>Phone</Label>
                                      <Input
                                        value={newContactData.phone}
                                        onChange={(e) =>
                                          setNewContactData({ ...newContactData, phone: e.target.value })
                                        }
                                        placeholder="02 1234 5678"
                                      />
                                    </div>
                                    <div>
                                      <Label>Mobile</Label>
                                      <Input
                                        value={newContactData.mobile}
                                        onChange={(e) =>
                                          setNewContactData({ ...newContactData, mobile: e.target.value })
                                        }
                                        placeholder="0412 345 678"
                                      />
                                    </div>
                                    <div className="col-span-2">
                                      <Label>Job Title</Label>
                                      <Input
                                        value={newContactData.jobTitle}
                                        onChange={(e) =>
                                          setNewContactData({ ...newContactData, jobTitle: e.target.value })
                                        }
                                        placeholder="Fleet Manager"
                                      />
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                            <DialogFooter>
                              <Button variant="outline" onClick={() => {
                                setShowNewContactDialog(false);
                                resetNewContactForm();
                              }}>
                                Cancel
                              </Button>
                              <Button
                                onClick={handleCreateContact}
                                disabled={
                                  (!isCreatingNewOrg && !newContactData.organisationId) ||
                                  (isCreatingNewOrg && !newOrgData.name) ||
                                  !newContactData.firstName ||
                                  !newContactData.lastName ||
                                  !newContactData.email
                                }
                              >
                                {isCreatingNewOrg ? "Create Organisation & Contact" : "Add Contact"}
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      </div>

                      {selectedOrganization ? (
                        <Card className="border-primary bg-primary/5">
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between">
                              <div className="flex items-start gap-3">
                                <div className="p-2 bg-primary/10 rounded-lg">
                                  <Building2 className="h-5 w-5 text-primary" />
                                </div>
                                <div>
                                  <p className="font-semibold">{selectedOrganization.name}</p>
                                  <p className="text-sm text-muted-foreground">
                                    {CONTACT_CATEGORY_LABELS[selectedOrganization.category]}
                                  </p>
                                  <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                                    {selectedOrganization.phone && (
                                      <span className="flex items-center gap-1">
                                        <Phone className="h-3 w-3" />
                                        {selectedOrganization.phone}
                                      </span>
                                    )}
                                    {selectedOrganization.email && (
                                      <span className="flex items-center gap-1">
                                        <Mail className="h-3 w-3" />
                                        {selectedOrganization.email}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedOrganization(null);
                                  setSelectedContact(null);
                                  setSelectedSite(null);
                                }}
                              >
                                Change
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ) : (
                        <div className="space-y-3">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                              placeholder="Search customers..."
                              value={orgSearchQuery}
                              onChange={(e) => setOrgSearchQuery(e.target.value)}
                              className="pl-10"
                            />
                          </div>
                          {orgsError && (
                            <p className="text-sm text-destructive">
                              Unable to load organisations. Check your Firestore permissions or indexes.
                            </p>
                          )}
                          <ScrollArea className="h-[200px]">
                            <div className="space-y-2">
                              {filteredOrganizations.map((org) => (
                                <Card
                                  key={org.id}
                                  className="cursor-pointer transition-all hover:border-primary/50"
                                  onClick={() => handleSelectOrganization(org)}
                                >
                                  <CardContent className="p-3">
                                    <div className="flex items-center gap-3">
                                      <Building2 className="h-4 w-4 text-muted-foreground" />
                                      <div className="flex-1">
                                        <p className="font-medium text-sm">{org.name}</p>
                                        <p className="text-xs text-muted-foreground">
                                          {CONTACT_CATEGORY_LABELS[org.category]}
                                        </p>
                                      </div>
                                      <Badge variant="outline" className="text-xs">
                                        {org.status}
                                      </Badge>
                                    </div>
                                  </CardContent>
                                </Card>
                              ))}
                              {filteredOrganizations.length === 0 && !orgsError && (
                                <p className="text-sm text-muted-foreground">
                                  No organisations available. Add one in Contacts or adjust permissions.
                                </p>
                              )}
                            </div>
                          </ScrollArea>
                        </div>
                      )}
                    </div>

                    {/* Contact Selection */}
                    {selectedOrganization && (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <Label className="text-base font-semibold">Contact Person</Label>
                            <p className="text-sm text-muted-foreground">
                              Select or add a contact for this booking
                            </p>
                          </div>
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button variant="outline" size="sm" className="gap-2">
                                <Plus className="h-4 w-4" />
                                New Contact
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-md">
                              <DialogHeader>
                                <DialogTitle>Add New Contact</DialogTitle>
                                <DialogDescription>
                                  Add a new contact for {selectedOrganization.name}
                                </DialogDescription>
                              </DialogHeader>
                              <div className="space-y-4 py-4">
                                <div className="grid grid-cols-2 gap-4">
                                  <div>
                                    <Label>First Name *</Label>
                                    <Input
                                      value={newContactData.firstName}
                                      onChange={(e) =>
                                        setNewContactData({ ...newContactData, firstName: e.target.value })
                                      }
                                      placeholder="John"
                                    />
                                  </div>
                                  <div>
                                    <Label>Last Name *</Label>
                                    <Input
                                      value={newContactData.lastName}
                                      onChange={(e) =>
                                        setNewContactData({ ...newContactData, lastName: e.target.value })
                                      }
                                      placeholder="Smith"
                                    />
                                  </div>
                                  <div className="col-span-2">
                                    <Label>Email *</Label>
                                    <Input
                                      type="email"
                                      value={newContactData.email}
                                      onChange={(e) =>
                                        setNewContactData({ ...newContactData, email: e.target.value })
                                      }
                                      placeholder="john@company.com.au"
                                    />
                                  </div>
                                  <div>
                                    <Label>Phone</Label>
                                    <Input
                                      value={newContactData.phone}
                                      onChange={(e) =>
                                        setNewContactData({ ...newContactData, phone: e.target.value })
                                      }
                                      placeholder="02 1234 5678"
                                    />
                                  </div>
                                  <div>
                                    <Label>Mobile</Label>
                                    <Input
                                      value={newContactData.mobile}
                                      onChange={(e) =>
                                        setNewContactData({ ...newContactData, mobile: e.target.value })
                                      }
                                      placeholder="0412 345 678"
                                    />
                                  </div>
                                  <div className="col-span-2">
                                    <Label>Job Title</Label>
                                    <Input
                                      value={newContactData.jobTitle}
                                      onChange={(e) =>
                                        setNewContactData({ ...newContactData, jobTitle: e.target.value })
                                      }
                                      placeholder="Fleet Manager"
                                    />
                                  </div>
                                </div>
                              </div>
                              <DialogFooter>
                                <Button
                                  onClick={handleAddContactToExistingOrg}
                                  disabled={
                                    !newContactData.firstName ||
                                    !newContactData.lastName ||
                                    !newContactData.email
                                  }
                                >
                                  Add Contact
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        </div>

                        <div className="pr-1">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {organisationContacts.map((contact) => (
                            <Card
                              key={contact.id}
                              className={cn(
                                "cursor-pointer transition-all hover:border-primary/50",
                                selectedContact?.id === contact.id
                                  ? "border-primary bg-primary/5"
                                  : "border-border/50"
                              )}
                              onClick={() => setSelectedContact(contact)}
                            >
                              <CardContent className="p-4">
                                <div className="flex items-start gap-3">
                                  <div
                                    className={cn(
                                      "w-4 h-4 mt-1 rounded-full border-2 flex items-center justify-center",
                                      selectedContact?.id === contact.id
                                        ? "border-primary"
                                        : "border-muted-foreground"
                                    )}
                                  >
                                    {selectedContact?.id === contact.id && (
                                      <div className="w-2 h-2 rounded-full bg-primary" />
                                    )}
                                  </div>
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                      <p className="font-medium">
                                        {contact.firstName} {contact.lastName}
                                      </p>
                                      {contact.isPrimary && (
                                        <Badge variant="secondary" className="text-xs">
                                          Primary
                                        </Badge>
                                      )}
                                    </div>
                                    <p className="text-sm text-muted-foreground">{contact.jobTitle}</p>
                                    <div className="flex flex-col gap-1 mt-2 text-sm text-muted-foreground">
                                      <span className="flex items-center gap-1">
                                        <Mail className="h-3 w-3" />
                                        {contact.email}
                                      </span>
                                      {(contact.mobile || contact.phone) && (
                                        <span className="flex items-center gap-1">
                                          <Phone className="h-3 w-3" />
                                          {contact.mobile || contact.phone}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                          {contactsError && (
                            <p className="text-sm text-destructive">
                              Unable to load contacts. Check Firestore permissions or refresh.
                            </p>
                          )}
                          {!contactsError && organisationContacts.length === 0 && (
                            <p className="text-sm text-muted-foreground">
                              No contacts found for this organisation. Add one to continue.
                            </p>
                          )}
                          </div>
                        </div>
                      </div>
                    )}
                      </>
                    )}
                  </div>
                )}

                {/* Step 3: Schedule & Location */}
                {bookingStep === 3 && (
                  <div className="space-y-6">
                    {/* Date & Time */}
                    <div className="space-y-4">
                      <div>
                        <Label className="text-base font-semibold">Booking Date & Time</Label>
                        <p className="text-sm text-muted-foreground">
                          Select when this service should be scheduled
                        </p>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Date *</Label>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                className={cn(
                                  "w-full justify-start text-left font-normal",
                                  !scheduledDate && "text-muted-foreground"
                                )}
                              >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {scheduledDate ? format(scheduledDate, "PPP") : "Select date"}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={scheduledDate}
                                onSelect={setScheduledDate}
                                disabled={(date) => date < startOfDay(new Date())}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                        </div>
                        <div className="space-y-2">
                          <Label>Time *</Label>
                          <Select value={scheduledTime} onValueChange={setScheduledTime}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select time" />
                            </SelectTrigger>
                            <SelectContent className="max-h-[40vh]">
                              {timeSlots.map((time) => (
                                <SelectItem key={time} value={time}>
                                  {time}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm font-semibold">Finish (optional)</Label>
                          {(finishDate || finishTime) && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setFinishDate(undefined);
                                setFinishTime("");
                              }}
                            >
                              Clear
                            </Button>
                          )}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Finish date</Label>
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button
                                  variant="outline"
                                  className={cn(
                                    "w-full justify-start text-left font-normal",
                                    !finishDate && "text-muted-foreground"
                                  )}
                                >
                                  <CalendarIcon className="mr-2 h-4 w-4" />
                                  {finishDate ? format(finishDate, "PPP") : "Select date"}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0" align="start">
                                <Calendar
                                  mode="single"
                                  selected={finishDate}
                                  onSelect={setFinishDate}
                                  disabled={(date) => date < startOfDay(new Date())}
                                  initialFocus
                                />
                              </PopoverContent>
                            </Popover>
                          </div>
                          <div className="space-y-2">
                            <Label>Finish time</Label>
                            <Select
                              value={finishTime}
                              onValueChange={setFinishTime}
                              disabled={!finishDate}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder={finishDate ? "Select time" : "Select date first"} />
                              </SelectTrigger>
                              <SelectContent className="max-h-[40vh]">
                                {timeSlots.map((time) => (
                                  <SelectItem key={time} value={time}>
                                    {time}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Optional: set an explicit finish so the Resource Planner and calendar reflect the true window.
                        </p>
                      </div>
                    </div>

                    {/* Duration */}
                    <div className="space-y-4">
                      <div>
                        <Label className="text-base font-semibold">Estimated Duration</Label>
                        <p className="text-sm text-muted-foreground">
                          Used to reserve staff capacity in the Resource Planner and set the Google Calendar window.
                        </p>
                      </div>
                      <div className="space-y-2 max-w-xl">
                        <Label>Duration (hours) *</Label>
                        <Input
                          type="number"
                          min={0.5}
                          step={0.5}
                          value={estimatedDurationHours}
                          onChange={(e) => setEstimatedDurationHours(e.target.value)}
                          placeholder="e.g. 3"
                        />
                        <p className="text-xs text-muted-foreground">
                          Converted using {HOURS_PER_WORKDAY}h workdays for multi-day bookings. You can still override
                          the finish date/time if needed.
                        </p>
                      </div>
                    </div>

                    {/* Site Location */}
                    <div className="space-y-4">
                      <div>
                        <Label className="text-base font-semibold">Site Location</Label>
                        <p className="text-sm text-muted-foreground">
                          Select the work site for this booking
                        </p>
                      </div>

                      {!isRetailBooking &&
                        selectedOrganization &&
                        selectedOrganization.sites.length > 0 &&
                        !useCustomSite && (
                        <div className="pr-1 space-y-3">
                          {selectedOrganization.sites.map((site) => (
                            <Card
                              key={site.id}
                              className={cn(
                                "cursor-pointer transition-all hover:border-primary/50",
                                selectedSite?.id === site.id
                                  ? "border-primary bg-primary/5"
                                  : "border-border/50"
                              )}
                              onClick={() => setSelectedSite(site)}
                            >
                              <CardContent className="p-4">
                                <div className="flex items-start gap-3">
                                  <div
                                    className={cn(
                                      "w-4 h-4 mt-1 rounded-full border-2 flex items-center justify-center",
                                      selectedSite?.id === site.id
                                        ? "border-primary"
                                        : "border-muted-foreground"
                                    )}
                                  >
                                    {selectedSite?.id === site.id && (
                                      <div className="w-2 h-2 rounded-full bg-primary" />
                                    )}
                                  </div>
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                      <p className="font-medium">{site.name}</p>
                                      {site.isDefault && (
                                        <Badge variant="secondary" className="text-xs">
                                          Default
                                        </Badge>
                                      )}
                                    </div>
                                    <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                                      <MapPin className="h-3 w-3" />
                                      {site.address.street}, {site.address.suburb} {site.address.state}{" "}
                                      {site.address.postcode}
                                    </p>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      )}

                      {!isRetailBooking && (
                        <div className="flex items-center space-x-2 pt-2">
                          <Checkbox
                            id="customSite"
                            checked={useCustomSite}
                            onCheckedChange={(checked) => {
                              setUseCustomSite(checked as boolean);
                              if (checked) setSelectedSite(null);
                            }}
                          />
                          <Label htmlFor="customSite" className="cursor-pointer">
                            Use a different/custom location
                          </Label>
                        </div>
                      )}

                      {showCustomSite && (
                        <Card className="border-dashed">
                          <CardContent className="p-4 space-y-4">
                            <div>
                              <Label>Street Address *</Label>
                              <Input
                                value={customSite.street}
                                onChange={(e) =>
                                  setCustomSite({ ...customSite, street: e.target.value })
                                }
                                placeholder="123 Work Site Road"
                              />
                            </div>
                            <div className="grid grid-cols-3 gap-4">
                              <div>
                                <Label>Suburb *</Label>
                                <Input
                                  value={customSite.suburb}
                                  onChange={(e) =>
                                    setCustomSite({ ...customSite, suburb: e.target.value })
                                  }
                                  placeholder="Sydney"
                                />
                              </div>
                              <div>
                                <Label>State</Label>
                                <Select
                                  value={customSite.state}
                                  onValueChange={(value) =>
                                    setCustomSite({ ...customSite, state: value })
                                  }
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="NSW">NSW</SelectItem>
                                    <SelectItem value="VIC">VIC</SelectItem>
                                    <SelectItem value="QLD">QLD</SelectItem>
                                    <SelectItem value="WA">WA</SelectItem>
                                    <SelectItem value="SA">SA</SelectItem>
                                    <SelectItem value="TAS">TAS</SelectItem>
                                    <SelectItem value="NT">NT</SelectItem>
                                    <SelectItem value="ACT">ACT</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div>
                                <Label>Postcode *</Label>
                                <Input
                                  value={customSite.postcode}
                                  onChange={(e) =>
                                    setCustomSite({ ...customSite, postcode: e.target.value })
                                  }
                                  placeholder="2000"
                                />
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  </div>
                )}

                {/* Step 4: Assign Staff */}
                {bookingStep === 4 && (
                  <div className="space-y-6">
                    <div>
                      <Label className="text-base font-semibold">Allocate Staff</Label>
                      <p className="text-sm text-muted-foreground">
                        Select ASI staff and/or subcontractors for this job
                      </p>
                      {staffError && (
                        <p className="text-sm text-destructive mt-2">
                          Unable to load staff list. Check Firestore permissions and refresh.
                        </p>
                      )}
                    </div>

                    <div className="space-y-4">
                      <div>
                        <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                          <Users className="h-4 w-4" />
                          ASI Staff
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {asiStaff.map((staff) => (
                              <Card
                                key={staff.id}
                                className={cn(
                                  "cursor-pointer transition-all hover:border-primary/50",
                                  selectedStaff.find((s) => s.id === staff.id)
                                    ? "border-primary bg-primary/5"
                                    : "border-border/50"
                                )}
                                onClick={() => handleToggleStaff(staff)}
                              >
                                <CardContent className="p-4">
                                  <div className="flex items-center gap-3">
                                    <Checkbox
                                      checked={!!selectedStaff.find((s) => s.id === staff.id)}
                                      onCheckedChange={() => handleToggleStaff(staff)}
                                    />
                                    <div className="flex items-center gap-2">
                                      <User className="h-4 w-4 text-muted-foreground" />
                                      <span className="font-medium">{staff.name}</span>
                                    </div>
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                          {!staffError && asiStaff.length === 0 && (
                            <p className="text-sm text-muted-foreground">
                              No ASI staff accounts found. Check the Users collection.
                            </p>
                          )}
                        </div>
                      </div>

                      <div>
                        <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                          <Building2 className="h-4 w-4" />
                          Subcontractors
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {subcontractors.map((staff) => (
                              <Card
                                key={staff.id}
                                className={cn(
                                  "cursor-pointer transition-all hover:border-primary/50",
                                  selectedStaff.find((s) => s.id === staff.id)
                                    ? "border-primary bg-primary/5"
                                    : "border-border/50"
                                )}
                                onClick={() => handleToggleStaff(staff)}
                              >
                                <CardContent className="p-4">
                                  <div className="flex items-center gap-3">
                                    <Checkbox
                                      checked={!!selectedStaff.find((s) => s.id === staff.id)}
                                      onCheckedChange={() => handleToggleStaff(staff)}
                                    />
                                    <div className="flex items-center gap-2">
                                      <Building2 className="h-4 w-4 text-muted-foreground" />
                                      <span className="font-medium">{staff.name}</span>
                                    </div>
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                          {!staffError && subcontractors.length === 0 && (
                            <p className="text-sm text-muted-foreground">
                              No subcontractor accounts found. Add one in Contacts or Users.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Notes */}
                    <div className="space-y-2">
                      <Label>Booking Notes (Optional)</Label>
                      <Textarea
                        value={bookingNotes}
                        onChange={(e) => setBookingNotes(e.target.value)}
                        placeholder="Any special instructions or notes for this booking..."
                        rows={3}
                      />
                    </div>

                    {/* Summary */}
                    {selectedStaff.length > 0 && (
                      <Card className="bg-muted/50">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm font-medium">Booking Summary</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Service:</span>
                            <span className="font-medium">
                              {bookingType && BOOKING_TYPE_LABELS[bookingType as BookingType]}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Customer:</span>
                            <span className="font-medium">{summaryOrganizationName}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Contact:</span>
                            <span className="font-medium">{summaryContactName}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Date & Time:</span>
                            <span className="font-medium">
                              {scheduledDate && format(scheduledDate, "PPP")} at {scheduledTime}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Assigned:</span>
                            <span className="font-medium">
                              {selectedStaff.map((s) => s.name).join(", ")}
                            </span>
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                )}
              </div>
            </div>

            <DialogFooter className="border-t pt-4">
              <div className="flex w-full justify-between">
                <Button
                  variant="outline"
                  onClick={() => {
                    if (bookingStep > 1) {
                      setBookingStep(bookingStep - 1);
                    } else {
                      setShowNewBookingDialog(false);
                      resetBookingForm();
                    }
                  }}
                >
                  {bookingStep === 1 ? "Cancel" : "Back"}
                </Button>
                <div className="flex gap-2">
                  {bookingStep < 4 ? (
                    <Button
                      onClick={() => setBookingStep(bookingStep + 1)}
                      disabled={
                        (bookingStep === 1 && !canProceedToStep2) ||
                        (bookingStep === 2 && !canProceedToStep3) ||
                        (bookingStep === 3 && !canProceedToStep4)
                      }
                    >
                      Continue
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  ) : (
                    <Button onClick={handleCreateBooking} disabled={!canSubmit || isCreatingBooking}>
                      {isCreatingBooking ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="h-4 w-4 rounded-full border-2 border-current/30 border-t-current animate-spin" />
                          Saving...
                        </span>
                      ) : (
                        <>
                          <CheckCircle className="mr-2 h-4 w-4" />
                          Confirm Booking
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search & Filter */}
      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search bookings..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex gap-2">
              <Select defaultValue="all">
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="converted">Converted</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <Select defaultValue="all">
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Service Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Services</SelectItem>
                  {(Object.entries(BOOKING_TYPE_LABELS) as [BookingType, string][]).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2 rounded-md border border-border/50 px-3">
                <Checkbox
                  id="include-cancelled-bookings"
                  checked={includeCancelledBookings}
                  onCheckedChange={(checked) => setIncludeCancelledBookings(checked === true)}
                />
                <Label
                  htmlFor="include-cancelled-bookings"
                  className="text-sm text-muted-foreground"
                >
                  Show cancelled
                </Label>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bookings Table */}
      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Briefcase className="h-5 w-5" />
            Recent Bookings
          </CardTitle>
          <CardDescription>
            {filteredBookings.length} booking{filteredBookings.length !== 1 && "s"} found
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Booking #</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Date & Time</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredBookings.map((booking) => {
                const displayStatus = getBookingDisplayStatus(booking);
                return (
                <TableRow
                  key={booking.id}
                  className="cursor-pointer hover:bg-muted/20"
                  onClick={() => {
                    if (booking.convertedJobId) {
                      router.push(`/dashboard/jobs/${booking.convertedJobId}`);
                      return;
                    }
                    toast({
                      title: "Job Not Available",
                      description: "This booking has not been converted into a job yet.",
                      variant: "destructive",
                    });
                  }}
                >
                  <TableCell className="font-medium">{booking.bookingNumber}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {BOOKING_TYPE_LABELS[booking.bookingType]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium">{booking.organizationName}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {booking.siteLocation.address.suburb}, {booking.siteLocation.address.state}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div>
                      <p>{booking.contactName}</p>
                      <p className="text-xs text-muted-foreground">{booking.contactEmail}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p>{format(booking.scheduledDate.toDate(), "PP")}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {booking.scheduledTime}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {booking.allocatedStaff.map((staff) => (
                        <Badge
                          key={staff.id}
                          variant={staff.type === "asi_staff" ? "default" : "secondary"}
                          className="text-xs"
                        >
                          {staff.name.split(" ")[0]}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={getBookingStatusVariant(displayStatus)}
                    >
                      {getBookingStatusLabel(displayStatus)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleOpenEditBooking(booking);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={(event) => {
                        event.stopPropagation();
                        setBookingToDelete(booking);
                      }}
                    >
                      <Trash2 className="mr-1 h-4 w-4" />
                      Recycle
                    </Button>
                    {booking.convertedJobId ? (
                      <Button variant="ghost" size="sm" asChild>
                        <Link
                          href={`/dashboard/jobs/${booking.convertedJobId}`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          View
                        </Link>
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          toast({
                            title: "Job Not Available",
                            description: "This booking has not been converted into a job yet.",
                            variant: "destructive",
                          });
                        }}
                      >
                        View
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
              })}
              {filteredBookings.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    No bookings found. Create your first booking to get started.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!editingBooking} onOpenChange={(open) => {
        if (!open) handleCloseEditBooking();
      }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Booking</DialogTitle>
            <DialogDescription>
              Update the booking schedule, assigned staff, and notes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-2">
            <div className="space-y-3">
              <Label className="text-base font-semibold">Organisation</Label>
              <Select
                value={editOrganizationId}
                onValueChange={(value) => {
                  setEditOrganizationId(value);
                  setEditContactId("");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select organisation" />
                </SelectTrigger>
                <SelectContent>
                  {clientOrganizations.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              <Label className="text-base font-semibold">Contact</Label>
              <Select
                value={editContactId}
                onValueChange={setEditContactId}
                disabled={!editOrganizationId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select contact" />
                </SelectTrigger>
                <SelectContent>
                  {editContactsList.map((contact) => (
                    <SelectItem key={contact.id} value={contact.id}>
                      {contact.firstName} {contact.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editContactsError && (
                <p className="text-sm text-destructive">
                  Unable to load contacts. Check permissions and refresh.
                </p>
              )}
              {!editContactsError && editOrganizationId && editContactsList.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No contacts found for this organisation.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Booking Date *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !editScheduledDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {editScheduledDate ? format(editScheduledDate, "PPP") : "Select date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={editScheduledDate}
                      onSelect={setEditScheduledDate}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label>Booking Time *</Label>
                <Select value={editScheduledTime} onValueChange={setEditScheduledTime}>
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

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">Finish (optional)</Label>
                {(editFinishDate || editFinishTime) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditFinishDate(undefined);
                      setEditFinishTime("");
                    }}
                  >
                    Clear
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Finish Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !editFinishDate && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {editFinishDate ? format(editFinishDate, "PPP") : "Select date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={editFinishDate}
                        onSelect={setEditFinishDate}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <Label>Finish Time</Label>
                  <Select
                    value={editFinishTime}
                    onValueChange={setEditFinishTime}
                    disabled={!editFinishDate}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={editFinishDate ? "Select time" : "Select date first"}
                      />
                    </SelectTrigger>
                    <SelectContent className="max-h-[40vh]">
                      {timeSlots.map((slot) => (
                        <SelectItem key={slot} value={slot}>
                          {slot}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">Assigned Staff *</Label>
                {staffError && (
                  <span className="text-xs text-destructive">Unable to load staff list.</span>
                )}
              </div>
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium mb-2">ASI Staff</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {editAsiStaff.map((staff) => (
                      <Card
                        key={staff.email ? staff.email.toLowerCase() : staff.id}
                        className={cn(
                          "cursor-pointer transition-all hover:border-primary/50",
                          editStaff.find((s) => s.id === staff.id)
                            ? "border-primary bg-primary/5"
                            : "border-border/50"
                        )}
                        onClick={() => handleToggleEditStaff(staff)}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-center gap-3">
                            <Checkbox
                              checked={!!editStaff.find((s) => s.id === staff.id)}
                              onCheckedChange={() => handleToggleEditStaff(staff)}
                            />
                            <div className="flex items-center gap-2">
                              <User className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium">{staff.name}</span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                    {!staffError && editAsiStaff.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        No ASI staff accounts found.
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium mb-2">Subcontractors</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {editSubcontractors.map((staff) => (
                      <Card
                        key={staff.email ? staff.email.toLowerCase() : staff.id}
                        className={cn(
                          "cursor-pointer transition-all hover:border-primary/50",
                          editStaff.find((s) => s.id === staff.id)
                            ? "border-primary bg-primary/5"
                            : "border-border/50"
                        )}
                        onClick={() => handleToggleEditStaff(staff)}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-center gap-3">
                            <Checkbox
                              checked={!!editStaff.find((s) => s.id === staff.id)}
                              onCheckedChange={() => handleToggleEditStaff(staff)}
                            />
                            <div className="flex items-center gap-2">
                              <Building2 className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium">{staff.name}</span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                    {!staffError && editSubcontractors.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        No subcontractor accounts found.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Booking Notes</Label>
              <Textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Optional booking notes..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCloseEditBooking}>
              Cancel
            </Button>
            <Button
              onClick={handleUpdateBooking}
              disabled={
                !editOrganizationId ||
                !editContactId ||
                !editScheduledDate ||
                !editScheduledTime ||
                editStaff.length === 0
              }
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(bookingToDelete)}
        onOpenChange={(open) => !open && setBookingToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send booking to Recycle Bin?</AlertDialogTitle>
            <AlertDialogDescription>
              This moves the linked job to the Recycle Bin
              {bookingToDelete?.convertedJobId
                ? "."
                : " (or marks this booking as cancelled if no job exists)."}{" "}
              You can restore jobs from the Recycle Bin later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingBooking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                handleRecycleBooking();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deletingBooking}
            >
              {deletingBooking ? "Recycling..." : "Recycle"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
