"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Timestamp,
  collection,
  onSnapshot,
  orderBy,
  doc,
  updateDoc,
  deleteDoc,
  query,
} from "firebase/firestore";
import {
  Building2,
  Users,
  Plus,
  Search,
  MoreHorizontal,
  Pencil,
  Trash2,
  Mail,
  Phone,
  MapPin,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";

import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  ContactOrganization,
  OrganizationContact,
  ContactCategory,
  CONTACT_CATEGORY_LABELS,
  MarketStream,
  OrganizationStatus,
  UserInvite,
  UserRole,
} from "@/lib/types";
import { initialOrganizations, initialContacts } from "@/lib/contacts-data";
import { COLLECTIONS, addDocument, createDocument } from "@/lib/firestore";
import { db } from "@/lib/firebaseClient";

type OrganizationFormData = {
  name: string;
  category: ContactCategory;
  abn: string;
  marketStream: MarketStream | "";
  status: OrganizationStatus;
  portalRole: "client" | "contractor" | "";
  jobCode: string;
  domains: string;
  street: string;
  suburb: string;
  state: string;
  postcode: string;
};

type ContactFormData = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: "primary" | "billing" | "technical" | "management";
  jobTitle: string;
  isPrimary: boolean;
  hasPortalAccess: boolean;
};

const initialOrgForm: OrganizationFormData = {
  name: "",
  category: "trade_client",
  abn: "",
  marketStream: "",
  status: "active",
  portalRole: "",
  jobCode: "",
  domains: "",
  street: "",
  suburb: "",
  state: "",
  postcode: "",
};

const initialContactForm: ContactFormData = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  role: "primary",
  jobTitle: "",
  isPrimary: false,
  hasPortalAccess: false,
};

export default function ContactsPage() {
  const { user, firebaseUser } = useAuth();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<ContactCategory>("trade_client");
  const [organizations, setOrganizations] = useState<ContactOrganization[]>([]);
  const [contacts, setContacts] = useState<OrganizationContact[]>([]);
  const [invites, setInvites] = useState<UserInvite[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [hasLoadedContacts, setHasLoadedContacts] = useState(false);
  const [hasSeeded, setHasSeeded] = useState(false);

  const [orgDialogOpen, setOrgDialogOpen] = useState(false);
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<ContactOrganization | null>(null);
  const [editingContact, setEditingContact] = useState<OrganizationContact | null>(null);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteResendId, setInviteResendId] = useState<string | null>(null);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkPreview, setBulkPreview] = useState<string[]>([]);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkSendEmails, setBulkSendEmails] = useState(true);

  const [orgForm, setOrgForm] = useState<OrganizationFormData>(initialOrgForm);
  const [contactForm, setContactForm] = useState<ContactFormData>(initialContactForm);
  const [inviteForm, setInviteForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    role: "client" as UserRole,
    organizationId: "",
  });

  const isAdmin = user?.role === "admin";
  const organizationOptions = useMemo(
    () =>
      organizations
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((org) => ({
          id: org.id,
          name: org.name,
        })),
    [organizations]
  );

  const formatDate = (value?: Timestamp) => {
    if (!value) return "-";
    const date = value.toDate ? value.toDate() : new Date(value as unknown as string);
    return Number.isNaN(date.getTime())
      ? "-"
      : date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  };

  useEffect(() => {
    const orgQuery = query(collection(db, COLLECTIONS.CONTACT_ORGANIZATIONS), orderBy("name"));
    const contactsQuery = query(
      collection(db, COLLECTIONS.ORGANIZATION_CONTACTS),
      orderBy("firstName")
    );

    const unsubscribeOrgs = onSnapshot(orgQuery, (snapshot) => {
      const loaded = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<ContactOrganization, "id">),
      }));
      setOrganizations(loaded);
      setHasLoaded(true);
    });

    const unsubscribeContacts = onSnapshot(contactsQuery, (snapshot) => {
      const loaded = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<OrganizationContact, "id">),
      }));
      setContacts(loaded);
      setHasLoadedContacts(true);
    });

    return () => {
      unsubscribeOrgs();
      unsubscribeContacts();
    };
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      setInvites([]);
      return;
    }
    const invitesQuery = query(
      collection(db, COLLECTIONS.USER_INVITES),
      orderBy("createdAt", "desc")
    );
    const unsubscribe = onSnapshot(invitesQuery, (snapshot) => {
      const loaded = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<UserInvite, "id">),
      }));
      setInvites(loaded);
    });
    return () => unsubscribe();
  }, [isAdmin]);

  useEffect(() => {
    if (!hasLoaded || !hasLoadedContacts || hasSeeded) return;

    const seedContacts = async () => {
      const existingOrgIds = new Set(organizations.map((org) => org.id));
      const orgsByName = new Map(
        organizations.map((org) => [org.name.trim().toLowerCase(), org.id])
      );
      const seedOrgIdMap = new Map<string, string>();

      const orgsToSeed = initialOrganizations.filter((org) => {
        if (existingOrgIds.has(org.id)) {
          seedOrgIdMap.set(org.id, org.id);
          return false;
        }
        const matchedId = orgsByName.get(org.name.trim().toLowerCase());
        if (matchedId) {
          seedOrgIdMap.set(org.id, matchedId);
          return false;
        }
        seedOrgIdMap.set(org.id, org.id);
        return true;
      });

      const existingContactKeys = new Set(
        contacts.map((contact) =>
          [
            contact.organizationId,
            contact.firstName.trim().toLowerCase(),
            contact.lastName.trim().toLowerCase(),
            contact.email.trim().toLowerCase(),
          ].join("|")
        )
      );

      const contactsToSeed = initialContacts
        .map((contact) => ({
          ...contact,
          organizationId: seedOrgIdMap.get(contact.organizationId) || contact.organizationId,
        }))
        .filter((contact) => {
          const key = [
            contact.organizationId,
            contact.firstName.trim().toLowerCase(),
            contact.lastName.trim().toLowerCase(),
            contact.email.trim().toLowerCase(),
          ].join("|");
          return !existingContactKeys.has(key);
        });

      if (orgsToSeed.length === 0 && contactsToSeed.length === 0) return;
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
      setHasSeeded(true);
    };

    seedContacts();
  }, [hasLoaded, hasLoadedContacts, hasSeeded, organizations, contacts]);

  const filteredOrganizations = organizations.filter(
    (org) =>
      org.category === activeTab &&
      org.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getOrgContacts = (orgId: string) =>
    contacts.filter((c) => c.organizationId === orgId);

  const getPrimaryContact = (orgId: string) =>
    contacts.find((c) => c.organizationId === orgId && c.isPrimary);

  const handleOpenOrgDialog = (org?: ContactOrganization) => {
    if (org) {
      setEditingOrg(org);
      setOrgForm({
        name: org.name,
        category: org.category,
        abn: org.abn || "",
        marketStream: org.marketStream || "",
        status: org.status,
        portalRole:
          org.portalRole === "client" || org.portalRole === "contractor"
            ? org.portalRole
            : "",
        jobCode: org.jobCode || "",
        domains: org.domains ? org.domains.join(", ") : "",
        street: org.address?.street || "",
        suburb: org.address?.suburb || "",
        state: org.address?.state || "",
        postcode: org.address?.postcode || "",
      });
    } else {
      setEditingOrg(null);
      setOrgForm({ ...initialOrgForm, category: activeTab });
    }
    setOrgDialogOpen(true);
  };

  const parseDomains = (value: string) =>
    value
      .split(",")
      .map((domain) => domain.trim().toLowerCase())
      .filter(Boolean);

  const handleSaveOrg = async () => {
    if (editingOrg) {
      await updateDoc(doc(db, COLLECTIONS.CONTACT_ORGANIZATIONS, editingOrg.id), {
        name: orgForm.name,
        category: orgForm.category,
        abn: orgForm.abn.trim(),
        marketStream: orgForm.marketStream || "",
        status: orgForm.status,
        portalRole: orgForm.portalRole || "",
        jobCode: orgForm.jobCode.trim(),
        domains: parseDomains(orgForm.domains),
        address: {
          street: orgForm.street,
          suburb: orgForm.suburb,
          state: orgForm.state,
          postcode: orgForm.postcode,
          country: "Australia",
        },
        updatedAt: Timestamp.now(),
      });
    } else {
      await addDocument(COLLECTIONS.CONTACT_ORGANIZATIONS, {
        name: orgForm.name,
        category: orgForm.category,
        type: "customer",
        status: orgForm.status,
        abn: orgForm.abn.trim(),
        marketStream: orgForm.marketStream || "",
        portalRole: orgForm.portalRole || "",
        jobCode: orgForm.jobCode.trim(),
        domains: parseDomains(orgForm.domains),
        address: {
          street: orgForm.street,
          suburb: orgForm.suburb,
          state: orgForm.state,
          postcode: orgForm.postcode,
          country: "Australia",
        },
        sites: [],
      });
    }
    setOrgDialogOpen(false);
    setOrgForm(initialOrgForm);
  };

  const handleDeleteOrg = async (orgId: string) => {
    await deleteDoc(doc(db, COLLECTIONS.CONTACT_ORGANIZATIONS, orgId));
    const contactsToRemove = contacts.filter((c) => c.organizationId === orgId);
    await Promise.all(
      contactsToRemove.map((contact) =>
        deleteDoc(doc(db, COLLECTIONS.ORGANIZATION_CONTACTS, contact.id))
      )
    );
  };

  const handleOpenContactDialog = (orgId: string, contact?: OrganizationContact) => {
    setSelectedOrgId(orgId);
    if (contact) {
      setEditingContact(contact);
      setContactForm({
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        phone: contact.phone || contact.mobile || "",
        role: contact.role,
        jobTitle: contact.jobTitle || "",
        isPrimary: contact.isPrimary,
        hasPortalAccess: contact.hasPortalAccess,
      });
    } else {
      setEditingContact(null);
      setContactForm(initialContactForm);
    }
    setContactDialogOpen(true);
  };

  const handleSaveContact = async () => {
    if (!selectedOrgId) return;

    if (editingContact) {
      await updateDoc(doc(db, COLLECTIONS.ORGANIZATION_CONTACTS, editingContact.id), {
        firstName: contactForm.firstName,
        lastName: contactForm.lastName,
        email: contactForm.email,
        phone: contactForm.phone,
        role: contactForm.role,
        jobTitle: contactForm.jobTitle || undefined,
        isPrimary: contactForm.isPrimary,
        hasPortalAccess: contactForm.hasPortalAccess,
        updatedAt: Timestamp.now(),
      });
    } else {
      await addDocument(COLLECTIONS.ORGANIZATION_CONTACTS, {
        organizationId: selectedOrgId,
        firstName: contactForm.firstName,
        lastName: contactForm.lastName,
        email: contactForm.email,
        phone: contactForm.phone,
        role: contactForm.role,
        jobTitle: contactForm.jobTitle || undefined,
        status: "active",
        isPrimary: contactForm.isPrimary,
        hasPortalAccess: contactForm.hasPortalAccess,
      });
    }
    setContactDialogOpen(false);
    setContactForm(initialContactForm);
    setSelectedOrgId(null);
  };

  const handleDeleteContact = async (contactId: string) => {
    await deleteDoc(doc(db, COLLECTIONS.ORGANIZATION_CONTACTS, contactId));
  };

  const handleSendInvite = async () => {
    if (!firebaseUser) {
      toast({
        title: "Not signed in",
        description: "Please sign in again and retry.",
        variant: "destructive",
      });
      return;
    }
    const email = inviteForm.email.trim().toLowerCase();
    if (!email) {
      toast({
        title: "Missing email",
        description: "Enter an email address to send an invite.",
        variant: "destructive",
      });
      return;
    }
    if (
      (inviteForm.role === "client" || inviteForm.role === "contractor") &&
      !inviteForm.organizationId
    ) {
      toast({
        title: "Missing organisation",
        description: "Select an organisation for this invite.",
        variant: "destructive",
      });
      return;
    }
    setInviteLoading(true);
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/admin/invite-user", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          firstName: inviteForm.firstName.trim() || undefined,
          lastName: inviteForm.lastName.trim() || undefined,
          role: inviteForm.role,
          organizationId:
            inviteForm.role === "client" || inviteForm.role === "contractor"
              ? inviteForm.organizationId
              : undefined,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Failed to send invite.");
      }

      toast({
        title: "Invite sent",
        description: `Invitation sent to ${email}.`,
      });
      setInviteDialogOpen(false);
      setInviteForm({
        firstName: "",
        lastName: "",
        email: "",
        role: "client",
        organizationId: "",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to send invite.";
      toast({
        title: "Invite failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setInviteLoading(false);
    }
  };

  const handleResendInvite = async (invite: UserInvite) => {
    if (!firebaseUser) {
      toast({
        title: "Not signed in",
        description: "Please sign in again and retry.",
        variant: "destructive",
      });
      return;
    }
    setInviteResendId(invite.id);
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/admin/resend-invite", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inviteId: invite.id }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Failed to resend invite.");
      }

      toast({
        title: "Invite sent",
        description: `Invitation emailed to ${invite.email}.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to resend invite.";
      toast({
        title: "Invite failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setInviteResendId(null);
    }
  };

  const parsePreviewLines = async (file: File) => {
    const content = await file.text();
    const lines = content.split(/\r?\n/).filter(Boolean);
    if (lines.length <= 1) return [];
    const delimiter = content.includes("\t") ? "\t" : ",";
    const headers = lines[0].split(delimiter).map((header) => header.trim());
    const previewLines = lines.slice(1, 6).map((line) => {
      const cells = line.split(delimiter);
      const row: Record<string, string> = {};
      headers.forEach((header, index) => {
        row[header] = (cells[index] || "").trim();
      });
      const name = row.ContactName || row.contactname || "Unknown org";
      const email =
        row.EmailAddress ||
        row.Person1Email ||
        row.Person2Email ||
        row.Person3Email ||
        row.Person4Email ||
        "No email";
      return `${name} - ${email}`;
    });
    return previewLines;
  };

  const handleBulkFileSelect = async (file: File | null) => {
    setBulkFile(file);
    setBulkPreview([]);
    if (!file) return;
    try {
      const preview = await parsePreviewLines(file);
      setBulkPreview(preview);
    } catch (error) {
      console.warn("Failed to parse bulk preview:", error);
    }
  };

  const handleBulkImport = async () => {
    if (!firebaseUser || !bulkFile) {
      toast({
        title: "Missing file",
        description: "Choose a CSV or TSV file to import.",
        variant: "destructive",
      });
      return;
    }
    setBulkImporting(true);
    try {
      const token = await firebaseUser.getIdToken();
      const formData = new FormData();
      formData.append("file", bulkFile);
      formData.append("sendEmails", bulkSendEmails ? "true" : "false");

      const response = await fetch("/api/admin/import-invites", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Bulk import failed.");
      }

      toast({
        title: "Import complete",
        description: "Bulk invites have been queued successfully.",
      });
      setBulkDialogOpen(false);
      setBulkFile(null);
      setBulkPreview([]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Bulk import failed.";
      toast({
        title: "Import failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setBulkImporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-headline font-bold tracking-tight">
            Contacts Database
          </h2>
          <p className="text-muted-foreground">
            Manage organisations and contacts by category.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <>
              <Button variant="outline" onClick={() => setInviteDialogOpen(true)}>
                <Mail className="mr-2 h-4 w-4" />
                Invite User
              </Button>
              <Button variant="outline" onClick={() => setBulkDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Bulk Import
              </Button>
            </>
          )}
          <Button onClick={() => handleOpenOrgDialog()}>
            <Plus className="mr-2 h-4 w-4" />
            Add Organization
          </Button>
        </div>
      </div>

      {isAdmin && (
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader>
            <CardTitle className="text-lg">User Invites</CardTitle>
          </CardHeader>
          <CardContent>
            {invites.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No invites yet. Use Invite User or Bulk Import to add users.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Organisation</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Invited</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invites.map((invite) => (
                    <TableRow key={invite.id}>
                      <TableCell className="font-medium">{invite.email}</TableCell>
                      <TableCell className="capitalize">{invite.role}</TableCell>
                      <TableCell>{invite.organizationName || "-"}</TableCell>
                      <TableCell>
                        <Badge
                          variant={invite.status === "accepted" ? "default" : "secondary"}
                        >
                          {invite.status.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDate(invite.createdAt)}</TableCell>
                      <TableCell>
                        {invite.status === "pending" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleResendInvite(invite)}
                            disabled={inviteResendId === invite.id}
                          >
                            {inviteResendId === invite.id ? "Sending..." : "Send invite"}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search organisations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ContactCategory)}>
            <TabsList className="mb-4">
              {(Object.keys(CONTACT_CATEGORY_LABELS) as ContactCategory[]).map((cat) => (
                <TabsTrigger key={cat} value={cat} className="gap-2">
                  {cat === "asi_staff" ? (
                    <Users className="h-4 w-4" />
                  ) : (
                    <Building2 className="h-4 w-4" />
                  )}
                  {CONTACT_CATEGORY_LABELS[cat]}
                </TabsTrigger>
              ))}
            </TabsList>

            {(Object.keys(CONTACT_CATEGORY_LABELS) as ContactCategory[]).map((cat) => (
              <TabsContent key={cat} value={cat}>
                {filteredOrganizations.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Building2 className="mx-auto h-12 w-12 mb-4 opacity-50" />
                    <p>No organisations found in this category.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {filteredOrganizations.map((org) => {
                      const primaryContact = getPrimaryContact(org.id);
                      const orgContacts = getOrgContacts(org.id);

                      return (
                        <Card
                          key={org.id}
                          className="bg-background/50 backdrop-blur border-border/30"
                        >
                          <CardHeader className="pb-2">
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-3">
                                <div className="bg-primary/10 p-2 rounded-lg">
                                  <Building2 className="h-5 w-5 text-primary" />
                                </div>
                                <div>
                                  <CardTitle className="text-lg">{org.name}</CardTitle>
                                  <div className="flex items-center gap-2 mt-1">
                                    <Badge variant={org.status === "active" ? "default" : "secondary"}>
                                      {org.status}
                                    </Badge>
                                    {org.marketStream && (
                                      <Badge variant="outline">{org.marketStream}</Badge>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => handleOpenOrgDialog(org)}>
                                    <Pencil className="mr-2 h-4 w-4" />
                                    Edit Organization
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleOpenContactDialog(org.id)}
                                  >
                                    <Plus className="mr-2 h-4 w-4" />
                                    Add Contact
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="text-destructive"
                                    onClick={() => handleDeleteOrg(org.id)}
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Delete Organization
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </CardHeader>
                          <CardContent>
                            <div className="grid md:grid-cols-2 gap-4 mb-4">
                              <div className="space-y-2 text-sm">
                                {org.phone && (
                                  <div className="flex items-center gap-2 text-muted-foreground">
                                    <Phone className="h-4 w-4" />
                                    {org.phone}
                                  </div>
                                )}
                                {org.email && (
                                  <div className="flex items-center gap-2 text-muted-foreground">
                                    <Mail className="h-4 w-4" />
                                    {org.email}
                                  </div>
                                )}
                                {org.address && (
                                  <div className="flex items-center gap-2 text-muted-foreground">
                                    <MapPin className="h-4 w-4" />
                                    {org.address.street}, {org.address.suburb}{" "}
                                    {org.address.state} {org.address.postcode}
                                  </div>
                                )}
                              </div>
                              {primaryContact && (
                                <div className="text-sm">
                                  <p className="text-muted-foreground mb-1">Primary Contact</p>
                                  <p className="font-medium">
                                    {primaryContact.firstName} {primaryContact.lastName}
                                  </p>
                                  <p className="text-muted-foreground">{primaryContact.email}</p>
                                </div>
                              )}
                            </div>

                            {orgContacts.length > 0 && (
                              <div>
                                <p className="text-sm font-medium mb-2 flex items-center gap-2">
                                  <Users className="h-4 w-4" />
                                  Contacts ({orgContacts.length})
                                </p>
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>Name</TableHead>
                                      <TableHead>Email</TableHead>
                                      <TableHead>Phone</TableHead>
                                      <TableHead>Role</TableHead>
                                      <TableHead>Portal</TableHead>
                                      <TableHead className="w-[50px]"></TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {orgContacts.map((contact) => (
                                      <TableRow key={contact.id}>
                                        <TableCell>
                                          <div className="flex items-center gap-2">
                                            {contact.firstName} {contact.lastName}
                                            {contact.isPrimary && (
                                              <Badge variant="outline" className="text-xs">
                                                Primary
                                              </Badge>
                                            )}
                                          </div>
                                        </TableCell>
                                        <TableCell>{contact.email}</TableCell>
                                        <TableCell>{contact.phone || contact.mobile || "-"}</TableCell>
                                        <TableCell className="capitalize">{contact.role}</TableCell>
                                        <TableCell>
                                          {contact.hasPortalAccess ? (
                                            <Badge variant="default" className="text-xs">Yes</Badge>
                                          ) : (
                                            <Badge variant="secondary" className="text-xs">No</Badge>
                                          )}
                                        </TableCell>
                                        <TableCell>
                                          <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                                <MoreHorizontal className="h-4 w-4" />
                                              </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                              <DropdownMenuItem
                                                onClick={() =>
                                                  handleOpenContactDialog(org.id, contact)
                                                }
                                              >
                                                <Pencil className="mr-2 h-4 w-4" />
                                                Edit Contact
                                              </DropdownMenuItem>
                                              <DropdownMenuItem
                                                className="text-destructive"
                                                onClick={() => handleDeleteContact(contact.id)}
                                              >
                                                <Trash2 className="mr-2 h-4 w-4" />
                                                Delete Contact
                                              </DropdownMenuItem>
                                            </DropdownMenuContent>
                                          </DropdownMenu>
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      {/* Organization Dialog */}
      <Dialog open={orgDialogOpen} onOpenChange={setOrgDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingOrg ? "Edit Organisation" : "Add Organisation"}
            </DialogTitle>
            <DialogDescription>
              {editingOrg
                ? "Update organisation details."
                : "Add a new organisation to the database."}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="grid gap-4 py-4 pr-4">
              <div className="grid gap-2">
                <Label htmlFor="org-name">Organisation Name</Label>
                <Input
                  id="org-name"
                  value={orgForm.name}
                  onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })}
                  placeholder="Enter organisation name"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="org-category">Category</Label>
                <Select
                  value={orgForm.category}
                  onValueChange={(v) => setOrgForm({ ...orgForm, category: v as ContactCategory })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(CONTACT_CATEGORY_LABELS) as ContactCategory[]).map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {CONTACT_CATEGORY_LABELS[cat]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="org-portal-role">Portal Role</Label>
                <Select
                  value={orgForm.portalRole || "none"}
                  onValueChange={(v) =>
                    setOrgForm({
                      ...orgForm,
                      portalRole:
                        v === "none" ? "" : (v as OrganizationFormData["portalRole"]),
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select portal role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not set</SelectItem>
                    <SelectItem value="client">Client</SelectItem>
                    <SelectItem value="contractor">Contractor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="org-job-code">Job Code</Label>
                <Input
                  id="org-job-code"
                  value={orgForm.jobCode}
                  onChange={(e) => setOrgForm({ ...orgForm, jobCode: e.target.value })}
                  placeholder="e.g., NUL, BSS, LSH"
                />
                <p className="text-xs text-muted-foreground">
                  Short code used in job numbers for this organisation.
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="org-domains">Email Domains</Label>
                <Input
                  id="org-domains"
                  value={orgForm.domains}
                  onChange={(e) => setOrgForm({ ...orgForm, domains: e.target.value })}
                  placeholder="example.com, subcontractor.com.au"
                />
                <p className="text-xs text-muted-foreground">
                  Used to auto-match signups to this organisation.
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="org-abn">ABN</Label>
                <Input
                  id="org-abn"
                  value={orgForm.abn}
                  onChange={(e) => setOrgForm({ ...orgForm, abn: e.target.value })}
                  placeholder="XX XXX XXX XXX"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="org-market">Market Stream</Label>
                <Select
                  value={orgForm.marketStream}
                  onValueChange={(v) => setOrgForm({ ...orgForm, marketStream: v as MarketStream })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select market stream" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="commercial">Commercial</SelectItem>
                    <SelectItem value="government">Government</SelectItem>
                    <SelectItem value="retail">Retail</SelectItem>
                    <SelectItem value="industrial">Industrial</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="org-status">Status</Label>
                <Select
                  value={orgForm.status}
                  onValueChange={(v) => setOrgForm({ ...orgForm, status: v as OrganizationStatus })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="prospect">Prospect</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="border-t pt-4 mt-2">
                <p className="text-sm font-medium mb-3">Address</p>
                <div className="grid gap-3">
                  <Input
                    placeholder="Street address"
                    value={orgForm.street}
                    onChange={(e) => setOrgForm({ ...orgForm, street: e.target.value })}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      placeholder="Suburb"
                      value={orgForm.suburb}
                      onChange={(e) => setOrgForm({ ...orgForm, suburb: e.target.value })}
                    />
                    <Input
                      placeholder="State"
                      value={orgForm.state}
                      onChange={(e) => setOrgForm({ ...orgForm, state: e.target.value })}
                    />
                  </div>
                  <Input
                    placeholder="Postcode"
                    value={orgForm.postcode}
                    onChange={(e) => setOrgForm({ ...orgForm, postcode: e.target.value })}
                    className="w-32"
                  />
                </div>
              </div>
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOrgDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveOrg} disabled={!orgForm.name}>
              {editingOrg ? "Save Changes" : "Add Organisation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Contact Dialog */}
      <Dialog open={contactDialogOpen} onOpenChange={setContactDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingContact ? "Edit Contact" : "Add Contact"}
            </DialogTitle>
            <DialogDescription>
              {editingContact
                ? "Update contact details."
                : "Add a new contact to the organisation."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="contact-first">First Name</Label>
                <Input
                  id="contact-first"
                  value={contactForm.firstName}
                  onChange={(e) =>
                    setContactForm({ ...contactForm, firstName: e.target.value })
                  }
                  placeholder="First name"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="contact-last">Last Name</Label>
                <Input
                  id="contact-last"
                  value={contactForm.lastName}
                  onChange={(e) =>
                    setContactForm({ ...contactForm, lastName: e.target.value })
                  }
                  placeholder="Last name"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="contact-email">Email</Label>
              <Input
                id="contact-email"
                type="email"
                value={contactForm.email}
                onChange={(e) =>
                  setContactForm({ ...contactForm, email: e.target.value })
                }
                placeholder="email@example.com"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="contact-phone">Phone</Label>
              <Input
                id="contact-phone"
                value={contactForm.phone}
                onChange={(e) =>
                  setContactForm({ ...contactForm, phone: e.target.value })
                }
                placeholder="Phone number"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="contact-role">Role</Label>
              <Select
                value={contactForm.role}
                onValueChange={(v) =>
                  setContactForm({
                    ...contactForm,
                    role: v as ContactFormData["role"],
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="primary">Primary</SelectItem>
                  <SelectItem value="billing">Billing</SelectItem>
                  <SelectItem value="technical">Technical</SelectItem>
                  <SelectItem value="management">Management</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="contact-title">Job Title</Label>
              <Input
                id="contact-title"
                value={contactForm.jobTitle}
                onChange={(e) =>
                  setContactForm({ ...contactForm, jobTitle: e.target.value })
                }
                placeholder="Job title (optional)"
              />
            </div>
            <div className="flex items-center gap-6 pt-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="contact-primary"
                  checked={contactForm.isPrimary}
                  onCheckedChange={(checked) =>
                    setContactForm({ ...contactForm, isPrimary: checked === true })
                  }
                />
                <Label htmlFor="contact-primary" className="text-sm font-normal">
                  Primary Contact
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="contact-portal"
                  checked={contactForm.hasPortalAccess}
                  onCheckedChange={(checked) =>
                    setContactForm({ ...contactForm, hasPortalAccess: checked === true })
                  }
                />
                <Label htmlFor="contact-portal" className="text-sm font-normal">
                  Portal Access
                </Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContactDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveContact}
              disabled={!contactForm.firstName || !contactForm.lastName || !contactForm.email}
            >
              {editingContact ? "Save Changes" : "Add Contact"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite User Dialog */}
      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create User & Send Invite</DialogTitle>
            <DialogDescription>
              Invite a user to sign in. Accounts are provisioned by admins only.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="invite-first">First Name</Label>
                <Input
                  id="invite-first"
                  value={inviteForm.firstName}
                  onChange={(e) =>
                    setInviteForm({ ...inviteForm, firstName: e.target.value })
                  }
                  placeholder="First name"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="invite-last">Last Name</Label>
                <Input
                  id="invite-last"
                  value={inviteForm.lastName}
                  onChange={(e) =>
                    setInviteForm({ ...inviteForm, lastName: e.target.value })
                  }
                  placeholder="Last name"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={inviteForm.email}
                onChange={(e) =>
                  setInviteForm({ ...inviteForm, email: e.target.value })
                }
                placeholder="user@company.com"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="invite-role">Portal Role</Label>
              <Select
                value={inviteForm.role}
                onValueChange={(value) =>
                  setInviteForm({ ...inviteForm, role: value as UserRole })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="client">Client</SelectItem>
                  <SelectItem value="contractor">Contractor</SelectItem>
                  <SelectItem value="technician">Technician</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(inviteForm.role === "client" || inviteForm.role === "contractor") && (
              <div className="grid gap-2">
                <Label htmlFor="invite-org">Organisation</Label>
                <Select
                  value={inviteForm.organizationId}
                  onValueChange={(value) =>
                    setInviteForm({ ...inviteForm, organizationId: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select organisation" />
                  </SelectTrigger>
                  <SelectContent>
                    {organizationOptions.map((org) => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSendInvite} disabled={inviteLoading}>
              {inviteLoading ? "Sending..." : "Send Invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Import Dialog */}
      <Dialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Bulk Import Invites</DialogTitle>
            <DialogDescription>
              Upload a CSV or TSV to create organisations, contacts, and invites.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="bulk-file">CSV/TSV File</Label>
              <Input
                id="bulk-file"
                type="file"
                accept=".csv,.tsv,text/csv,text/tab-separated-values"
                onChange={(e) => handleBulkFileSelect(e.target.files?.[0] || null)}
              />
              {bulkPreview.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">Preview</p>
                  <ul className="mt-1 list-disc pl-4">
                    {bulkPreview.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="bulk-send"
                checked={bulkSendEmails}
                onCheckedChange={(checked) => setBulkSendEmails(checked === true)}
              />
              <Label htmlFor="bulk-send" className="text-sm font-normal">
                Send invite emails after import
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleBulkImport} disabled={bulkImporting || !bulkFile}>
              {bulkImporting ? "Importing..." : "Start Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
