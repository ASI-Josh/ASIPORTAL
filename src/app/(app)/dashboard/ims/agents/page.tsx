"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Timestamp,
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { Bot, Plus, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import type { AutomationAgent, AutomationAgentStatus, AutomationAgentType } from "@/lib/types";

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

export default function AgentRegistryPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const [agents, setAgents] = useState<AutomationAgent[]>([]);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newAgent, setNewAgent] = useState({
    name: "",
    type: "workflow" as AutomationAgentType,
    status: "draft" as AutomationAgentStatus,
    purpose: "",
  });

  useEffect(() => {
    if (!user || user.role !== "admin") return;
    const agentsQuery = query(
      collection(db, COLLECTIONS.AUTOMATION_AGENTS),
      orderBy("name", "asc")
    );
    const unsubscribe = onSnapshot(agentsQuery, (snapshot) => {
      const loaded = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<AutomationAgent, "id">),
      }));
      setAgents(loaded);
    });
    return () => unsubscribe();
  }, [user]);

  const stats = useMemo(() => {
    const total = agents.length;
    const active = agents.filter((agent) => agent.status === "active").length;
    const paused = agents.filter((agent) => agent.status === "paused").length;
    const retired = agents.filter((agent) => agent.status === "retired").length;
    return { total, active, paused, retired };
  }, [agents]);

  const handleCreateAgent = async () => {
    if (!user || user.role !== "admin") return;
    if (!newAgent.name.trim()) {
      toast({
        title: "Missing name",
        description: "Enter an agent name.",
        variant: "destructive",
      });
      return;
    }

    setCreating(true);
    try {
      const now = Timestamp.now();
      const payload: Omit<AutomationAgent, "id"> = {
        name: newAgent.name.trim(),
        type: newAgent.type,
        status: newAgent.status,
        purpose: newAgent.purpose.trim() || undefined,
        owner: {
          id: user.uid,
          name: user.name || user.email || "Admin",
          email: user.email || undefined,
        },
        createdAt: now,
        updatedAt: now,
        createdById: user.uid,
        createdByName: user.name || user.email || "Admin",
        createdByEmail: user.email || undefined,
      };
      const docRef = await addDoc(collection(db, COLLECTIONS.AUTOMATION_AGENTS), payload);
      setShowCreateDialog(false);
      setNewAgent({ name: "", type: "workflow", status: "draft", purpose: "" });
      router.push(`/dashboard/ims/agents/${docRef.id}`);
    } catch (error) {
      console.error("Failed to create agent:", error);
      toast({
        title: "Unable to create",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-lg bg-sky-500/20 backdrop-blur-sm">
            <Bot className="h-8 w-8 text-sky-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Agent Registry</h1>
            <p className="text-muted-foreground">
              Track AI automation workflows, ownership, and operational status.
            </p>
          </div>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New agent
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-card/50 backdrop-blur">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-xs text-muted-foreground">Total agents</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-green-400">{stats.active}</div>
            <p className="text-xs text-muted-foreground">Active</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-amber-400">{stats.paused}</div>
            <p className="text-xs text-muted-foreground">Paused</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-red-400">{stats.retired}</div>
            <p className="text-xs text-muted-foreground">Retired</p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle>Registry</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {agents.length === 0 ? (
            <div className="text-sm text-muted-foreground">No agents registered yet.</div>
          ) : (
            agents.map((agent) => (
              <div
                key={agent.id}
                className="flex flex-col gap-2 rounded-lg border border-border/40 bg-background/60 p-3 md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <div className="font-medium text-primary">{agent.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {agent.purpose || "No purpose set"}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="outline" className={statusBadge(agent.status)}>
                    {agent.status}
                  </Badge>
                  <span>{agent.type}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => router.push(`/dashboard/ims/agents/${agent.id}`)}
                  >
                    Manage
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New automation agent</DialogTitle>
            <DialogDescription>
              Register a workflow or assistant so it can be managed and tracked.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Agent name</Label>
              <Input
                value={newAgent.name}
                onChange={(event) =>
                  setNewAgent((prev) => ({ ...prev, name: event.target.value }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label>Type</Label>
              <Select
                value={newAgent.type}
                onValueChange={(value) =>
                  setNewAgent((prev) => ({ ...prev, type: value as AutomationAgentType }))
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
                value={newAgent.status}
                onValueChange={(value) =>
                  setNewAgent((prev) => ({ ...prev, status: value as AutomationAgentStatus }))
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
            <div className="grid gap-2">
              <Label>Purpose (optional)</Label>
              <Textarea
                value={newAgent.purpose}
                onChange={(event) =>
                  setNewAgent((prev) => ({ ...prev, purpose: event.target.value }))
                }
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateAgent} disabled={creating}>
              {creating ? "Creating..." : "Create agent"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
