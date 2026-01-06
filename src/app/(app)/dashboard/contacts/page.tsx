"use client";

import { useState } from "react";
import { Timestamp } from "firebase/firestore";
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

import {
  ContactOrganization,
  OrganizationContact,
  ContactCategory,
  CONTACT_CATEGORY_LABELS,
  MarketStream,
  OrganizationStatus,
} from "@/lib/types";

// Organizations data
const mockOrganizations: ContactOrganization[] = [
  // ASI Staff
  {
    id: "org-asi",
    name: "ASI Australia",
    category: "asi_staff",
    type: "partner",
    status: "active",
    abn: "",
    address: {
      street: "",
      suburb: "Melbourne",
      state: "VIC",
      postcode: "",
      country: "Australia",
    },
    sites: [],
    phone: "",
    email: "admin@asi-australia.com.au",
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  // Trade Clients
  {
    id: "org-bss",
    name: "Bus Services & Solutions",
    category: "trade_client",
    type: "customer",
    status: "active",
    abn: "",
    address: {
      street: "",
      suburb: "",
      state: "VIC",
      postcode: "",
      country: "Australia",
    },
    sites: [],
    phone: "0406 807 234",
    email: "accounts@bssvic.com.au",
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  {
    id: "org-eurohub",
    name: "Eurohub",
    category: "trade_client",
    type: "customer",
    status: "active",
    abn: "85 620 099 756",
    address: {
      street: "706 Lorimer St",
      suburb: "Port Melbourne",
      state: "VIC",
      postcode: "3207",
      country: "Australia",
    },
    sites: [],
    phone: "(03) 7035 3777",
    email: "Accounts@eurohub.com.au",
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  {
    id: "org-harden",
    name: "Harden Packaging",
    category: "trade_client",
    type: "customer",
    status: "active",
    abn: "56 454 174 836",
    address: {
      street: "29 Korong Rd",
      suburb: "Heidelberg West",
      state: "VIC",
      postcode: "3081",
      country: "Australia",
    },
    sites: [],
    phone: "03 9458 2533",
    email: "sales@hardenpackaging.com.au",
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  {
    id: "org-irizar",
    name: "Irizar Asia Pacific",
    category: "trade_client",
    type: "customer",
    status: "active",
    abn: "53 162 612 795",
    address: {
      street: "49 Greenhills Rd",
      suburb: "Pakenham",
      state: "VIC",
      postcode: "3810",
      country: "Australia",
    },
    sites: [],
    phone: "",
    email: "",
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  {
    id: "org-lsh",
    name: "LSH AUTO (MELBOURNE) Pty Ltd",
    category: "trade_client",
    type: "customer",
    status: "active",
    abn: "77 618 554 635",
    address: {
      street: "135 Kings Way",
      suburb: "South Melbourne",
      state: "VIC",
      postcode: "3205",
      country: "Australia",
    },
    sites: [],
    phone: "0406 202 117",
    email: "john.mack@mbmelbourne.com.au",
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  {
    id: "org-mcc",
    name: "Melbournes Cheapest Cars",
    category: "trade_client",
    type: "customer",
    status: "active",
    abn: "43 666 685 589",
    address: {
      street: "6 Lennox St",
      suburb: "Moorabbin",
      state: "VIC",
      postcode: "3189",
      country: "Australia",
    },
    sites: [],
    phone: "0418 105 039",
    email: "jimmacris68@gmail.com",
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  {
    id: "org-millennium",
    name: "Millennium Auto (Carguru)",
    category: "trade_client",
    type: "customer",
    status: "active",
    abn: "74 533 584 563",
    address: {
      street: "146-148 Thistlethwaite St",
      suburb: "South Melbourne",
      state: "VIC",
      postcode: "3205",
      country: "Australia",
    },
    sites: [],
    phone: "0406 265 933",
    email: "sales@millenniumauto.com.au",
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  {
    id: "org-nuline",
    name: "Nuline Charter Pty Ltd",
    category: "trade_client",
    type: "customer",
    status: "active",
    abn: "25 981 499 326",
    address: {
      street: "36-44 Whiteside Rd",
      suburb: "Clayton South",
      state: "VIC",
      postcode: "3169",
      country: "Australia",
    },
    sites: [],
    phone: "0413 245 940",
    email: "charlie@nulinecharter.com.au",
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  {
    id: "org-pagebros",
    name: "Page Bros RV",
    category: "trade_client",
    type: "customer",
    status: "active",
    abn: "52 408 358 400",
    address: {
      street: "893-895 Princes Hwy",
      suburb: "Springvale",
      state: "VIC",
      postcode: "3171",
      country: "Australia",
    },
    sites: [],
    phone: "(03) 9786 1000",
    email: "mark@pagebrosrv.com.au",
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
];

// Contacts data
const mockContacts: OrganizationContact[] = [
  // ASI Staff
  {
    id: "contact-josh",
    organizationId: "org-asi",
    firstName: "Joshua",
    lastName: "Hyde",
    email: "joshua@asi-australia.com.au",
    mobile: "0437 087 042",
    role: "management",
    jobTitle: "Director",
    status: "active",
    isPrimary: false,
    hasPortalAccess: true,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  {
    id: "contact-jaydan",
    organizationId: "org-asi",
    firstName: "Jaydan",
    lastName: "Hyde",
    email: "jaydan@asi-australia.com.au",
    mobile: "0457 183 494",
    role: "management",
    jobTitle: "Administration Manager",
    status: "active",
    isPrimary: true,
    hasPortalAccess: true,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  {
    id: "contact-bobby",
    organizationId: "org-asi",
    firstName: "Bobby",
    lastName: "McLaren",
    email: "bobby@asi-australia.com.au",
    mobile: "0427 316 318",
    role: "management",
    jobTitle: "Operations Manager",
    status: "active",
    isPrimary: false,
    hasPortalAccess: true,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  // Bus Services & Solutions
  {
    id: "contact-bss-johnathan",
    organizationId: "org-bss",
    firstName: "Johnathan",
    lastName: "",
    email: "johnathan@bssvic.com.au",
    phone: "0406 807 234",
    role: "primary",
    status: "active",
    isPrimary: true,
    hasPortalAccess: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  {
    id: "contact-bss-anderson",
    organizationId: "org-bss",
    firstName: "Anderson",
    lastName: "Silva",
    email: "anderson@bssvic.com.au",
    role: "primary",
    status: "active",
    isPrimary: false,
    hasPortalAccess: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  // Eurohub
  {
    id: "contact-eurohub-sales",
    organizationId: "org-eurohub",
    firstName: "Sales",
    lastName: "",
    email: "sales@eurohub.com.au",
    phone: "(03) 7035 3777",
    role: "primary",
    status: "active",
    isPrimary: true,
    hasPortalAccess: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  {
    id: "contact-eurohub-milo",
    organizationId: "org-eurohub",
    firstName: "Milo",
    lastName: "",
    email: "milo@eurohub.com.au",
    role: "primary",
    status: "active",
    isPrimary: false,
    hasPortalAccess: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  // Harden Packaging
  {
    id: "contact-harden-sales",
    organizationId: "org-harden",
    firstName: "Sales",
    lastName: "",
    email: "sales@hardenpackaging.com.au",
    phone: "03 9458 2533",
    role: "primary",
    status: "active",
    isPrimary: true,
    hasPortalAccess: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  // LSH AUTO
  {
    id: "contact-lsh-john",
    organizationId: "org-lsh",
    firstName: "John",
    lastName: "Mack",
    email: "john.mack@mbmelbourne.com.au",
    mobile: "0406 202 117",
    role: "primary",
    status: "active",
    isPrimary: true,
    hasPortalAccess: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  {
    id: "contact-lsh-diana",
    organizationId: "org-lsh",
    firstName: "Diana",
    lastName: "Gonzaga",
    email: "Diana.gonzaga@mbmelbourne.com.au",
    role: "primary",
    status: "active",
    isPrimary: false,
    hasPortalAccess: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  {
    id: "contact-lsh-nabil",
    organizationId: "org-lsh",
    firstName: "Nabil",
    lastName: "Girgis",
    email: "accounts.mbm@mbmelbourne.com.au",
    role: "billing",
    status: "active",
    isPrimary: false,
    hasPortalAccess: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  // Melbournes Cheapest Cars
  {
    id: "contact-mcc-jim",
    organizationId: "org-mcc",
    firstName: "Jim",
    lastName: "Macris",
    email: "jimmacris68@gmail.com",
    mobile: "0418 105 039",
    role: "primary",
    status: "active",
    isPrimary: true,
    hasPortalAccess: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  {
    id: "contact-mcc-pradeep",
    organizationId: "org-mcc",
    firstName: "Pradeep",
    lastName: "Wijesingha",
    email: "pradeep.w@autonxt.com.au",
    role: "primary",
    status: "active",
    isPrimary: false,
    hasPortalAccess: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  // Millennium Auto
  {
    id: "contact-millennium-guru",
    organizationId: "org-millennium",
    firstName: "Guru",
    lastName: "",
    email: "sales@millenniumauto.com.au",
    mobile: "0406 265 933",
    role: "primary",
    status: "active",
    isPrimary: true,
    hasPortalAccess: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  // Nuline Charter
  {
    id: "contact-nuline-charlie",
    organizationId: "org-nuline",
    firstName: "Charlie",
    lastName: "Crespo",
    email: "charlie@nulinecharter.com.au",
    mobile: "0413 245 940",
    role: "primary",
    status: "active",
    isPrimary: true,
    hasPortalAccess: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  {
    id: "contact-nuline-jason",
    organizationId: "org-nuline",
    firstName: "Jason",
    lastName: "Fletcher",
    email: "Jason@nulinecharter.com.au",
    role: "primary",
    status: "active",
    isPrimary: false,
    hasPortalAccess: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  {
    id: "contact-nuline-ash",
    organizationId: "org-nuline",
    firstName: "Ash",
    lastName: "",
    email: "ash@nulinecharter.com.au",
    role: "primary",
    status: "active",
    isPrimary: false,
    hasPortalAccess: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  {
    id: "contact-nuline-andrew",
    organizationId: "org-nuline",
    firstName: "Andrew",
    lastName: "McDonald",
    email: "info@nulinecharter.com.au",
    role: "primary",
    status: "active",
    isPrimary: false,
    hasPortalAccess: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  // Page Bros RV
  {
    id: "contact-pagebros-mark",
    organizationId: "org-pagebros",
    firstName: "Mark",
    lastName: "Cunningham",
    email: "mark@pagebrosrv.com.au",
    phone: "(03) 9786 1000",
    role: "primary",
    status: "active",
    isPrimary: true,
    hasPortalAccess: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
];

type OrganizationFormData = {
  name: string;
  category: ContactCategory;
  abn: string;
  marketStream: MarketStream | "";
  status: OrganizationStatus;
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
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<ContactCategory>("trade_client");
  const [organizations, setOrganizations] = useState(mockOrganizations);
  const [contacts, setContacts] = useState(mockContacts);

  const [orgDialogOpen, setOrgDialogOpen] = useState(false);
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<ContactOrganization | null>(null);
  const [editingContact, setEditingContact] = useState<OrganizationContact | null>(null);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

  const [orgForm, setOrgForm] = useState<OrganizationFormData>(initialOrgForm);
  const [contactForm, setContactForm] = useState<ContactFormData>(initialContactForm);

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

  const handleSaveOrg = () => {
    if (editingOrg) {
      setOrganizations((prev) =>
        prev.map((org) =>
          org.id === editingOrg.id
            ? {
                ...org,
                name: orgForm.name,
                category: orgForm.category,
                abn: orgForm.abn || undefined,
                marketStream: orgForm.marketStream || undefined,
                status: orgForm.status,
                address: {
                  street: orgForm.street,
                  suburb: orgForm.suburb,
                  state: orgForm.state,
                  postcode: orgForm.postcode,
                  country: "Australia",
                },
                updatedAt: Timestamp.now(),
              }
            : org
        )
      );
    } else {
      const newOrg: ContactOrganization = {
        id: `org-${Date.now()}`,
        name: orgForm.name,
        category: orgForm.category,
        type: "customer",
        status: orgForm.status,
        abn: orgForm.abn || undefined,
        marketStream: orgForm.marketStream || undefined,
        address: {
          street: orgForm.street,
          suburb: orgForm.suburb,
          state: orgForm.state,
          postcode: orgForm.postcode,
          country: "Australia",
        },
        sites: [],
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };
      setOrganizations((prev) => [...prev, newOrg]);
    }
    setOrgDialogOpen(false);
    setOrgForm(initialOrgForm);
  };

  const handleDeleteOrg = (orgId: string) => {
    setOrganizations((prev) => prev.filter((org) => org.id !== orgId));
    setContacts((prev) => prev.filter((c) => c.organizationId !== orgId));
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

  const handleSaveContact = () => {
    if (!selectedOrgId) return;

    if (editingContact) {
      setContacts((prev) =>
        prev.map((c) =>
          c.id === editingContact.id
            ? {
                ...c,
                firstName: contactForm.firstName,
                lastName: contactForm.lastName,
                email: contactForm.email,
                phone: contactForm.phone,
                role: contactForm.role,
                jobTitle: contactForm.jobTitle || undefined,
                isPrimary: contactForm.isPrimary,
                hasPortalAccess: contactForm.hasPortalAccess,
                updatedAt: Timestamp.now(),
              }
            : c
        )
      );
    } else {
      const newContact: OrganizationContact = {
        id: `contact-${Date.now()}`,
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
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };
      setContacts((prev) => [...prev, newContact]);
    }
    setContactDialogOpen(false);
    setContactForm(initialContactForm);
    setSelectedOrgId(null);
  };

  const handleDeleteContact = (contactId: string) => {
    setContacts((prev) => prev.filter((c) => c.id !== contactId));
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-headline font-bold tracking-tight">
            Contacts Database
          </h2>
          <p className="text-muted-foreground">
            Manage organizations and contacts by category.
          </p>
        </div>
        <Button onClick={() => handleOpenOrgDialog()}>
          <Plus className="mr-2 h-4 w-4" />
          Add Organization
        </Button>
      </div>

      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search organizations..."
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
                    <p>No organizations found in this category.</p>
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
              {editingOrg ? "Edit Organization" : "Add Organization"}
            </DialogTitle>
            <DialogDescription>
              {editingOrg
                ? "Update organization details."
                : "Add a new organization to the database."}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="grid gap-4 py-4 pr-4">
              <div className="grid gap-2">
                <Label htmlFor="org-name">Organization Name</Label>
                <Input
                  id="org-name"
                  value={orgForm.name}
                  onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })}
                  placeholder="Enter organization name"
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
              {editingOrg ? "Save Changes" : "Add Organization"}
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
                : "Add a new contact to the organization."}
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
    </div>
  );
}
