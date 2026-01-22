"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Timestamp,
  addDoc,
  collection,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Plus,
  Send,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import type {
  PrestartCheck,
  PrestartChecklist,
  PrestartIssue,
  PrestartIssueCategory,
} from "@/lib/types";

const ISSUE_CATEGORIES: Array<{ value: PrestartIssueCategory; label: string }> = [
  { value: "tools", label: "Tools & equipment" },
  { value: "consumables", label: "Consumables" },
  { value: "devices", label: "Devices & charging" },
  { value: "vehicle", label: "Vehicle safety" },
  { value: "other", label: "Other" },
];

const buildLocalDateString = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().split("T")[0];
};

const buildDefaultChecklist = (): PrestartChecklist => ({
  toolsReady: false,
  toolsNotes: "",
  consumablesReady: false,
  consumablesNotes: "",
  devicesCharged: false,
  devicesNotes: "",
  vehicleSafety: {
    tyresOk: false,
    lightsOk: false,
    fluidsOk: false,
    safetyEquipmentOk: false,
    registrationOk: false,
    cabCleanOk: false,
  },
  vehicleNotes: "",
  kits: {
    crackRepairKit: false,
    scratchRemovalKit: false,
    trimRepairKit: false,
    filmInstallationKit: false,
  },
  kitNotes: "",
});

const pruneUndefined = (value: unknown): unknown => {
  if (value instanceof Timestamp) return value;
  if (Array.isArray(value)) {
    return value.map(pruneUndefined);
  }
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record)
      .filter(([, val]) => val !== undefined)
      .map(([key, val]) => [key, pruneUndefined(val)])
  );
};

type IssueDraft = {
  id: string;
  title: string;
  description: string;
  category: PrestartIssueCategory | "";
  dueDate: string;
};

export default function DailyPrestartPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const [prestartDate, setPrestartDate] = useState(buildLocalDateString);
  const [checklist, setChecklist] = useState<PrestartChecklist>(buildDefaultChecklist);
  const [issues, setIssues] = useState<IssueDraft[]>([]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [existingChecks, setExistingChecks] = useState<PrestartCheck[]>([]);

  useEffect(() => {
    if (!user) return;
    const checksQuery = query(
      collection(db, COLLECTIONS.PRESTART_CHECKS),
      where("createdById", "==", user.uid),
      where("prestartDate", "==", prestartDate)
    );
    const unsubscribe = onSnapshot(checksQuery, (snapshot) => {
      const loaded = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<PrestartCheck, "id">),
      }));
      setExistingChecks(loaded);
    });
    return () => unsubscribe();
  }, [prestartDate, user]);

  const latestCheck = useMemo(() => {
    if (existingChecks.length === 0) return null;
    return [...existingChecks].sort((a, b) => {
      const aTime = a.createdAt?.toMillis?.() ?? 0;
      const bTime = b.createdAt?.toMillis?.() ?? 0;
      return bTime - aTime;
    })[0];
  }, [existingChecks]);

  const updateChecklist = (updates: Partial<PrestartChecklist>) => {
    setChecklist((prev) => ({ ...prev, ...updates }));
  };

  const updateVehicleSafety = (key: keyof PrestartChecklist["vehicleSafety"], value: boolean) => {
    setChecklist((prev) => ({
      ...prev,
      vehicleSafety: {
        ...prev.vehicleSafety,
        [key]: value,
      },
    }));
  };

  const updateKits = (key: keyof PrestartChecklist["kits"], value: boolean) => {
    setChecklist((prev) => ({
      ...prev,
      kits: {
        ...prev.kits,
        [key]: value,
      },
    }));
  };

  const handleAddIssue = () => {
    setIssues((prev) => [
      ...prev,
      {
        id: `issue-${Date.now()}`,
        title: "",
        description: "",
        category: "",
        dueDate: "",
      },
    ]);
  };

  const updateIssue = (id: string, updates: Partial<IssueDraft>) => {
    setIssues((prev) => prev.map((issue) => (issue.id === id ? { ...issue, ...updates } : issue)));
  };

  const removeIssue = (id: string) => {
    setIssues((prev) => prev.filter((issue) => issue.id !== id));
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

  const buildIssueReport = (payload: {
    issues: PrestartIssue[];
    checklistPayload: PrestartChecklist;
    submittedBy: string;
  }) => {
    const { issues: issueList, checklistPayload, submittedBy } = payload;
    const kitLines = [
      `Crack Repair Kit: ${checklistPayload.kits.crackRepairKit ? "OK" : "Missing"}`,
      `Scratch Removal Kit: ${checklistPayload.kits.scratchRemovalKit ? "OK" : "Missing"}`,
      `Trim Repair Kit: ${checklistPayload.kits.trimRepairKit ? "OK" : "Missing"}`,
      `Film Installation Kit: ${checklistPayload.kits.filmInstallationKit ? "OK" : "Missing"}`,
    ];
    const vehicleLines = [
      `Tyres: ${checklistPayload.vehicleSafety.tyresOk ? "OK" : "Check"}`,
      `Lights: ${checklistPayload.vehicleSafety.lightsOk ? "OK" : "Check"}`,
      `Fluids: ${checklistPayload.vehicleSafety.fluidsOk ? "OK" : "Check"}`,
      `Safety equipment: ${checklistPayload.vehicleSafety.safetyEquipmentOk ? "OK" : "Check"}`,
      `Registration: ${checklistPayload.vehicleSafety.registrationOk ? "OK" : "Check"}`,
      `Cab clean: ${checklistPayload.vehicleSafety.cabCleanOk ? "OK" : "Check"}`,
    ];

    const lines = [
      "ASI Daily Prestart Issue Report",
      `Date: ${prestartDate}`,
      `Submitted by: ${submittedBy}`,
      "",
      `Tools & equipment on board: ${checklistPayload.toolsReady ? "Yes" : "No"}`,
      `Consumables ready: ${checklistPayload.consumablesReady ? "Yes" : "No"}`,
      `Devices charged: ${checklistPayload.devicesCharged ? "Yes" : "No"}`,
      "",
      "Required kits:",
      ...kitLines.map((line) => `- ${line}`),
      "",
      "Vehicle safety checks:",
      ...vehicleLines.map((line) => `- ${line}`),
      "",
      "Corrective actions identified:",
      ...issueList.map((issue, index) => {
        const due = issue.dueDate?.toDate?.().toLocaleDateString("en-AU") || "Not set";
        return `${index + 1}. ${issue.title} (${issue.status}) [Due: ${due}]\n${
          issue.description || "No details provided."
        }`;
      }),
      "",
      "Log into ASI Portal > IMS > Prestart Register to close out corrective actions.",
    ];

    return lines.join("\n");
  };

  const handleSubmit = async () => {
    if (!user) {
      toast({
        title: "Not signed in",
        description: "Please sign in again and retry.",
        variant: "destructive",
      });
      return;
    }

    const trimmedIssues = issues.filter((issue) => issue.title.trim() || issue.description.trim());
    const missingTitles = trimmedIssues.filter((issue) => !issue.title.trim());
    if (missingTitles.length > 0) {
      toast({
        title: "Issue title required",
        description: "Add a title for each corrective action before submitting.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    const now = Timestamp.now();
    const submittedBy = user.name || user.email || "User";

    const issuePayload: PrestartIssue[] = trimmedIssues.map((issue) =>
      pruneUndefined({
        id: issue.id,
        title: issue.title.trim(),
        description: issue.description.trim() || undefined,
        category: issue.category || undefined,
        status: "open",
        assignedToId: user.uid,
        assignedToName: submittedBy,
        assignedToEmail: user.email || undefined,
        dueDate: issue.dueDate ? Timestamp.fromDate(new Date(issue.dueDate)) : undefined,
        createdAt: now,
        createdById: user.uid,
        createdByName: submittedBy,
        createdByEmail: user.email || undefined,
      }) as PrestartIssue
    );

    const payload = pruneUndefined({
      prestartDate,
      status: "completed" as const,
      checklist: {
        ...checklist,
        toolsNotes: checklist.toolsNotes?.trim() || undefined,
        consumablesNotes: checklist.consumablesNotes?.trim() || undefined,
        devicesNotes: checklist.devicesNotes?.trim() || undefined,
        vehicleNotes: checklist.vehicleNotes?.trim() || undefined,
        kitNotes: checklist.kitNotes?.trim() || undefined,
      },
      issues: issuePayload,
      notes: notes.trim() || undefined,
      createdAt: now,
      updatedAt: now,
      createdById: user.uid,
      createdByName: submittedBy,
      createdByEmail: user.email || undefined,
    }) as Omit<PrestartCheck, "id">;

    try {
      const docRef = await addDoc(collection(db, COLLECTIONS.PRESTART_CHECKS), payload);

      if (issuePayload.length > 0) {
        const report = buildIssueReport({
          issues: issuePayload,
          checklistPayload: payload.checklist,
          submittedBy,
        });
        try {
          await queueEmail(
            "reports@asi-australia.com.au",
            `ASI Daily Prestart Issues - ${prestartDate} - ${submittedBy}`,
            report
          );
        } catch (error) {
          console.warn("Failed to queue prestart issue email:", error);
          toast({
            title: "Prestart saved",
            description: "Checklist saved, but email notification failed.",
            variant: "destructive",
          });
        }
      }

      toast({
        title: "Prestart submitted",
        description: "Daily prestart checklist saved to the register.",
      });
      router.push(`/dashboard/ims/prestart-register/${docRef.id}`);
    } catch (error) {
      console.error("Failed to submit prestart:", error);
      toast({
        title: "Unable to submit",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-lg bg-emerald-500/20 backdrop-blur-sm">
          <ClipboardCheck className="h-8 w-8 text-emerald-400" />
        </div>
        <div>
          <h1 className="text-3xl font-bold">Daily Prestart Check</h1>
          <p className="text-muted-foreground">
            ISO 9001-aligned checklist to confirm readiness and capture corrective actions.
          </p>
        </div>
      </div>

      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardContent className="p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
            <div>
              <p className="font-medium">Prestart date</p>
              <p className="text-sm text-muted-foreground">
                One checklist per day recommended for traceability.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Input
              type="date"
              value={prestartDate}
              onChange={(event) => setPrestartDate(event.target.value)}
              className="max-w-[160px]"
            />
            {latestCheck ? (
              <Button
                variant="outline"
                onClick={() => router.push(`/dashboard/ims/prestart-register/${latestCheck.id}`)}
              >
                View latest
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {existingChecks.length > 0 ? (
        <Card className="bg-amber-500/10 border-amber-500/30">
          <CardContent className="p-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-medium">Prestart already logged</p>
              <p className="text-sm text-muted-foreground">
                {existingChecks.length} check{existingChecks.length !== 1 && "s"} logged for this
                date.
              </p>
            </div>
            {latestCheck ? (
              <Button
                variant="outline"
                onClick={() => router.push(`/dashboard/ims/prestart-register/${latestCheck.id}`)}
              >
                Review entry
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader>
          <CardTitle>Core readiness</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <input
                id="tools-ready"
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={checklist.toolsReady}
                onChange={(event) => updateChecklist({ toolsReady: event.target.checked })}
              />
              <Label htmlFor="tools-ready" className="font-normal">
                Tools and equipment on board
              </Label>
            </div>
            <Textarea
              value={checklist.toolsNotes || ""}
              onChange={(event) => updateChecklist({ toolsNotes: event.target.value })}
              placeholder="Missing tools or notes (optional)"
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <input
                id="consumables-ready"
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={checklist.consumablesReady}
                onChange={(event) => updateChecklist({ consumablesReady: event.target.checked })}
              />
              <Label htmlFor="consumables-ready" className="font-normal">
                All consumables required for today
              </Label>
            </div>
            <Textarea
              value={checklist.consumablesNotes || ""}
              onChange={(event) => updateChecklist({ consumablesNotes: event.target.value })}
              placeholder="Consumables to top up (optional)"
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <input
                id="devices-ready"
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={checklist.devicesCharged}
                onChange={(event) => updateChecklist({ devicesCharged: event.target.checked })}
              />
              <Label htmlFor="devices-ready" className="font-normal">
                Portable devices/tools charged
              </Label>
            </div>
            <Textarea
              value={checklist.devicesNotes || ""}
              onChange={(event) => updateChecklist({ devicesNotes: event.target.value })}
              placeholder="Charging or device notes (optional)"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader>
          <CardTitle>Tooling required for today&apos;s scope</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="flex items-center gap-3">
            <input
              id="kit-crack"
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={checklist.kits.crackRepairKit}
              onChange={(event) => updateKits("crackRepairKit", event.target.checked)}
            />
            <Label htmlFor="kit-crack" className="font-normal">
              Crack Repair Kit
            </Label>
          </div>
          <div className="flex items-center gap-3">
            <input
              id="kit-scratch"
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={checklist.kits.scratchRemovalKit}
              onChange={(event) => updateKits("scratchRemovalKit", event.target.checked)}
            />
            <Label htmlFor="kit-scratch" className="font-normal">
              Scratch Removal Kit
            </Label>
          </div>
          <div className="flex items-center gap-3">
            <input
              id="kit-trim"
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={checklist.kits.trimRepairKit}
              onChange={(event) => updateKits("trimRepairKit", event.target.checked)}
            />
            <Label htmlFor="kit-trim" className="font-normal">
              Trim Repair Kit
            </Label>
          </div>
          <div className="flex items-center gap-3">
            <input
              id="kit-film"
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={checklist.kits.filmInstallationKit}
              onChange={(event) => updateKits("filmInstallationKit", event.target.checked)}
            />
            <Label htmlFor="kit-film" className="font-normal">
              Film Installation Kit
            </Label>
          </div>
          <div className="md:col-span-2">
            <Textarea
              value={checklist.kitNotes || ""}
              onChange={(event) => updateChecklist({ kitNotes: event.target.value })}
              placeholder="Kit readiness notes (optional)"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader>
          <CardTitle>Quick vehicle safety inspection</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="flex items-center gap-3">
            <input
              id="vehicle-tyres"
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={checklist.vehicleSafety.tyresOk}
              onChange={(event) => updateVehicleSafety("tyresOk", event.target.checked)}
            />
            <Label htmlFor="vehicle-tyres" className="font-normal">
              Tyres & pressure
            </Label>
          </div>
          <div className="flex items-center gap-3">
            <input
              id="vehicle-lights"
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={checklist.vehicleSafety.lightsOk}
              onChange={(event) => updateVehicleSafety("lightsOk", event.target.checked)}
            />
            <Label htmlFor="vehicle-lights" className="font-normal">
              Lights & indicators
            </Label>
          </div>
          <div className="flex items-center gap-3">
            <input
              id="vehicle-fluids"
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={checklist.vehicleSafety.fluidsOk}
              onChange={(event) => updateVehicleSafety("fluidsOk", event.target.checked)}
            />
            <Label htmlFor="vehicle-fluids" className="font-normal">
              Fluids & leaks
            </Label>
          </div>
          <div className="flex items-center gap-3">
            <input
              id="vehicle-safety"
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={checklist.vehicleSafety.safetyEquipmentOk}
              onChange={(event) => updateVehicleSafety("safetyEquipmentOk", event.target.checked)}
            />
            <Label htmlFor="vehicle-safety" className="font-normal">
              Safety equipment & first aid
            </Label>
          </div>
          <div className="flex items-center gap-3">
            <input
              id="vehicle-registration"
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={checklist.vehicleSafety.registrationOk}
              onChange={(event) => updateVehicleSafety("registrationOk", event.target.checked)}
            />
            <Label htmlFor="vehicle-registration" className="font-normal">
              Registration & compliance stickers
            </Label>
          </div>
          <div className="flex items-center gap-3">
            <input
              id="vehicle-cab"
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={checklist.vehicleSafety.cabCleanOk}
              onChange={(event) => updateVehicleSafety("cabCleanOk", event.target.checked)}
            />
            <Label htmlFor="vehicle-cab" className="font-normal">
              Cab clean & secure load
            </Label>
          </div>
          <div className="md:col-span-2">
            <Textarea
              value={checklist.vehicleNotes || ""}
              onChange={(event) => updateChecklist({ vehicleNotes: event.target.value })}
              placeholder="Vehicle safety notes (optional)"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Issues & corrective actions</CardTitle>
          <Button variant="outline" size="sm" onClick={handleAddIssue}>
            <Plus className="mr-2 h-4 w-4" />
            Add issue
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {issues.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No issues logged. Add a corrective action if anything needs follow-up.
            </div>
          ) : (
            issues.map((issue) => (
              <Card key={issue.id} className="bg-background/60 border-border/40">
                <CardContent className="grid gap-4 p-4 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <Label>Issue title *</Label>
                    <Input
                      value={issue.title}
                      onChange={(event) => updateIssue(issue.id, { title: event.target.value })}
                      placeholder="Describe the issue"
                    />
                  </div>
                  <div>
                    <Label>Category</Label>
                    <Select
                      value={issue.category}
                      onValueChange={(value) =>
                        updateIssue(issue.id, { category: value as PrestartIssueCategory })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {ISSUE_CATEGORIES.map((category) => (
                          <SelectItem key={category.value} value={category.value}>
                            {category.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Target close-out date</Label>
                    <Input
                      type="date"
                      value={issue.dueDate}
                      onChange={(event) => updateIssue(issue.id, { dueDate: event.target.value })}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Label>Details</Label>
                    <Textarea
                      value={issue.description}
                      onChange={(event) =>
                        updateIssue(issue.id, { description: event.target.value })
                      }
                      placeholder="Add details or immediate action taken."
                    />
                  </div>
                  <div className="md:col-span-2 flex justify-end">
                    <Button
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => removeIssue(issue.id)}
                    >
                      Remove issue
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader>
          <CardTitle>Additional notes</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Optional notes for the day"
          />
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Button onClick={handleSubmit} disabled={saving}>
          {saving ? (
            "Submitting..."
          ) : (
            <>
              <Send className="mr-2 h-4 w-4" />
              Submit prestart
            </>
          )}
        </Button>
        <Button variant="outline" onClick={() => setChecklist(buildDefaultChecklist())}>
          <CheckCircle2 className="mr-2 h-4 w-4" />
          Reset checklist
        </Button>
      </div>
    </div>
  );
}
