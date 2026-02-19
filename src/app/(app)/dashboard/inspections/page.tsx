"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { ClipboardCheck, Plus, Search, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS, generateInspectionNumber } from "@/lib/firestore";
import { createInspectionWorksRegisterEntry } from "@/lib/jobs-data";
import {
  CLIENT_CONTACT_CATEGORIES,
  CONTACT_CATEGORY_LABELS,
  type ContactCategory,
  type ContactOrganization,
  type Inspection,
  type InspectionStatus,
  type OrganizationContact,
} from "@/lib/types";

const STATUS_LABELS: Record<InspectionStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  converted: "Converted",
  rejected: "Rejected",
};

const STATUS_BADGE: Record<InspectionStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  approved: "bg-green-500/20 text-green-400 border-green-500/30",
  converted: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  rejected: "bg-red-500/20 text-red-400 border-red-500/30",
};

type InspectionDisplayStatus = InspectionStatus | "quote_generated" | "quote_sent";
type InspectionStatusFilter = "all" | InspectionDisplayStatus;
type InspectionSortOption =
  | "updated_desc"
  | "updated_asc"
  | "scheduled_desc"
  | "scheduled_asc"
  | "inspection_number_desc"
  | "inspection_number_asc";

const DISPLAY_STATUS_LABELS: Record<InspectionDisplayStatus, string> = {
  draft: "Draft",
  submitted: "Completed (internal)",
  quote_generated: "Quote Generated",
  quote_sent: "Quote Sent",
  approved: "Approved",
  converted: "Converted",
  rejected: "Rejected",
};

const DISPLAY_STATUS_BADGE: Record<InspectionDisplayStatus, string> = {
  draft: STATUS_BADGE.draft,
  submitted: STATUS_BADGE.submitted,
  quote_generated: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
  quote_sent: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  approved: STATUS_BADGE.approved,
  converted: STATUS_BADGE.converted,
  rejected: STATUS_BADGE.rejected,
};

const INSPECTION_STATUS_ORDER: InspectionDisplayStatus[] = [
  "draft",
  "submitted",
  "quote_generated",
  "quote_sent",
  "approved",
  "converted",
  "rejected",
];

const INSPECTION_SORT_LABELS: Record<InspectionSortOption, string> = {
  updated_desc: "Updated (Newest first)",
  updated_asc: "Updated (Oldest first)",
  scheduled_desc: "Scheduled (Newest first)",
  scheduled_asc: "Scheduled (Oldest first)",
  inspection_number_desc: "Inspection # (High to low)",
  inspection_number_asc: "Inspection # (Low to high)",
};

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
      if (nextVal !== undefined) cleaned[key] = nextVal;
    });
    return cleaned as T;
  }

  return value;
}

export default function InspectionsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<InspectionStatusFilter>("all");
  const [sortOption, setSortOption] = useState<InspectionSortOption>("updated_desc");
  const [creating, setCreating] = useState(false);
  const [showNewInspectionDialog, setShowNewInspectionDialog] = useState(false);
  const [organizations, setOrganizations] = useState<ContactOrganization[]>([]);
  const [contacts, setContacts] = useState<OrganizationContact[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [selectedContactId, setSelectedContactId] = useState("");
  const [isCreatingNewOrg, setIsCreatingNewOrg] = useState(false);
  const [isCreatingNewContact, setIsCreatingNewContact] = useState(false);
  const [inspectionToDelete, setInspectionToDelete] = useState<Inspection | null>(null);
  const [deleting, setDeleting] = useState(false);
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
  const [newContactData, setNewContactData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    mobile: "",
    jobTitle: "",
  });

  useEffect(() => {
    const inspectionsQuery = query(
      collection(db, COLLECTIONS.INSPECTIONS),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(inspectionsQuery, (snapshot) => {
      const loaded = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<Inspection, "id">),
      }));
      setInspections(loaded);
    });

    return () => unsubscribe();
  }, []);

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
    if (!selectedOrgId || isCreatingNewOrg) {
      setContacts([]);
      return;
    }
    const contactQuery = query(
      collection(db, COLLECTIONS.ORGANIZATION_CONTACTS),
      where("organizationId", "==", selectedOrgId)
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
  }, [selectedOrgId, isCreatingNewOrg]);

  useEffect(() => {
    if (!selectedOrgId || isCreatingNewOrg) return;
    if (isCreatingNewContact) return;
    const primaryContact = contacts.find((contact) => contact.isPrimary);
    if (primaryContact) {
      setSelectedContactId(primaryContact.id);
    }
  }, [contacts, selectedOrgId, isCreatingNewOrg, isCreatingNewContact]);

  const toDateValue = (value?: Timestamp | string | number | Date | null | undefined) => {
    if (!value) return null;
    if (value instanceof Timestamp) return value.toDate();
    if (value instanceof Date) return value;
    const hasToDate = (value as { toDate?: () => Date }).toDate;
    if (typeof hasToDate === "function") return hasToDate.call(value);
    if (typeof value === "string" || typeof value === "number") {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
  };

  const resetNewInspectionForm = () => {
    setSelectedOrgId("");
    setSelectedContactId("");
    setIsCreatingNewOrg(false);
    setIsCreatingNewContact(false);
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
    setNewContactData({
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      mobile: "",
      jobTitle: "",
    });
  };

  const selectedOrg = useMemo(
    () => organizations.find((org) => org.id === selectedOrgId) || null,
    [organizations, selectedOrgId]
  );
  const clientOrganizations = useMemo(
    () => organizations.filter((org) => CLIENT_CONTACT_CATEGORIES.includes(org.category)),
    [organizations]
  );
  const selectedContact = useMemo(
    () => contacts.find((contact) => contact.id === selectedContactId) || null,
    [contacts, selectedContactId]
  );

  const getInspectionDisplayStatus = (inspection: Inspection): InspectionDisplayStatus => {
    if (inspection.status === "rejected") return "rejected";
    if (inspection.convertedToJobId || inspection.status === "converted") return "converted";
    if (inspection.status === "approved") return "approved";
    if (inspection.quote?.status === "sent") return "quote_sent";
    if (inspection.quote?.status === "generated") return "quote_generated";
    return inspection.status;
  };

  const getReferenceSortValue = (value: string) =>
    (value.match(/\d+/g) || []).reduce(
      (acc, part) => acc * 1_000_000 + Number.parseInt(part, 10),
      0
    );

  const getUpdatedMillis = (inspection: Inspection) => {
    const updated = toDateValue(inspection.updatedAt);
    return updated ? updated.getTime() : 0;
  };

  const getScheduledMillis = (inspection: Inspection) => {
    const scheduled = toDateValue(inspection.scheduledDate);
    if (!scheduled) return 0;
    const withTime = new Date(scheduled);
    const [hours, minutes] = (inspection.scheduledTime || "")
      .split(":")
      .map((part) => Number.parseInt(part, 10));
    if (Number.isFinite(hours)) withTime.setHours(hours);
    if (Number.isFinite(minutes)) withTime.setMinutes(minutes);
    withTime.setSeconds(0, 0);
    return withTime.getTime();
  };

  const inspectionStatusOptions = useMemo(() => {
    const available = new Set<InspectionDisplayStatus>();
    inspections.forEach((inspection) => {
      available.add(getInspectionDisplayStatus(inspection));
    });
    return INSPECTION_STATUS_ORDER.filter((status) => available.has(status));
  }, [inspections]);

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredInspections = useMemo(() => {
    return [...inspections.filter((inspection) => {
      const displayStatus = getInspectionDisplayStatus(inspection);
      const matchesSearch =
        inspection.inspectionNumber.toLowerCase().includes(normalizedSearch) ||
        (inspection.organizationName || "").toLowerCase().includes(normalizedSearch) ||
        (inspection.clientName || "").toLowerCase().includes(normalizedSearch) ||
        (inspection.contactName || "").toLowerCase().includes(normalizedSearch);
      const matchesStatus = statusFilter === "all" || displayStatus === statusFilter;
      return matchesSearch && matchesStatus;
    })].sort((a, b) => {
      switch (sortOption) {
        case "updated_asc":
          return getUpdatedMillis(a) - getUpdatedMillis(b);
        case "scheduled_desc":
          return getScheduledMillis(b) - getScheduledMillis(a);
        case "scheduled_asc":
          return getScheduledMillis(a) - getScheduledMillis(b);
        case "inspection_number_desc": {
          const diff = getReferenceSortValue(b.inspectionNumber) - getReferenceSortValue(a.inspectionNumber);
          return diff !== 0 ? diff : b.inspectionNumber.localeCompare(a.inspectionNumber);
        }
        case "inspection_number_asc": {
          const diff = getReferenceSortValue(a.inspectionNumber) - getReferenceSortValue(b.inspectionNumber);
          return diff !== 0 ? diff : a.inspectionNumber.localeCompare(b.inspectionNumber);
        }
        case "updated_desc":
        default:
          return getUpdatedMillis(b) - getUpdatedMillis(a);
      }
    });
  }, [inspections, normalizedSearch, sortOption, statusFilter]);

  const handleCreateInspection = async () => {
    if (creating) return;
    if (!user) return;
    if (!selectedOrgId && !isCreatingNewOrg) {
      toast({
        title: "Select an organisation",
        description: "Choose an existing organisation or add a new one.",
        variant: "destructive",
      });
      return;
    }

    if (isCreatingNewOrg && !newOrgData.name.trim()) {
      toast({
        title: "Missing organisation name",
        description: "Enter the organisation name to continue.",
        variant: "destructive",
      });
      return;
    }

    const needsNewContact = isCreatingNewOrg || isCreatingNewContact || !selectedContactId;
    if (needsNewContact && (!newContactData.firstName.trim() || !newContactData.email.trim())) {
      toast({
        title: "Missing contact details",
        description: "Enter a contact name and email address to continue.",
        variant: "destructive",
      });
      return;
    }

    setCreating(true);
    try {
      let organizationId = selectedOrgId;
      let organization = selectedOrg;

      if (isCreatingNewOrg) {
        const newOrg: ContactOrganization = {
          id: `org-${Date.now()}`,
          name: newOrgData.name.trim(),
          category: newOrgData.category,
          type: "customer",
          status: "active",
          abn: newOrgData.abn || undefined,
          phone: newOrgData.phone || undefined,
          email: newOrgData.email || undefined,
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
              name: "Main location",
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
        const orgRef = await addDoc(
          collection(db, COLLECTIONS.CONTACT_ORGANIZATIONS),
          pruneUndefined(newOrg)
        );
        organizationId = orgRef.id;
        organization = { ...newOrg, id: orgRef.id };
      }

      let contact = selectedContact;

      if (needsNewContact) {
        const newContact: OrganizationContact = {
          id: `contact-${Date.now()}`,
          organizationId,
          firstName: newContactData.firstName.trim(),
          lastName: newContactData.lastName.trim(),
          email: newContactData.email.trim(),
          phone: newContactData.phone || undefined,
          mobile: newContactData.mobile || undefined,
          role: "primary",
          jobTitle: newContactData.jobTitle || undefined,
          status: "active",
          isPrimary: contacts.length === 0,
          hasPortalAccess: true,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        };
        const contactRef = await addDoc(
          collection(db, COLLECTIONS.ORGANIZATION_CONTACTS),
          pruneUndefined(newContact)
        );
        contact = { ...newContact, id: contactRef.id };
      }

      if (!organization || !contact) {
        throw new Error("Select an organisation and contact before continuing.");
      }
      const normalizePhone = (value: unknown) => {
        if (typeof value !== "string") return undefined;
        const trimmed = value.trim();
        return trimmed ? trimmed : undefined;
      };
      const resolvedClientPhone =
        normalizePhone(contact.mobile) || normalizePhone(contact.phone);

      const inspectionNumber = await generateInspectionNumber();
      const inspectionRef = doc(collection(db, COLLECTIONS.INSPECTIONS));
      const worksRef = doc(collection(db, COLLECTIONS.WORKS_REGISTER));
      const now = Timestamp.now();
        const inspection: Inspection = {
          id: inspectionRef.id,
          inspectionNumber,
          organizationId,
          organizationName: organization.name,
          contactId: contact.id,
          contactName: `${contact.firstName} ${contact.lastName}`.trim(),
          clientId: organizationId,
          clientName: organization.name,
          clientEmail: contact.email.trim(),
          clientPhone: resolvedClientPhone,
          siteLocation: organization.sites?.[0]
            ? {
                name: organization.sites[0].name,
                address: organization.address && organization.sites[0].isDefault
                  ? organization.address
                  : organization.sites[0].address,
              }
            : undefined,
          status: "draft",
          vehicleReports: [],
          worksRegisterId: worksRef.id,
          createdAt: now,
          createdBy: user.uid,
          updatedAt: now,
        };
        await setDoc(inspectionRef, pruneUndefined(inspection));
        const worksEntry = createInspectionWorksRegisterEntry({
          inspection,
          entryId: worksRef.id,
        });
        await setDoc(worksRef, pruneUndefined(worksEntry));
        setShowNewInspectionDialog(false);
        resetNewInspectionForm();
        router.push(`/dashboard/inspections/${inspectionRef.id}`);
    } catch (error: any) {
      toast({
        title: "Unable to create inspection",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteInspection = async () => {
    if (!inspectionToDelete) return;

    setDeleting(true);
    try {
      if (inspectionToDelete.convertedToJobId) {
        const jobSnap = await getDoc(
          doc(db, COLLECTIONS.JOBS, inspectionToDelete.convertedToJobId)
        );
        const jobData = jobSnap.exists()
          ? (jobSnap.data() as { isDeleted?: boolean })
          : null;
        if (jobSnap.exists() && !jobData?.isDeleted) {
          toast({
            title: "Inspection linked to a job",
            description: "Delete or recycle the RFQ job first before deleting this inspection.",
            variant: "destructive",
          });
          setDeleting(false);
          return;
        }
      }

      await deleteDoc(doc(db, COLLECTIONS.INSPECTIONS, inspectionToDelete.id));
      if (inspectionToDelete.worksRegisterId) {
        await deleteDoc(doc(db, COLLECTIONS.WORKS_REGISTER, inspectionToDelete.worksRegisterId));
      } else {
        const worksQuery = query(
          collection(db, COLLECTIONS.WORKS_REGISTER),
          where("jobId", "==", inspectionToDelete.id)
        );
        const snapshot = await getDocs(worksQuery);
        await Promise.all(snapshot.docs.map((docSnap) => deleteDoc(docSnap.ref)));
      }
      toast({
        title: "Inspection deleted",
        description: "The inspection has been removed from the system.",
      });
      setInspectionToDelete(null);
    } catch (error: any) {
      toast({
        title: "Unable to delete inspection",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <ClipboardCheck className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold">Inspections</h1>
          </div>
          <p className="text-muted-foreground">
            Capture RFQs on site and convert them into scheduled jobs.
          </p>
        </div>
        <Button onClick={() => setShowNewInspectionDialog(true)} disabled={creating}>
          <Plus className="mr-2 h-4 w-4" />
          New inspection
        </Button>
      </div>

      <Dialog open={showNewInspectionDialog} onOpenChange={(open) => {
        setShowNewInspectionDialog(open);
        if (!open) resetNewInspectionForm();
      }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Start a new inspection</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-2">
            <div className="space-y-4">
              <Label>Organisation</Label>
              <Select
                value={isCreatingNewOrg ? "__new__" : selectedOrgId}
                onValueChange={(value) => {
                  if (value === "__new__") {
                    setIsCreatingNewOrg(true);
                    setSelectedOrgId("");
                    setSelectedContactId("");
                    setIsCreatingNewContact(true);
                    return;
                  }
                  setIsCreatingNewOrg(false);
                  setSelectedOrgId(value);
                  setSelectedContactId("");
                  setIsCreatingNewContact(false);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select an organisation" />
                </SelectTrigger>
                <SelectContent>
                  {clientOrganizations.map((org) => (
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
              <Card className="border-dashed">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">New organisation details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="md:col-span-2 space-y-2">
                      <Label>Organisation name *</Label>
                      <Input
                        value={newOrgData.name}
                        onChange={(e) => setNewOrgData({ ...newOrgData, name: e.target.value })}
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
                          {CLIENT_CONTACT_CATEGORIES.map((category) => (
                            <SelectItem key={category} value={category}>
                              {CONTACT_CATEGORY_LABELS[category]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>ABN</Label>
                      <Input
                        value={newOrgData.abn}
                        onChange={(e) => setNewOrgData({ ...newOrgData, abn: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Phone</Label>
                      <Input
                        value={newOrgData.phone}
                        onChange={(e) => setNewOrgData({ ...newOrgData, phone: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Email</Label>
                      <Input
                        value={newOrgData.email}
                        onChange={(e) => setNewOrgData({ ...newOrgData, email: e.target.value })}
                      />
                    </div>
                    <div className="md:col-span-2 space-y-2">
                      <Label>Street</Label>
                      <Input
                        value={newOrgData.street}
                        onChange={(e) => setNewOrgData({ ...newOrgData, street: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Suburb</Label>
                      <Input
                        value={newOrgData.suburb}
                        onChange={(e) => setNewOrgData({ ...newOrgData, suburb: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>State</Label>
                      <Input
                        value={newOrgData.state}
                        onChange={(e) => setNewOrgData({ ...newOrgData, state: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Postcode</Label>
                      <Input
                        value={newOrgData.postcode}
                        onChange={(e) => setNewOrgData({ ...newOrgData, postcode: e.target.value })}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="space-y-4">
              <Label>Point of contact</Label>
              {!isCreatingNewOrg && (
                <Select
                  value={isCreatingNewContact ? "__new__" : selectedContactId}
                  onValueChange={(value) => {
                    if (value === "__new__") {
                      setIsCreatingNewContact(true);
                      setSelectedContactId("");
                      return;
                    }
                    setIsCreatingNewContact(false);
                    setSelectedContactId(value);
                  }}
                  disabled={!selectedOrgId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a contact" />
                  </SelectTrigger>
                  <SelectContent>
                    {contacts.map((contact) => (
                      <SelectItem key={contact.id} value={contact.id}>
                        {contact.firstName} {contact.lastName}
                      </SelectItem>
                    ))}
                    <SelectItem value="__new__" className="text-primary font-medium">
                      + Add new contact
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>

            {(isCreatingNewOrg || isCreatingNewContact) && (
              <Card className="border-dashed">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">New contact details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>First name *</Label>
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
                      <Label>Email *</Label>
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
                </CardContent>
              </Card>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowNewInspectionDialog(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateInspection} disabled={creating}>
                {creating ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="h-4 w-4 rounded-full border-2 border-current/30 border-t-current animate-spin" />
                    Saving...
                  </span>
                ) : (
                  "Start inspection"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search inspections..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Select
                value={statusFilter}
                onValueChange={(value) => setStatusFilter(value as InspectionStatusFilter)}
              >
                <SelectTrigger className="w-[190px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  {inspectionStatusOptions.map((status) => (
                    <SelectItem key={status} value={status}>
                      {DISPLAY_STATUS_LABELS[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={sortOption}
                onValueChange={(value) => setSortOption(value as InspectionSortOption)}
              >
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(INSPECTION_SORT_LABELS) as [InspectionSortOption, string][]).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader>
          <CardTitle>Inspection register</CardTitle>
          <CardDescription>
            {filteredInspections.length} inspection
            {filteredInspections.length !== 1 && "s"} shown
            {filteredInspections.length !== inspections.length
              ? ` (${inspections.length} total)`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filteredInspections.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              No inspections match the current filters.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Inspection #</TableHead>
                  <TableHead>Organisation</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Scheduled date</TableHead>
                  <TableHead>Last updated</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredInspections.map((inspection) => {
                  const displayStatus = getInspectionDisplayStatus(inspection);
                  return (
                    <TableRow
                      key={inspection.id}
                      className="cursor-pointer hover:bg-muted/20"
                      onClick={() => router.push(`/dashboard/inspections/${inspection.id}`)}
                    >
                      <TableCell className="font-medium text-primary">
                        {inspection.inspectionNumber}
                      </TableCell>
                      <TableCell>{inspection.organizationName || inspection.clientName || "-"}</TableCell>
                      <TableCell>
                        <Badge className={DISPLAY_STATUS_BADGE[displayStatus]} variant="outline">
                          {DISPLAY_STATUS_LABELS[displayStatus]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {toDateValue(inspection.scheduledDate)
                          ? toDateValue(inspection.scheduledDate)!.toLocaleDateString("en-AU")
                          : "-"}
                      </TableCell>
                      <TableCell>
                        {toDateValue(inspection.updatedAt)
                          ? toDateValue(inspection.updatedAt)!.toLocaleDateString("en-AU")
                          : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(event) => {
                              event.stopPropagation();
                              router.push(`/dashboard/inspections/${inspection.id}`);
                            }}
                          >
                            View
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(event) => {
                              event.stopPropagation();
                              setInspectionToDelete(inspection);
                            }}
                            aria-label="Delete inspection"
                          >
                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(inspectionToDelete)}
        onOpenChange={(open) => {
          if (!open) setInspectionToDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete inspection</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently remove the inspection and its works register entry.
          </p>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="ghost" onClick={() => setInspectionToDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteInspection} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
