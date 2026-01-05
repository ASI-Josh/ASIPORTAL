"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Timestamp } from "firebase/firestore";
import { format } from "date-fns";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import {
  BookingType,
  BOOKING_TYPE_LABELS,
  ContactCategory,
  CONTACT_CATEGORY_LABELS,
  ContactOrganization,
  OrganizationContact,
  SiteLocation,
  Address,
  Booking,
} from "@/lib/types";

// Mock Organizations Data
const mockOrganizations: ContactOrganization[] = [
  {
    id: "org-1",
    name: "Metro Fleet Services",
    category: "trade_client",
    type: "customer",
    status: "active",
    abn: "12 345 678 901",
    marketStream: "commercial",
    phone: "02 9876 5432",
    email: "bookings@metrofleet.com.au",
    sites: [
      {
        id: "site-1",
        name: "Head Office",
        address: { street: "123 Industrial Ave", suburb: "Alexandria", state: "NSW", postcode: "2015", country: "Australia" },
        isDefault: true,
        contactName: "John Smith",
        contactPhone: "0412 345 678",
      },
      {
        id: "site-2",
        name: "Western Depot",
        address: { street: "45 Warehouse Rd", suburb: "Wetherill Park", state: "NSW", postcode: "2164", country: "Australia" },
        isDefault: false,
      },
    ],
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  {
    id: "org-2",
    name: "Sydney CBD Motors",
    category: "retail_client",
    type: "customer",
    status: "active",
    abn: "98 765 432 109",
    marketStream: "retail",
    phone: "02 8765 4321",
    email: "service@cbdmotors.com.au",
    sites: [
      {
        id: "site-3",
        name: "Showroom",
        address: { street: "500 George St", suburb: "Sydney", state: "NSW", postcode: "2000", country: "Australia" },
        isDefault: true,
      },
    ],
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  {
    id: "org-3",
    name: "Government Transport NSW",
    category: "trade_client",
    type: "customer",
    status: "active",
    abn: "11 222 333 444",
    marketStream: "government",
    phone: "02 9000 1234",
    email: "fleet@transport.nsw.gov.au",
    sites: [
      {
        id: "site-4",
        name: "Parramatta Depot",
        address: { street: "100 Smith St", suburb: "Parramatta", state: "NSW", postcode: "2150", country: "Australia" },
        isDefault: true,
      },
    ],
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
];

const mockContacts: OrganizationContact[] = [
  {
    id: "contact-1",
    organizationId: "org-1",
    firstName: "John",
    lastName: "Smith",
    email: "john.smith@metrofleet.com.au",
    phone: "02 9876 5432",
    mobile: "0412 345 678",
    role: "primary",
    jobTitle: "Fleet Manager",
    status: "active",
    isPrimary: true,
    hasPortalAccess: true,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  {
    id: "contact-2",
    organizationId: "org-1",
    firstName: "Sarah",
    lastName: "Johnson",
    email: "sarah.j@metrofleet.com.au",
    phone: "02 9876 5433",
    role: "billing",
    jobTitle: "Accounts Manager",
    status: "active",
    isPrimary: false,
    hasPortalAccess: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  {
    id: "contact-3",
    organizationId: "org-2",
    firstName: "Michael",
    lastName: "Brown",
    email: "michael@cbdmotors.com.au",
    phone: "02 8765 4321",
    mobile: "0423 456 789",
    role: "primary",
    jobTitle: "Service Manager",
    status: "active",
    isPrimary: true,
    hasPortalAccess: true,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  {
    id: "contact-4",
    organizationId: "org-3",
    firstName: "Emily",
    lastName: "Davis",
    email: "emily.davis@transport.nsw.gov.au",
    phone: "02 9000 1234",
    role: "primary",
    jobTitle: "Procurement Officer",
    status: "active",
    isPrimary: true,
    hasPortalAccess: true,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
];

const mockStaff = [
  { id: "staff-1", name: "Joshua Hyde", type: "asi_staff" as const },
  { id: "staff-2", name: "Jaydan Smith", type: "asi_staff" as const },
  { id: "staff-3", name: "Bobby Wilson", type: "asi_staff" as const },
  { id: "staff-4", name: "Mike's Mobile Repairs", type: "subcontractor" as const },
  { id: "staff-5", name: "Premier Auto Glass", type: "subcontractor" as const },
];

// Mock existing bookings
const mockBookings: Booking[] = [
  {
    id: "booking-1",
    bookingNumber: "BK-2025-0001",
    bookingType: "windscreen_crack_chip_repair",
    organizationId: "org-1",
    organizationName: "Metro Fleet Services",
    contactId: "contact-1",
    contactName: "John Smith",
    contactEmail: "john.smith@metrofleet.com.au",
    contactPhone: "0412 345 678",
    siteLocation: {
      id: "site-1",
      name: "Head Office",
      address: { street: "123 Industrial Ave", suburb: "Alexandria", state: "NSW", postcode: "2015", country: "Australia" },
    },
    scheduledDate: Timestamp.fromDate(new Date(2025, 0, 8)),
    scheduledTime: "09:00",
    allocatedStaff: [{ id: "staff-1", name: "Joshua Hyde", type: "asi_staff" }],
    status: "confirmed",
    createdAt: Timestamp.now(),
    createdBy: "admin",
    updatedAt: Timestamp.now(),
  },
  {
    id: "booking-2",
    bookingNumber: "BK-2025-0002",
    bookingType: "film_installation",
    organizationId: "org-2",
    organizationName: "Sydney CBD Motors",
    contactId: "contact-3",
    contactName: "Michael Brown",
    contactEmail: "michael@cbdmotors.com.au",
    contactPhone: "0423 456 789",
    siteLocation: {
      id: "site-3",
      name: "Showroom",
      address: { street: "500 George St", suburb: "Sydney", state: "NSW", postcode: "2000", country: "Australia" },
    },
    scheduledDate: Timestamp.fromDate(new Date(2025, 0, 10)),
    scheduledTime: "14:00",
    allocatedStaff: [
      { id: "staff-2", name: "Jaydan Smith", type: "asi_staff" },
      { id: "staff-3", name: "Bobby Wilson", type: "asi_staff" },
    ],
    status: "pending",
    createdAt: Timestamp.now(),
    createdBy: "admin",
    updatedAt: Timestamp.now(),
  },
];

interface NewOrganizationFormData {
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
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  mobile: string;
  jobTitle: string;
}

export default function BookingsPage() {
  const router = useRouter();
  const { toast } = useToast();

  // State for booking list view
  const [searchQuery, setSearchQuery] = useState("");
  const [bookings, setBookings] = useState<Booking[]>(mockBookings);

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
    state: "NSW",
    postcode: "",
    country: "Australia",
  });
  const [scheduledDate, setScheduledDate] = useState<Date | undefined>();
  const [scheduledTime, setScheduledTime] = useState("");
  const [selectedStaff, setSelectedStaff] = useState<typeof mockStaff>([]);
  const [bookingNotes, setBookingNotes] = useState("");

  // New organization dialog
  const [showNewOrgDialog, setShowNewOrgDialog] = useState(false);
  const [newOrgData, setNewOrgData] = useState<NewOrganizationFormData>({
    name: "",
    category: "trade_client",
    abn: "",
    phone: "",
    email: "",
    street: "",
    suburb: "",
    state: "NSW",
    postcode: "",
  });

  // New contact dialog
  const [showNewContactDialog, setShowNewContactDialog] = useState(false);
  const [newContactData, setNewContactData] = useState<NewContactFormData>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    mobile: "",
    jobTitle: "",
  });

  // Organization search
  const [orgSearchQuery, setOrgSearchQuery] = useState("");
  const filteredOrganizations = mockOrganizations.filter(
    (org) =>
      org.name.toLowerCase().includes(orgSearchQuery.toLowerCase()) ||
      org.email?.toLowerCase().includes(orgSearchQuery.toLowerCase())
  );

  // Get contacts for selected organization
  const organizationContacts = selectedOrganization
    ? mockContacts.filter((c) => c.organizationId === selectedOrganization.id)
    : [];

  // Time slots
  const timeSlots = [
    "07:00", "07:30", "08:00", "08:30", "09:00", "09:30",
    "10:00", "10:30", "11:00", "11:30", "12:00", "12:30",
    "13:00", "13:30", "14:00", "14:30", "15:00", "15:30",
    "16:00", "16:30", "17:00",
  ];

  const handleSelectOrganization = (org: ContactOrganization) => {
    setSelectedOrganization(org);
    setOrgSearchQuery("");
    
    // Auto-select primary contact
    const primaryContact = mockContacts.find(
      (c) => c.organizationId === org.id && c.isPrimary
    );
    if (primaryContact) {
      setSelectedContact(primaryContact);
    }

    // Auto-select default site
    const defaultSite = org.sites.find((s) => s.isDefault) || org.sites[0];
    if (defaultSite) {
      setSelectedSite(defaultSite);
    }
  };

  const handleCreateOrganization = () => {
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

    mockOrganizations.push(newOrg);
    setSelectedOrganization(newOrg);
    setSelectedSite(newOrg.sites[0]);
    setShowNewOrgDialog(false);
    setNewOrgData({
      name: "",
      category: "trade_client",
      abn: "",
      phone: "",
      email: "",
      street: "",
      suburb: "",
      state: "NSW",
      postcode: "",
    });

    toast({
      title: "Organization Created",
      description: `${newOrg.name} has been added to your contacts.`,
    });
  };

  const handleCreateContact = () => {
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
      isPrimary: organizationContacts.length === 0,
      hasPortalAccess: true,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };

    mockContacts.push(newContact);
    setSelectedContact(newContact);
    setShowNewContactDialog(false);
    setNewContactData({
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      mobile: "",
      jobTitle: "",
    });

    toast({
      title: "Contact Created",
      description: `${newContact.firstName} ${newContact.lastName} has been added as a contact.`,
    });
  };

  const handleToggleStaff = (staff: (typeof mockStaff)[0]) => {
    setSelectedStaff((prev) => {
      const exists = prev.find((s) => s.id === staff.id);
      if (exists) {
        return prev.filter((s) => s.id !== staff.id);
      }
      return [...prev, staff];
    });
  };

  const handleCreateBooking = () => {
    if (!bookingType || !selectedOrganization || !selectedContact || !scheduledDate || !scheduledTime) {
      toast({
        title: "Missing Information",
        description: "Please complete all required fields.",
        variant: "destructive",
      });
      return;
    }

    const siteAddress = useCustomSite
      ? customSite
      : selectedSite?.address || customSite;

    const newBooking: Booking = {
      id: `booking-${Date.now()}`,
      bookingNumber: `BK-${new Date().getFullYear()}-${String(bookings.length + 1).padStart(4, "0")}`,
      bookingType: bookingType as BookingType,
      organizationId: selectedOrganization.id,
      organizationName: selectedOrganization.name,
      contactId: selectedContact.id,
      contactName: `${selectedContact.firstName} ${selectedContact.lastName}`,
      contactEmail: selectedContact.email,
      contactPhone: selectedContact.mobile || selectedContact.phone,
      siteLocation: {
        id: useCustomSite ? undefined : selectedSite?.id,
        name: useCustomSite ? "Custom Location" : selectedSite?.name || "Custom Location",
        address: siteAddress,
      },
      scheduledDate: Timestamp.fromDate(scheduledDate),
      scheduledTime,
      allocatedStaff: selectedStaff.map((s) => ({ id: s.id, name: s.name, type: s.type })),
      notes: bookingNotes,
      status: "confirmed",
      createdAt: Timestamp.now(),
      createdBy: "current-user",
      updatedAt: Timestamp.now(),
    };

    setBookings([newBooking, ...bookings]);

    toast({
      title: "Booking Created Successfully",
      description: (
        <div className="mt-2 space-y-1">
          <p>Booking #{newBooking.bookingNumber} has been created.</p>
          <p className="text-sm text-muted-foreground">
            A job card will be automatically generated and the booking has been logged to the Works Register.
          </p>
        </div>
      ),
    });

    // Reset form
    resetBookingForm();
    setShowNewBookingDialog(false);

    // Navigate to the new job (in real app, this would be the job ID from the created job)
    // router.push(`/dashboard/jobs/${newBooking.id}`);
  };

  const resetBookingForm = () => {
    setBookingStep(1);
    setBookingType("");
    setSelectedOrganization(null);
    setSelectedContact(null);
    setSelectedSite(null);
    setUseCustomSite(false);
    setCustomSite({ street: "", suburb: "", state: "NSW", postcode: "", country: "Australia" });
    setScheduledDate(undefined);
    setScheduledTime("");
    setSelectedStaff([]);
    setBookingNotes("");
    setOrgSearchQuery("");
  };

  const canProceedToStep2 = bookingType !== "";
  const canProceedToStep3 = selectedOrganization !== null && selectedContact !== null;
  const canProceedToStep4 = scheduledDate !== undefined && scheduledTime !== "" && (selectedSite !== null || useCustomSite);
  const canSubmit = selectedStaff.length > 0;

  const filteredBookings = bookings.filter(
    (b) =>
      b.bookingNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.organizationName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.contactName.toLowerCase().includes(searchQuery.toLowerCase())
  );

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

            <ScrollArea className="flex-1 px-1">
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
                    {/* Organization Selection */}
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <Label className="text-base font-semibold">Customer Organization</Label>
                          <p className="text-sm text-muted-foreground">
                            Select an existing customer or add a new one
                          </p>
                        </div>
                        <Dialog open={showNewOrgDialog} onOpenChange={setShowNewOrgDialog}>
                          <DialogTrigger asChild>
                            <Button variant="outline" size="sm" className="gap-2">
                              <Plus className="h-4 w-4" />
                              New Customer
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-lg">
                            <DialogHeader>
                              <DialogTitle>Add New Customer</DialogTitle>
                              <DialogDescription>
                                Create a new customer organization
                              </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                              <div className="grid grid-cols-2 gap-4">
                                <div className="col-span-2">
                                  <Label>Organization Name *</Label>
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
                                      {(Object.entries(CONTACT_CATEGORY_LABELS) as [ContactCategory, string][]).map(
                                        ([value, label]) => (
                                          <SelectItem key={value} value={value}>
                                            {label}
                                          </SelectItem>
                                        )
                                      )}
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
                                  <Label>Phone</Label>
                                  <Input
                                    value={newOrgData.phone}
                                    onChange={(e) =>
                                      setNewOrgData({ ...newOrgData, phone: e.target.value })
                                    }
                                    placeholder="02 1234 5678"
                                  />
                                </div>
                                <div>
                                  <Label>Email *</Label>
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
                            </div>
                            <DialogFooter>
                              <Button variant="outline" onClick={() => setShowNewOrgDialog(false)}>
                                Cancel
                              </Button>
                              <Button
                                onClick={handleCreateOrganization}
                                disabled={!newOrgData.name || !newOrgData.email}
                              >
                                Create Customer
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
                          <Dialog open={showNewContactDialog} onOpenChange={setShowNewContactDialog}>
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
                                      placeholder="john@company.com"
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
                                <Button variant="outline" onClick={() => setShowNewContactDialog(false)}>
                                  Cancel
                                </Button>
                                <Button
                                  onClick={handleCreateContact}
                                  disabled={
                                    !newContactData.firstName ||
                                    !newContactData.lastName ||
                                    !newContactData.email
                                  }
                                >
                                  Create Contact
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {organizationContacts.map((contact) => (
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
                        </div>
                      </div>
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
                                disabled={(date) => date < new Date()}
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
                            <SelectContent>
                              {timeSlots.map((time) => (
                                <SelectItem key={time} value={time}>
                                  {time}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
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

                      {selectedOrganization && selectedOrganization.sites.length > 0 && !useCustomSite && (
                        <div className="space-y-3">
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

                      {useCustomSite && (
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
                    </div>

                    <div className="space-y-4">
                      <div>
                        <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                          <Users className="h-4 w-4" />
                          ASI Staff
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {mockStaff
                            .filter((s) => s.type === "asi_staff")
                            .map((staff) => (
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
                        </div>
                      </div>

                      <div>
                        <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                          <Building2 className="h-4 w-4" />
                          Subcontractors
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {mockStaff
                            .filter((s) => s.type === "subcontractor")
                            .map((staff) => (
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
                            <span className="font-medium">{selectedOrganization?.name}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Contact:</span>
                            <span className="font-medium">
                              {selectedContact?.firstName} {selectedContact?.lastName}
                            </span>
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
            </ScrollArea>

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
                    <Button onClick={handleCreateBooking} disabled={!canSubmit}>
                      <CheckCircle className="mr-2 h-4 w-4" />
                      Confirm Booking
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
              {filteredBookings.map((booking) => (
                <TableRow key={booking.id}>
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
                      variant={
                        booking.status === "confirmed"
                          ? "default"
                          : booking.status === "pending"
                          ? "secondary"
                          : booking.status === "converted_to_job"
                          ? "outline"
                          : "destructive"
                      }
                    >
                      {booking.status === "converted_to_job" ? "Converted" : booking.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => router.push(`/dashboard/jobs/${booking.id}`)}
                    >
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
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
    </div>
  );
}
