"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, FileUp, SendHorizonal, Sparkles } from "lucide-react";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { storage } from "@/lib/firebaseClient";
import { cn } from "@/lib/utils";

type KnowledgeMessage = {
  id: string;
  role: "user" | "agent";
  agentId?: string | null;
  agentName?: string | null;
  content: string;
  warnings?: string[];
  createdAt?: string | null;
  actionRequestIds?: string[];
};

type KnowledgeDoc = {
  id: string;
  title: string;
  fileName: string;
  summary?: string;
  sourceUrl?: string | null;
  downloadUrl?: string | null;
  createdAt?: string | null;
};

type ActionItem = {
  id: string;
  status: string;
  actionType: string;
  summary: string;
  payload: Record<string, unknown>;
  requestedBy?: { agentId?: string; agentName?: string; userId?: string; name?: string };
  createdAt?: string | null;
  execution?: { error?: string; output?: unknown };
};

const AGENTS = [
  { id: "knowledge_admin", label: "Operations Strategist" },
  { id: "knowledge_tech", label: "Field Technician" },
  { id: "doc_manager", label: "Doc Manager" },
  { id: "ims_auditor", label: "IMS Auditor" },
];

export default function KnowledgeHubPage() {
  const { user, firebaseUser } = useAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState<KnowledgeMessage[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [input, setInput] = useState("");
  const [meetingNotes, setMeetingNotes] = useState("");
  const [intent, setIntent] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedAgents, setSelectedAgents] = useState<string[]>(
    AGENTS.map((agent) => agent.id)
  );
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [selectedActions, setSelectedActions] = useState<string[]>([]);
  const [newAction, setNewAction] = useState({
    actionType: "moltbook.register",
    summary: "",
    title: "",
    body: "",
    postId: "",
    reaction: "",
    name: "",
    description: "",
    website: "",
  });
  const [linkForm, setLinkForm] = useState({ title: "", url: "", summary: "" });

  const isAdmin = user?.role === "admin";

  const loadMessages = useCallback(async () => {
    if (!firebaseUser) return;
    const token = await firebaseUser.getIdToken();
    const response = await fetch("/api/agent-hub/messages", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json();
    if (response.ok) {
      setMessages(payload.messages || []);
    }
  }, [firebaseUser]);

  const loadActions = useCallback(async () => {
    if (!firebaseUser) return;
    const token = await firebaseUser.getIdToken();
    const response = await fetch("/api/agent-hub/actions", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json();
    if (response.ok) {
      setActions(payload.actions || []);
    }
  }, [firebaseUser]);

  const loadDocs = useCallback(async () => {
    if (!firebaseUser) return;
    const token = await firebaseUser.getIdToken();
    const response = await fetch("/api/agent-hub/docs", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json();
    if (response.ok) {
      setDocs(payload.docs || []);
    }
  }, [firebaseUser]);

  useEffect(() => {
    if (!isAdmin) return;
    loadMessages();
    loadActions();
    loadDocs();
  }, [isAdmin, loadMessages, loadActions, loadDocs]);

  const sendMessage = async () => {
    if (!firebaseUser || !input.trim()) return;
    setLoading(true);
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/agent-hub/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: input.trim(),
          agents: selectedAgents,
          docIds: selectedDocs,
          meetingNotes: meetingNotes.trim(),
          intent: intent.trim(),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to run Knowledge Hub.");
      setInput("");
      await loadMessages();
      await loadActions();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to run Knowledge Hub.";
      toast({ title: "Knowledge Hub error", description: message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (file: File | null) => {
    if (!file || !firebaseUser) return;
    setUploading(true);
    try {
      const docId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`;
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `agent-hub/${docId}/${safeName}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file, { contentType: file.type });
      const downloadUrl = await getDownloadURL(storageRef);

      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/agent-hub/docs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type,
          size: file.size,
          storagePath: path,
          downloadUrl,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to save document.");
      await loadDocs();
      toast({ title: "Document added", description: "Knowledge Hub document indexed." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed.";
      toast({ title: "Upload failed", description: message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const addLinkSource = async () => {
    if (!firebaseUser || !linkForm.url.trim()) return;
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/agent-hub/docs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          fileName: linkForm.title.trim() || linkForm.url.trim(),
          title: linkForm.title.trim() || linkForm.url.trim(),
          sourceUrl: linkForm.url.trim(),
          summary: linkForm.summary.trim(),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to add link.");
      setLinkForm({ title: "", url: "", summary: "" });
      await loadDocs();
      toast({ title: "Link added", description: "Source added to Knowledge Hub." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to add link.";
      toast({ title: "Link failed", description: message, variant: "destructive" });
    }
  };

  const toggleAgent = (agentId: string) => {
    setSelectedAgents((prev) =>
      prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]
    );
  };

  const toggleDoc = (docId: string) => {
    setSelectedDocs((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]
    );
  };

  const toggleAction = (actionId: string) => {
    setSelectedActions((prev) =>
      prev.includes(actionId) ? prev.filter((id) => id !== actionId) : [...prev, actionId]
    );
  };

  const handleActionDecision = async (decision: "approve" | "reject") => {
    if (!firebaseUser || selectedActions.length === 0) return;
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/agent-hub/actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          operation: decision,
          actionIds: selectedActions,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to update actions.");
      setSelectedActions([]);
      await loadActions();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update actions.";
      toast({ title: "Action update failed", description: message, variant: "destructive" });
    }
  };

  const createManualAction = async () => {
    if (!firebaseUser || !newAction.summary.trim()) return;
    const actionPayload: Record<string, unknown> = {};
    if (newAction.actionType === "moltbook.register") {
      actionPayload.name = newAction.name;
      actionPayload.description = newAction.description;
      actionPayload.website = newAction.website;
    }
    if (newAction.actionType === "moltbook.post") {
      actionPayload.title = newAction.title;
      actionPayload.body = newAction.body;
    }
    if (newAction.actionType === "moltbook.comment") {
      actionPayload.postId = newAction.postId;
      actionPayload.body = newAction.body;
    }
    if (newAction.actionType === "moltbook.react") {
      actionPayload.postId = newAction.postId;
      actionPayload.reaction = newAction.reaction;
    }

    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/agent-hub/actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          operation: "create",
          actionType: newAction.actionType,
          summary: newAction.summary.trim(),
          actionPayload,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to create action.");
      setNewAction((prev) => ({ ...prev, summary: "", title: "", body: "", postId: "", reaction: "" }));
      await loadActions();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create action.";
      toast({ title: "Action create failed", description: message, variant: "destructive" });
    }
  };

  const pendingActions = useMemo(
    () => actions.filter((action) => action.status === "pending"),
    [actions]
  );
  const recentActions = useMemo(
    () => actions.filter((action) => action.status !== "pending").slice(0, 6),
    [actions]
  );

  if (!isAdmin) {
    return (
      <Card className="bg-card/50 backdrop-blur">
        <CardContent className="p-6 text-muted-foreground">
          Knowledge Hub is restricted to ASI administrators.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl border border-primary/20 bg-primary/10 p-3">
            <Bot className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-semibold">Knowledge Hub</h1>
            <p className="text-sm text-muted-foreground">
              Group chat with all agents, shared context vault, and action approvals.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="bg-card/50 backdrop-blur border-border/40">
          <CardHeader>
            <CardTitle className="text-base">Agent roundtable</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Agents in this round</Label>
                <div className="space-y-2">
                  {AGENTS.map((agent) => (
                    <label key={agent.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox
                        checked={selectedAgents.includes(agent.id)}
                        onCheckedChange={() => toggleAgent(agent.id)}
                      />
                      {agent.label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Context intent (optional)</Label>
                <Input
                  placeholder="e.g. leadership planning, audit preparation"
                  value={intent}
                  onChange={(event) => setIntent(event.target.value)}
                />
                <Label className="pt-2">Meeting notes (optional)</Label>
                <Textarea
                  rows={4}
                  value={meetingNotes}
                  onChange={(event) => setMeetingNotes(event.target.value)}
                />
              </div>
            </div>

            <div className="rounded-2xl border border-border/40 bg-background/60">
              <ScrollArea className="h-80 px-4 py-3">
                <div className="space-y-3">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={cn(
                        "flex",
                        message.role === "user" ? "justify-end" : "justify-start"
                      )}
                    >
                      <div
                        className={cn(
                          "max-w-[80%] whitespace-pre-line rounded-2xl px-4 py-2 text-sm",
                          message.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground"
                        )}
                      >
                        {message.role === "agent" && (
                          <div className="mb-1 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                            {message.agentName || "Agent"} ({message.agentId || "ai"})
                          </div>
                        )}
                        {message.content}
                        {message.warnings && message.warnings.length > 0 && (
                          <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200">
                            {message.warnings.map((warning) => (
                              <div key={warning}>- {warning}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {loading && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Sparkles className="h-3 w-3 animate-pulse" />
                      Agents are collaborating...
                    </div>
                  )}
                </div>
              </ScrollArea>
              <div className="flex items-center gap-2 border-t border-border/40 px-3 py-2">
                <Input
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Ask the agents to work together..."
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      sendMessage();
                    }
                  }}
                />
                <Button onClick={sendMessage} disabled={loading}>
                  <SendHorizonal className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="bg-card/50 backdrop-blur border-border/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileUp className="h-4 w-4 text-primary" />
                Context vault
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <div className="grid gap-2">
                <Label>Upload knowledge document</Label>
                <Input
                  type="file"
                  accept=".pdf,.doc,.docx,.txt,.md"
                  onChange={(event) => handleUpload(event.target.files?.[0] || null)}
                  disabled={uploading}
                />
                <span className="text-xs text-muted-foreground">
                  Supported: PDF, DOCX, TXT, MD. Files are indexed for agent context.
                </span>
              </div>

              <div className="grid gap-2">
                <Label>Add external link</Label>
                <Input
                  placeholder="Title"
                  value={linkForm.title}
                  onChange={(event) => setLinkForm((prev) => ({ ...prev, title: event.target.value }))}
                />
                <Input
                  placeholder="https://..."
                  value={linkForm.url}
                  onChange={(event) => setLinkForm((prev) => ({ ...prev, url: event.target.value }))}
                />
                <Textarea
                  rows={2}
                  placeholder="Short summary for agents"
                  value={linkForm.summary}
                  onChange={(event) => setLinkForm((prev) => ({ ...prev, summary: event.target.value }))}
                />
                <Button variant="outline" size="sm" onClick={addLinkSource}>
                  Add link source
                </Button>
              </div>

              <div className="space-y-2">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Available sources
                </div>
                <div className="space-y-2">
                  {docs.map((doc) => (
                    <label
                      key={doc.id}
                      className="flex items-start gap-2 rounded-xl border border-border/40 bg-background/60 px-3 py-2 text-xs"
                    >
                      <Checkbox
                        checked={selectedDocs.includes(doc.id)}
                        onCheckedChange={() => toggleDoc(doc.id)}
                      />
                      <div>
                        <div className="font-semibold text-foreground">{doc.title}</div>
                        {doc.summary && <div className="text-muted-foreground">{doc.summary}</div>}
                        <div className="flex flex-wrap gap-2 pt-1 text-[11px] text-muted-foreground">
                          {doc.downloadUrl && (
                            <a
                              href={doc.downloadUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="underline"
                            >
                              Download
                            </a>
                          )}
                          {doc.sourceUrl && (
                            <a href={doc.sourceUrl} target="_blank" rel="noreferrer" className="underline">
                              Source
                            </a>
                          )}
                        </div>
                      </div>
                    </label>
                  ))}
                  {docs.length === 0 && (
                    <div className="text-xs text-muted-foreground">No documents uploaded yet.</div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/50 backdrop-blur border-border/40">
            <CardHeader>
              <CardTitle className="text-base">Action approvals</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <div className="space-y-2">
                {pendingActions.length === 0 && (
                  <div className="text-xs text-muted-foreground">No pending actions.</div>
                )}
                {pendingActions.map((action) => (
                  <label
                    key={action.id}
                    className="flex items-start gap-2 rounded-xl border border-border/40 bg-background/60 px-3 py-2 text-xs"
                  >
                    <Checkbox
                      checked={selectedActions.includes(action.id)}
                      onCheckedChange={() => toggleAction(action.id)}
                    />
                    <div>
                      <div className="font-semibold text-foreground">{action.summary}</div>
                      <div className="text-muted-foreground">
                        {action.actionType} · {action.requestedBy?.agentName || action.requestedBy?.name || "Agent"}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => handleActionDecision("approve")} disabled={selectedActions.length === 0}>
                  Approve selected
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleActionDecision("reject")}
                  disabled={selectedActions.length === 0}
                >
                  Reject selected
                </Button>
              </div>

              <div className="space-y-2">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">New action</div>
                <div className="grid gap-2">
                  <Label>Action type</Label>
                  <select
                    className="rounded-md border border-border/40 bg-background px-3 py-2 text-sm"
                    value={newAction.actionType}
                    onChange={(event) =>
                      setNewAction((prev) => ({ ...prev, actionType: event.target.value }))
                    }
                  >
                    <option value="moltbook.register">Moltbook - Register agent</option>
                    <option value="moltbook.post">Moltbook - Create post</option>
                    <option value="moltbook.comment">Moltbook - Comment</option>
                    <option value="moltbook.react">Moltbook - React</option>
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label>Summary</Label>
                  <Input
                    value={newAction.summary}
                    onChange={(event) => setNewAction((prev) => ({ ...prev, summary: event.target.value }))}
                    placeholder="Short action summary"
                  />
                </div>
                {newAction.actionType === "moltbook.register" && (
                  <div className="grid gap-2">
                    <Input
                      placeholder="Agent name"
                      value={newAction.name}
                      onChange={(event) => setNewAction((prev) => ({ ...prev, name: event.target.value }))}
                    />
                    <Textarea
                      rows={2}
                      placeholder="Description"
                      value={newAction.description}
                      onChange={(event) => setNewAction((prev) => ({ ...prev, description: event.target.value }))}
                    />
                    <Input
                      placeholder="Website (optional)"
                      value={newAction.website}
                      onChange={(event) => setNewAction((prev) => ({ ...prev, website: event.target.value }))}
                    />
                  </div>
                )}
                {newAction.actionType === "moltbook.post" && (
                  <div className="grid gap-2">
                    <Input
                      placeholder="Post title"
                      value={newAction.title}
                      onChange={(event) => setNewAction((prev) => ({ ...prev, title: event.target.value }))}
                    />
                    <Textarea
                      rows={3}
                      placeholder="Post body"
                      value={newAction.body}
                      onChange={(event) => setNewAction((prev) => ({ ...prev, body: event.target.value }))}
                    />
                  </div>
                )}
                {newAction.actionType === "moltbook.comment" && (
                  <div className="grid gap-2">
                    <Input
                      placeholder="Post ID"
                      value={newAction.postId}
                      onChange={(event) => setNewAction((prev) => ({ ...prev, postId: event.target.value }))}
                    />
                    <Textarea
                      rows={2}
                      placeholder="Comment body"
                      value={newAction.body}
                      onChange={(event) => setNewAction((prev) => ({ ...prev, body: event.target.value }))}
                    />
                  </div>
                )}
                {newAction.actionType === "moltbook.react" && (
                  <div className="grid gap-2">
                    <Input
                      placeholder="Post ID"
                      value={newAction.postId}
                      onChange={(event) => setNewAction((prev) => ({ ...prev, postId: event.target.value }))}
                    />
                    <Input
                      placeholder="Reaction (e.g. like)"
                      value={newAction.reaction}
                      onChange={(event) => setNewAction((prev) => ({ ...prev, reaction: event.target.value }))}
                    />
                  </div>
                )}
                <Button variant="outline" size="sm" onClick={createManualAction}>
                  Create action request
                </Button>
              </div>

              <div className="space-y-2">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Recent actions</div>
                {recentActions.length === 0 && (
                  <div className="text-xs text-muted-foreground">No executed actions yet.</div>
                )}
                {recentActions.map((action) => (
                  <div key={`recent-${action.id}`} className="rounded-xl border border-border/40 bg-background/60 px-3 py-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-foreground">{action.summary}</span>
                      <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                        {action.status}
                      </span>
                    </div>
                    {action.execution?.error && (
                      <div className="mt-1 text-[11px] text-destructive">{action.execution.error}</div>
                    )}
                    {action.execution?.output && (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {JSON.stringify(action.execution.output).slice(0, 220)}...
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
