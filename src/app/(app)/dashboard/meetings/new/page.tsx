"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  collection,
  doc,
  setDoc,
  getDocs,
  query,
  orderBy,
  where,
  Timestamp,
  limit as firestoreLimit,
} from "firebase/firestore";
import { Plus, Trash2, GripVertical } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import type {
  Meeting,
  MeetingTemplate,
  MeetingType,
  AgendaItem,
  MeetingAttendee,
} from "@/lib/types";
import { useToast } from "@/hooks/use-toast";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const agendaItemSchema = z.object({
  title: z.string().min(1, "Title is required"),
  type: z.enum([
    "discussion",
    "decision",
    "information",
    "agent_report",
    "action_review",
  ]),
  presenter: z.string().optional(),
  duration: z.coerce.number().min(1).optional(),
});

const meetingFormSchema = z.object({
  title: z.string().min(1, "Meeting title is required"),
  meetingType: z.enum([
    "management_review",
    "startup",
    "whs_committee",
    "department",
    "project",
    "incident_review",
    "custom",
  ]),
  scheduledDate: z.string().min(1, "Date is required"),
  scheduledDuration: z.coerce.number().min(1, "Duration must be at least 1 minute"),
  location: z.string().optional(),
  templateId: z.string().optional(),
  agendaItems: z.array(agendaItemSchema),
});

type MeetingFormValues = z.infer<typeof meetingFormSchema>;

const MEETING_TYPE_LABELS: Record<MeetingType, string> = {
  management_review: "Management Review",
  startup: "Startup Meeting",
  whs_committee: "WHS Committee",
  department: "Department Meeting",
  project: "Project Meeting",
  incident_review: "Incident Review",
  custom: "Custom",
};

const AGENDA_TYPE_LABELS: Record<AgendaItem["type"], string> = {
  discussion: "Discussion",
  decision: "Decision",
  information: "Information",
  agent_report: "Agent Report",
  action_review: "Action Review",
};

export default function NewMeetingPage() {
  const router = useRouter();
  const { user, firebaseUser } = useAuth();
  const { toast } = useToast();
  const [templates, setTemplates] = useState<MeetingTemplate[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<MeetingFormValues>({
    resolver: zodResolver(meetingFormSchema),
    defaultValues: {
      title: "",
      meetingType: "management_review",
      scheduledDate: "",
      scheduledDuration: 60,
      location: "",
      templateId: "",
      agendaItems: [],
    },
  });

  const { fields, append, remove, move } = useFieldArray({
    control,
    name: "agendaItems",
  });

  const selectedTemplateId = watch("templateId");

  // Load templates
  useEffect(() => {
    async function loadTemplates() {
      try {
        const snap = await getDocs(
          query(
            collection(db, COLLECTIONS.MEETING_TEMPLATES),
            orderBy("name", "asc")
          )
        );
        const loaded = snap.docs.map(
          (d) => ({ id: d.id, ...d.data() } as MeetingTemplate)
        );
        setTemplates(loaded);
      } catch (err) {
        console.error("Failed to load templates:", err);
      }
    }
    loadTemplates();
  }, []);

  // Populate agenda from template
  const applyTemplate = useCallback(
    (templateId: string) => {
      const template = templates.find((t) => t.id === templateId);
      if (!template) return;

      // Set meeting type and duration from template
      setValue("meetingType", template.meetingType);
      setValue("scheduledDuration", template.defaultDuration);

      // Replace agenda items with template agenda
      // Clear existing items first
      while (fields.length > 0) {
        remove(0);
      }
      template.agendaTemplate.forEach((item) => {
        append({
          title: item.title,
          type: item.type,
          presenter: item.presenter || "",
          duration: item.duration || undefined,
        });
      });
    },
    [templates, setValue, fields.length, remove, append]
  );

  useEffect(() => {
    if (selectedTemplateId && selectedTemplateId !== "") {
      applyTemplate(selectedTemplateId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplateId]);

  async function generateMeetingNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `MTG-${year}-`;

    try {
      const snap = await getDocs(
        query(
          collection(db, COLLECTIONS.MEETINGS),
          where("meetingNumber", ">=", prefix),
          where("meetingNumber", "<=", prefix + "\uf8ff"),
          orderBy("meetingNumber", "desc"),
          firestoreLimit(1)
        )
      );

      if (!snap.empty) {
        const latest = snap.docs[0].data().meetingNumber as string;
        const seq = parseInt(latest.split("-").pop() || "0", 10);
        return `${prefix}${String(seq + 1).padStart(3, "0")}`;
      }
    } catch (err) {
      console.error("Error querying meeting numbers:", err);
    }

    return `${prefix}001`;
  }

  async function onSubmit(data: MeetingFormValues) {
    if (!user) return;
    setSubmitting(true);

    try {
      const meetingNumber = await generateMeetingNumber();
      const meetingRef = doc(collection(db, COLLECTIONS.MEETINGS));
      const now = Timestamp.now();

      const agendaItems: AgendaItem[] = data.agendaItems.map((item, idx) => ({
        id: `agenda-${idx + 1}`,
        order: idx + 1,
        title: item.title,
        type: item.type,
        presenter: item.presenter || undefined,
        duration: item.duration || undefined,
        status: "pending" as const,
      }));

      const userName = user.name || user.email || "Unknown";

      const chairAttendee: MeetingAttendee = {
        id: user.uid,
        name: userName,
        email: user.email || undefined,
        role: "chair",
        attended: false,
      };

      const meeting: Omit<Meeting, "id"> = {
        meetingNumber,
        title: data.title,
        meetingType: data.meetingType,
        status: "scheduled",
        scheduledDate: Timestamp.fromDate(new Date(data.scheduledDate)),
        scheduledDuration: data.scheduledDuration,
        location: data.location || undefined,
        chair: {
          id: user.uid,
          name: userName,
          email: user.email || "",
        },
        attendees: [chairAttendee],
        agendaItems,
        decisions: [],
        templateId: data.templateId || undefined,
        createdAt: now,
        createdBy: user.uid,
        createdByName: userName,
        updatedAt: now,
      };

      await setDoc(meetingRef, { id: meetingRef.id, ...meeting });

      // Try to add to Google Calendar (non-blocking)
      try {
        if (firebaseUser) {
          const token = await firebaseUser.getIdToken();
          const startDate = new Date(data.scheduledDate);
          const endDate = new Date(startDate.getTime() + data.scheduledDuration * 60000);
          await fetch("/api/google/calendar/create-event", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              summary: data.title,
              start: startDate.toISOString(),
              end: endDate.toISOString(),
              location: data.location || undefined,
            }),
          });
        }
      } catch {
        // Calendar sync is best-effort
      }

      toast({
        title: "Meeting Created",
        description: `${meetingNumber} — ${data.title}`,
      });

      router.push(`/dashboard/meetings/${meetingRef.id}`);
    } catch (err) {
      console.error("Failed to create meeting:", err);
      toast({
        title: "Error",
        description: "Failed to create meeting. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-heading tracking-tight">
          New Meeting
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Schedule a new meeting and build the agenda.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Meeting Details */}
        <Card className="border-border/40 bg-card/60 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-lg">Meeting Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                placeholder="e.g. Q1 Management Review"
                {...register("title")}
              />
              {errors.title && (
                <p className="text-sm text-destructive">
                  {errors.title.message}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Meeting Type */}
              <div className="space-y-2">
                <Label>Meeting Type *</Label>
                <Select
                  defaultValue="management_review"
                  onValueChange={(val) =>
                    setValue("meetingType", val as MeetingType)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(MEETING_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.meetingType && (
                  <p className="text-sm text-destructive">
                    {errors.meetingType.message}
                  </p>
                )}
              </div>

              {/* Template */}
              <div className="space-y-2">
                <Label>Template (optional)</Label>
                <Select
                  onValueChange={(val) => setValue("templateId", val)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a template" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Scheduled Date */}
              <div className="space-y-2">
                <Label htmlFor="scheduledDate">Date &amp; Time *</Label>
                <Input
                  id="scheduledDate"
                  type="datetime-local"
                  {...register("scheduledDate")}
                />
                {errors.scheduledDate && (
                  <p className="text-sm text-destructive">
                    {errors.scheduledDate.message}
                  </p>
                )}
              </div>

              {/* Duration */}
              <div className="space-y-2">
                <Label htmlFor="scheduledDuration">Duration (minutes) *</Label>
                <Input
                  id="scheduledDuration"
                  type="number"
                  min={1}
                  {...register("scheduledDuration")}
                />
                {errors.scheduledDuration && (
                  <p className="text-sm text-destructive">
                    {errors.scheduledDuration.message}
                  </p>
                )}
              </div>

              {/* Location */}
              <div className="space-y-2">
                <Label htmlFor="location">Location</Label>
                <Input
                  id="location"
                  placeholder="e.g. Board Room / Teams"
                  {...register("location")}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Agenda Builder */}
        <Card className="border-border/40 bg-card/60 backdrop-blur">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Agenda</CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                append({
                  title: "",
                  type: "discussion",
                  presenter: "",
                  duration: undefined,
                })
              }
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Agenda Item
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {fields.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">
                No agenda items yet. Add items manually or select a template
                above.
              </p>
            )}

            {fields.map((field, index) => (
              <div
                key={field.id}
                className="flex items-start gap-3 p-3 rounded-lg border border-border/40 bg-background/40"
              >
                <div className="flex items-center pt-2 text-muted-foreground cursor-grab">
                  <GripVertical className="h-4 w-4" />
                </div>

                <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-3">
                  {/* Title */}
                  <div className="md:col-span-5 space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Title
                    </Label>
                    <Input
                      placeholder="Agenda item title"
                      {...register(`agendaItems.${index}.title`)}
                    />
                    {errors.agendaItems?.[index]?.title && (
                      <p className="text-xs text-destructive">
                        {errors.agendaItems[index]?.title?.message}
                      </p>
                    )}
                  </div>

                  {/* Type */}
                  <div className="md:col-span-3 space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Type
                    </Label>
                    <Select
                      defaultValue={field.type || "discussion"}
                      onValueChange={(val) =>
                        setValue(
                          `agendaItems.${index}.type` as const,
                          val as AgendaItem["type"]
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(AGENDA_TYPE_LABELS).map(
                          ([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Presenter */}
                  <div className="md:col-span-2 space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Presenter
                    </Label>
                    <Input
                      placeholder="Name"
                      {...register(`agendaItems.${index}.presenter`)}
                    />
                  </div>

                  {/* Duration */}
                  <div className="md:col-span-2 space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Min
                    </Label>
                    <Input
                      type="number"
                      min={1}
                      placeholder="min"
                      {...register(`agendaItems.${index}.duration`)}
                    />
                  </div>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive/80 mt-6"
                  onClick={() => remove(index)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/dashboard/meetings")}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating..." : "Create Meeting"}
          </Button>
        </div>
      </form>
    </div>
  );
}
