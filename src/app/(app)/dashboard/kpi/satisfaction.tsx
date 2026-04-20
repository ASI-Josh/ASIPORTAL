"use client";

import { useMemo, useState } from "react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import { Plus, Star, ThumbsUp, MessageSquare, Bot } from "lucide-react";
import type { SatisfactionSurvey, ContactOrganization } from "@/lib/types";

interface SatisfactionTabProps {
  surveys: SatisfactionSurvey[];
  organizations: ContactOrganization[];
}

const SCORES = [1, 2, 3, 4, 5];

export function SatisfactionTab({ surveys, organizations }: SatisfactionTabProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);

  const [form, setForm] = useState({
    organizationId: "",
    jobNumber: "",
    submittedByName: "",
    overallSatisfaction: "5",
    serviceQuality: "5",
    communication: "5",
    timeliness: "5",
    valueForMoney: "5",
    wouldRecommend: true,
    comments: "",
    risks: "",
    opportunities: "",
  });

  const avgOverall = useMemo(() => {
    if (surveys.length === 0) return null;
    return surveys.reduce((s, r) => s + r.overallSatisfaction, 0) / surveys.length;
  }, [surveys]);

  const recommendRate = useMemo(() => {
    if (surveys.length === 0) return null;
    return (surveys.filter((s) => s.wouldRecommend).length / surveys.length) * 100;
  }, [surveys]);

  const avgByCategory = useMemo(() => {
    if (surveys.length === 0) return null;
    const sum = surveys.reduce(
      (acc, s) => ({
        serviceQuality: acc.serviceQuality + s.serviceQuality,
        communication: acc.communication + s.communication,
        timeliness: acc.timeliness + s.timeliness,
        valueForMoney: acc.valueForMoney + s.valueForMoney,
      }),
      { serviceQuality: 0, communication: 0, timeliness: 0, valueForMoney: 0 }
    );
    const n = surveys.length;
    return {
      serviceQuality: sum.serviceQuality / n,
      communication: sum.communication / n,
      timeliness: sum.timeliness / n,
      valueForMoney: sum.valueForMoney / n,
    };
  }, [surveys]);

  const handleSubmit = async () => {
    if (!form.organizationId || !form.submittedByName) {
      toast({ title: "Missing fields", description: "Organisation and submitter name are required.", variant: "destructive" });
      return;
    }

    const org = organizations.find((o) => o.id === form.organizationId);

    const survey: Omit<SatisfactionSurvey, "id"> = {
      organizationId: form.organizationId,
      organizationName: org?.name || "",
      jobNumber: form.jobNumber || undefined,
      submittedBy: user?.uid || "staff-entry",
      submittedByName: form.submittedByName,
      submittedAt: serverTimestamp() as any,
      overallSatisfaction: parseInt(form.overallSatisfaction, 10),
      serviceQuality: parseInt(form.serviceQuality, 10),
      communication: parseInt(form.communication, 10),
      timeliness: parseInt(form.timeliness, 10),
      valueForMoney: parseInt(form.valueForMoney, 10),
      wouldRecommend: form.wouldRecommend,
      comments: form.comments || undefined,
      risks: form.risks ? form.risks.split("\n").map((r) => r.trim()).filter(Boolean) : undefined,
      opportunities: form.opportunities ? form.opportunities.split("\n").map((r) => r.trim()).filter(Boolean) : undefined,
      athenaGenerated: false,
      createdAt: serverTimestamp() as any,
      updatedAt: serverTimestamp() as any,
    };

    try {
      await addDoc(collection(db, COLLECTIONS.SATISFACTION_SURVEYS), survey);
      toast({ title: "Survey recorded" });
      setDialogOpen(false);
      setForm({
        organizationId: form.organizationId,
        jobNumber: "",
        submittedByName: "",
        overallSatisfaction: "5",
        serviceQuality: "5",
        communication: "5",
        timeliness: "5",
        valueForMoney: "5",
        wouldRecommend: true,
        comments: "",
        risks: "",
        opportunities: "",
      });
    } catch (err) {
      toast({ title: "Error saving survey", description: String(err), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-amber-400">ISO 9001 Client Satisfaction</span> — capture customer feedback to drive continual improvement. Surveys submitted via Athena (client portal) are flagged and included automatically.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Avg Overall</CardTitle>
            <Star className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{avgOverall !== null ? `${avgOverall.toFixed(1)}/5` : "—"}</div>
            <p className="text-xs text-muted-foreground">{surveys.length} survey{surveys.length !== 1 ? "s" : ""} received</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Recommend</CardTitle>
            <ThumbsUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{recommendRate !== null ? `${recommendRate.toFixed(0)}%` : "—"}</div>
            <p className="text-xs text-muted-foreground">Would recommend ASI</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Service Quality</CardTitle>
            <Star className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{avgByCategory ? `${avgByCategory.serviceQuality.toFixed(1)}/5` : "—"}</div>
            <p className="text-xs text-muted-foreground">Average across surveys</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Timeliness</CardTitle>
            <Star className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{avgByCategory ? `${avgByCategory.timeliness.toFixed(1)}/5` : "—"}</div>
            <p className="text-xs text-muted-foreground">Average across surveys</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Client Satisfaction Surveys</CardTitle>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Log Survey</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Log Client Satisfaction Survey</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Organisation *</Label>
                    <Select value={form.organizationId} onValueChange={(v) => setForm({ ...form, organizationId: v })}>
                      <SelectTrigger><SelectValue placeholder="Select org" /></SelectTrigger>
                      <SelectContent>
                        {organizations.map((o) => (
                          <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Submitted By (Name) *</Label>
                    <Input value={form.submittedByName} onChange={(e) => setForm({ ...form, submittedByName: e.target.value })} placeholder="e.g. Jane Smith" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Related Job Number (optional)</Label>
                  <Input value={form.jobNumber} onChange={(e) => setForm({ ...form, jobNumber: e.target.value })} placeholder="e.g. JOB-2026-0123" />
                </div>

                <div className="border-t pt-4">
                  <p className="font-semibold text-sm mb-3">Ratings (1 = poor, 5 = excellent)</p>
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      { key: "overallSatisfaction", label: "Overall Satisfaction" },
                      { key: "serviceQuality", label: "Service Quality" },
                      { key: "communication", label: "Communication" },
                      { key: "timeliness", label: "Timeliness" },
                      { key: "valueForMoney", label: "Value for Money" },
                    ].map((field) => (
                      <div key={field.key} className="space-y-2">
                        <Label>{field.label}</Label>
                        <Select
                          value={(form as any)[field.key]}
                          onValueChange={(v) => setForm({ ...form, [field.key]: v })}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {SCORES.map((s) => (
                              <SelectItem key={s} value={String(s)}>{s} — {s === 5 ? "Excellent" : s === 4 ? "Good" : s === 3 ? "Average" : s === 2 ? "Poor" : "Very Poor"}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                    <div className="space-y-2">
                      <Label>Would Recommend?</Label>
                      <Select
                        value={form.wouldRecommend ? "yes" : "no"}
                        onValueChange={(v) => setForm({ ...form, wouldRecommend: v === "yes" })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="yes">Yes</SelectItem>
                          <SelectItem value="no">No</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Comments</Label>
                  <Textarea value={form.comments} onChange={(e) => setForm({ ...form, comments: e.target.value })} rows={3} placeholder="Free-text feedback from the client." />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Risks Raised (one per line)</Label>
                    <Textarea value={form.risks} onChange={(e) => setForm({ ...form, risks: e.target.value })} rows={2} placeholder="Items the client flagged as concerns." />
                  </div>
                  <div className="space-y-2">
                    <Label>Opportunities (one per line)</Label>
                    <Textarea value={form.opportunities} onChange={(e) => setForm({ ...form, opportunities: e.target.value })} rows={2} placeholder="Improvement ideas or expansion interest." />
                  </div>
                </div>

                <Button onClick={handleSubmit} className="w-full">Save Survey</Button>
              </div>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {surveys.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No surveys logged yet. Capture feedback post-job to drive ISO 9001 continual improvement.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Submitted</TableHead>
                    <TableHead>Organisation</TableHead>
                    <TableHead>Submitter</TableHead>
                    <TableHead className="text-right">Overall</TableHead>
                    <TableHead className="text-right">Service</TableHead>
                    <TableHead className="text-right">Comms</TableHead>
                    <TableHead className="text-right">Timely</TableHead>
                    <TableHead>Recommend</TableHead>
                    <TableHead>Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {surveys.map((s) => {
                    const submittedAt = s.submittedAt && (s.submittedAt as any).toDate
                      ? (s.submittedAt as any).toDate().toISOString().slice(0, 10)
                      : "—";
                    return (
                      <TableRow key={s.id}>
                        <TableCell className="text-xs">{submittedAt}</TableCell>
                        <TableCell>{s.organizationName}</TableCell>
                        <TableCell>{s.submittedByName}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant={s.overallSatisfaction >= 4 ? "default" : s.overallSatisfaction >= 3 ? "secondary" : "destructive"}>
                            {s.overallSatisfaction}/5
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">{s.serviceQuality}/5</TableCell>
                        <TableCell className="text-right">{s.communication}/5</TableCell>
                        <TableCell className="text-right">{s.timeliness}/5</TableCell>
                        <TableCell>
                          {s.wouldRecommend ? <Badge variant="default">Yes</Badge> : <Badge variant="destructive">No</Badge>}
                        </TableCell>
                        <TableCell>
                          {s.athenaGenerated ? (
                            <Badge variant="outline" className="gap-1"><Bot className="h-3 w-3" /> Athena</Badge>
                          ) : (
                            <Badge variant="outline">Staff</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
