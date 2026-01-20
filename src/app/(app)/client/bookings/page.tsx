"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { format, startOfDay } from "date-fns";
import {
  Calendar as CalendarIcon,
  Plus,
  MapPin,
  Mail,
  Phone,
  ArrowRight,
} from "lucide-react";
import { collection, doc, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { useAuth } from "@/contexts/AuthContext";
import { useJobs } from "@/contexts/JobsContext";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import type {
  Address,
  Booking,
  BookingType,
  ContactOrganization,
  OrganizationContact,
  SiteLocation,
} from "@/lib/types";
import { BOOKING_TYPE_LABELS } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

const timeSlots = [
  "07:00",
  "07:30",
  "08:00",
  "08:30",
  "09:00",
  "09:30",
  "10:00",
  "10:30",
  "11:00",
  "11:30",
  "12:00",
  "12:30",
  "13:00",
  "13:30",
  "14:00",
  "14:30",
  "15:00",
  "15:30",
  "16:00",
  "16:30",
  "17:00",
];

const statusLabels: Record<Booking["status"], string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  converted_to_job: "Converted",
  cancelled: "Cancelled",
};

export default function ClientBookingsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { bookings, createBooking } = useJobs();
  const { toast } = useToast();
  const [organization, setOrganization] = useState<ContactOrganization | null>(null);
  const [contacts, setContacts] = useState<OrganizationContact[]>([]);
  const [showDialog, setShowDialog] = useState(false);
  const [bookingType, setBookingType] = useState<BookingType | "">("");
  const [selectedContactId, setSelectedContactId] = useState("");
  const [scheduledDate, setScheduledDate] = useState<Date | undefined>();
  const [scheduledTime, setScheduledTime] = useState("");
  const [notes, setNotes] = useState("");
  const [useCustomSite, setUseCustomSite] = useState(false);
  const [selectedSite, setSelectedSite] = useState<SiteLocation | null>(null);
  const [customSite, setCustomSite] = useState<Address>({
    street: "",
    suburb: "",
    state: "VIC",
    postcode: "",
    country: "Australia",
  });

  useEffect(() => {
    if (!user?.organizationId) return;
    const orgRef = doc(db, COLLECTIONS.CONTACT_ORGANIZATIONS, user.organizationId);
    const unsubscribe = onSnapshot(orgRef, (snapshot) => {
      if (!snapshot.exists()) {
        setOrganization(null);
        return;
      }
      const org = {
        id: snapshot.id,
        ...(snapshot.data() as Omit<ContactOrganization, "id">),
      };
      setOrganization(org);
      const defaultSite = org.sites.find((site) => site.isDefault) || org.sites[0] || null;
      setSelectedSite(defaultSite);
    });
    return () => unsubscribe();
  }, [user?.organizationId]);

  useEffect(() => {
    if (!user?.organizationId) return;
    const contactQuery = query(
      collection(db, COLLECTIONS.ORGANIZATION_CONTACTS),
      where("organizationId", "==", user.organizationId),
      orderBy("createdAt", "asc")
    );
    const unsubscribe = onSnapshot(contactQuery, (snapshot) => {
      setContacts(
        snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<OrganizationContact, "id">),
        }))
      );
    });
    return () => unsubscribe();
  }, [user?.organizationId]);

  const selectedContact = useMemo(
    () => contacts.find((contact) => contact.id === selectedContactId) || null,
    [contacts, selectedContactId]
  );

  const clientBookings = useMemo(
    () => bookings.slice().sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis()),
    [bookings]
  );

  const resetForm = () => {
    setBookingType("");
    setSelectedContactId("");
    setScheduledDate(undefined);
    setScheduledTime("");
    setNotes("");
    setUseCustomSite(false);
    setCustomSite({ street: "", suburb: "", state: "VIC", postcode: "", country: "Australia" });
    if (organization?.sites?.length) {
      setSelectedSite(organization.sites.find((site) => site.isDefault) || organization.sites[0]);
    }
  };

  const handleCreateBooking = async () => {
    if (!organization || !bookingType || !selectedContact || !scheduledDate || !scheduledTime) {
      toast({
        title: "Missing details",
        description: "Select the service type, contact, and schedule details.",
        variant: "destructive",
      });
      return;
    }
    if (useCustomSite && !customSiteReady) {
      toast({
        title: "Missing address",
        description: "Complete the custom address before submitting.",
        variant: "destructive",
      });
      return;
    }
    const siteAddress = useCustomSite
      ? customSite
      : selectedSite?.address || customSite;

    try {
      const created = await createBooking({
        bookingType: bookingType as BookingType,
        organization,
        contact: selectedContact,
        siteLocation: {
          id: useCustomSite ? undefined : selectedSite?.id,
          name: useCustomSite ? "Custom Location" : selectedSite?.name || "Site",
          address: siteAddress,
          isDefault: false,
        },
        scheduledDate,
        scheduledTime,
        allocatedStaff: [],
        notes: notes.trim() || undefined,
      });

      if (!created) {
        throw new Error("Unable to create booking.");
      }

      toast({
        title: "Booking requested",
        description: "Your booking has been submitted to ASI.",
      });
      setShowDialog(false);
      resetForm();
    } catch (error: any) {
      toast({
        title: "Booking failed",
        description: error.message || "Unable to create booking.",
        variant: "destructive",
      });
    }
  };

  const customSiteReady =
    customSite.street.trim() !== "" &&
    customSite.suburb.trim() !== "" &&
    customSite.postcode.trim() !== "";
  const canSubmit =
    Boolean(bookingType) &&
    Boolean(selectedContact) &&
    Boolean(scheduledDate) &&
    scheduledTime !== "" &&
    (!useCustomSite || customSiteReady);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-3xl font-headline font-bold tracking-tight">Bookings</h2>
          <p className="text-muted-foreground">
            Request new services and view your booking history.
          </p>
        </div>
        <Dialog open={showDialog} onOpenChange={(open) => {
          setShowDialog(open);
          if (!open) resetForm();
        }}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              New Booking
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Request a Booking</DialogTitle>
              <DialogDescription>
                Select a service and schedule, then ASI will confirm and allocate staff.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-5 py-2">
              <div className="space-y-2">
                <Label>Service Type *</Label>
                <Select
                  value={bookingType}
                  onValueChange={(value) => setBookingType(value as BookingType)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a service" />
                  </SelectTrigger>
                  <SelectContent>
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

              <div className="space-y-2">
                <Label>Contact Person *</Label>
                <Select
                  value={selectedContactId}
                  onValueChange={(value) => setSelectedContactId(value)}
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
                  </SelectContent>
                </Select>
                {selectedContact && (
                  <div className="text-xs text-muted-foreground space-y-1">
                    <div className="flex items-center gap-1">
                      <Mail className="h-3 w-3" />
                      {selectedContact.email}
                    </div>
                    {selectedContact.mobile && (
                      <div className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {selectedContact.mobile}
                      </div>
                    )}
                  </div>
                )}
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

              {organization?.sites?.length ? (
                <div className="space-y-3">
                  <Label className="text-sm font-semibold">Worksite</Label>
                  {organization.sites.map((site) => (
                    <Card
                      key={site.id}
                      className={cn(
                        "cursor-pointer transition-all hover:border-primary/50",
                        selectedSite?.id === site.id
                          ? "border-primary bg-primary/5"
                          : "border-border/50"
                      )}
                      onClick={() => {
                        setUseCustomSite(false);
                        setSelectedSite(site);
                      }}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="font-medium text-sm">{site.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {site.address.street}, {site.address.suburb} {site.address.state}{" "}
                              {site.address.postcode}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="custom-site"
                      checked={useCustomSite}
                      onCheckedChange={(checked) => {
                        setUseCustomSite(checked as boolean);
                        if (checked) setSelectedSite(null);
                      }}
                    />
                    <Label htmlFor="custom-site" className="cursor-pointer">
                      Use a different address
                    </Label>
                  </div>
                </div>
              ) : null}

              {useCustomSite && (
                <Card className="border-dashed">
                  <CardContent className="p-4 space-y-3">
                    <div>
                      <Label>Street Address *</Label>
                      <Input
                        value={customSite.street}
                        onChange={(e) => setCustomSite({ ...customSite, street: e.target.value })}
                        placeholder="123 Work Site Road"
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <Label>Suburb *</Label>
                        <Input
                          value={customSite.suburb}
                          onChange={(e) => setCustomSite({ ...customSite, suburb: e.target.value })}
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
                            <SelectItem value="VIC">VIC</SelectItem>
                            <SelectItem value="NSW">NSW</SelectItem>
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

              <div className="space-y-2">
                <Label>Notes (optional)</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add any instructions for ASI"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDialog(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateBooking} disabled={!canSubmit}>
                Submit Booking
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader>
          <CardTitle className="text-lg">Booking History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {clientBookings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No bookings yet. Use New Booking to request work.
            </p>
          ) : (
            <div className="space-y-3">
              {clientBookings.map((booking) => (
                <Card key={booking.id} className="bg-background/50 border-border/50">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{booking.bookingNumber}</p>
                        <p className="text-sm text-muted-foreground">
                          {BOOKING_TYPE_LABELS[booking.bookingType]}
                        </p>
                      </div>
                      <Badge variant="secondary">{statusLabels[booking.status]}</Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {format(booking.scheduledDate.toDate(), "PPP")} • {booking.scheduledTime}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Contact: {booking.contactName}
                    </div>
                    {booking.convertedJobId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => router.push(`/client/jobs/${booking.convertedJobId}`)}
                      >
                        View job card
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
