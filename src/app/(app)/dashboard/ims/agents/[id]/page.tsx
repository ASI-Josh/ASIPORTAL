"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { DocumentReference } from "firebase/firestore";
import { Timestamp, doc, onSnapshot, updateDoc } from "firebase/firestore";
import { ArrowLeft, Bot, Save, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
  AutomationAgent,
  AutomationAgentStatus,
  AutomationAgentType,
} from "@/lib/types";

const STATUS_OPTIONS: AutomationAgentStatus[] = ["draft", "active", "paused", "retired"];
const TYPE_OPTIONS: Array<{ value: AutomationAgentType; label: string }> = [
  { value: "workflow", label: "Workflow" },
  { value: "assistant", label: "Assistant" },
  { value: "api", label: "API" },
];

const statusBadge = (status: AutomationAgentStatus) => {
  switch (status) {
    case "active":
      return "bg-green-500/20 text-green-400 border-green-500/30";
    case "paused":
      return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    case "retired":
      return "bg-red-500/20 text-red-400 border-red-500/30";
    default:
      return "bg-muted text-muted-foreground";
  }
};

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

export default function AgentRegistryDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const agentId = params.id as string;

  const [agent, setAgent] = useState<AutomationAgent | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    type: "workflow" as AutomationAgentType,
    status: "draft" as AutomationAgentStatus,
    purpose: "",
    model: "",
    workflowId: "",
    assistantId: "",
    endpoint: "",
    capabilities: "",
    notes: "",
  });

  useEffect(() => {
    const agentRef = doc(db, COLLECTIONS.AUTOMATION_AGENTS, agentId);
    const unsubscribe = onSnapshot(
      agentRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setAgent(null);
          return;
        }
        const data = snapshot.data() as Omit<AutomationAgent, "id">;
        setAgent({ id: snapshot.id, ...data });
      },
      () => setAgent(null)
    );
    return () => unsubscribe();
  }, [agentId]);

  useEffect(() => {
    if (!agent) return;
    setForm({
      name: agent.name,
      type: agent.type,
      status: agent.status,
      purpose: agent.purpose || "",
      model: agent.model || "",
      workflowId: agent.workflowId || "",
      assistantId: agent.assistantId || "",
      endpoint: agent.endpoint || "",
      capabilities: agent.capabilities?.join(", ") || "",
      notes: agent.notes || "",
    });
  }, [agent]);

  const handleSave = async () => {
    if (!agent) return;
    if (!user || user.role !== "admin") return;
    if (!form.name.trim()) {
      toast({
        title: "Missing name",
        description: "Agent name is required.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const now = Timestamp.now();
      const capabilities = form.capabilities
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const payload = pruneUndefined({
        name: form.name.trim(),
        type: form.type,
        status: form.status,
        purpose: form.purpose.trim() || undefined,
        model: form.model.trim() || undefined,
        workflowId: form.workflowId.trim() || undefined,
        assistantId: form.assistantId.trim() || undefined,
        endpoint: form.endpoint.trim() || undefined,
        capabilities: capabilities.length > 0 ? capabilities : undefined,
        notes: form.notes.trim() || undefined,
        updatedAt: now,
      }) as Partial<AutomationAgent>;
      const agentRef = doc(
        db,
        COLLECTIONS.AUTOMATION_AGENTS,
        agent.id
      ) as DocumentReference<AutomationAgent>;
      await updateDoc(agentRef, payload);
      toast({
        title: "Agent updated",
        description: "Registry details saved.",
      });
    } catch (error) {
      console.error("Failed to update agent:", error);
      toast({
        title: "Update failed",
        description: "Unable to save changes.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!user || user.role !== "admin") {
    return (
      <Card className="bg-card/50 backdrop-blur">
        <CardContent className="p-6 text-muted-foreground flex items-center gap-3">
          <ShieldAlert className="h-4 w-4 text-primary" />
          Agent Registry is restricted to ASI administrators.
        </CardContent>
      </Card>
    );
  }

  if (!agent) {
    return (
      <div className="space-y-4">
        <Button variant="outline" onClick={() => router.push("/dashboard/ims/agents")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to registry
        </Button>
        <div className="text-muted-foreground">Agent not found.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-lg bg-sky-500/20 backdrop-blur-sm">
            <Bot className="h-8 w-8 text-sky-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">{agent.name}</h1>
            <p className="text-muted-foreground">
              {agent.purpose || "Automation agent"}
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={() => router.push("/dashboard/ims/agents")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to registry
        </Button>
      </div>

      <Card className="bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle>Agent profile</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2 md:col-span-2">
            <Label>Name</Label>
            <Input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <Label>Type</Label>
            <Select
              value={form.type}
              onValueChange={(value) =>
                setForm((prev) => ({ ...prev, type: value as AutomationAgentType }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Status</Label>
            <Select
              value={form.status}
              onValueChange={(value) =>
                setForm((prev) => ({ ...prev, status: value as AutomationAgentStatus }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2 md:col-span-2">
            <Label>Purpose</Label>
            <Textarea
              value={form.purpose}
              onChange={(event) => setForm((prev) => ({ ...prev, purpose: event.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <Label>Model</Label>
            <Input
              value={form.model}
              onChange={(event) => setForm((prev) => ({ ...prev, model: event.target.value }))}
              placeholder="e.g., gpt-5.2"
            />
          </div>
          <div className="grid gap-2">
            <Label>Workflow ID</Label>
            <Input
              value={form.workflowId}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, workflowId: event.target.value }))
              }
            />
          </div>
          <div className="grid gap-2">
            <Label>Assistant ID</Label>
            <Input
              value={form.assistantId}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, assistantId: event.target.value }))
              }
            />
          </div>
          <div className="grid gap-2">
            <Label>Endpoint</Label>
            <Input
              value={form.endpoint}
              onChange={(event) => setForm((prev) => ({ ...prev, endpoint: event.target.value }))}
              placeholder="Optional API endpoint"
            />
          </div>
          <div className="grid gap-2 md:col-span-2">
            <Label>Capabilities (comma-separated)</Label>
            <Input
              value={form.capabilities}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, capabilities: event.target.value }))
              }
            />
          </div>
          <div className="grid gap-2 md:col-span-2">
            <Label>Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
            />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button onClick={handleSave} disabled={saving}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? "Saving..." : "Save agent"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle>Registry status</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="outline" className={statusBadge(agent.status)}>
            {agent.status}
          </Badge>
          <span>Owner: {agent.owner?.name || "Unassigned"}</span>
        </CardContent>
      </Card>
    </div>
  );
}
