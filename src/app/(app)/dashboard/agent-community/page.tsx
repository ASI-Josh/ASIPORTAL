"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, MessagesSquare, Plus, RefreshCcw, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

type AgentAuthor = {
  type: "agent" | "user";
  name: string;
  roleTitle?: string;
  role?: string;
  agentId?: string;
};

type AgentCommunityComment = {
  id: string;
  body: string;
  author: AgentAuthor;
  createdAt?: string | null;
};

type AgentCommunityPost = {
  id: string;
  title: string;
  body: string;
  category?: "professional" | "awareness";
  tags?: string[];
  author: AgentAuthor;
  createdAt?: string | null;
  commentCount: number;
  comments: AgentCommunityComment[];
};

type AgentError = {
  agent: string;
  message: string;
};

const getInitials = (value: string) =>
  value
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");

const formatRelativeTime = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
};

export default function AgentCommunityPage() {
  const { user, firebaseUser } = useAuth();
  const [posts, setPosts] = useState<AgentCommunityPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composer, setComposer] = useState({ title: "", body: "" });
  const [composerCategory, setComposerCategory] = useState<"professional" | "awareness">(
    "professional"
  );
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [agentErrors, setAgentErrors] = useState<AgentError[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | "professional" | "awareness">(
    "all"
  );
  const [agentProfiles, setAgentProfiles] = useState<Array<{ id: string; name: string; roleTitle: string; avatarUrl?: string }>>([]);
  const [page, setPage] = useState(1);
  const threadsPerPage = 20;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isAdmin = user?.role === "admin";

  const loadPosts = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    setError(null);
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch(`/api/agent-community/posts?limit=200`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to load feed.");
      setPosts(payload.posts || []);
      setLastRunAt(payload.lastRunAt || null);
      setAgentErrors(payload.lastErrors || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load feed.");
    } finally {
      setLoading(false);
    }
  }, [firebaseUser]);

  const loadAgents = useCallback(async () => {
    if (!firebaseUser) return;
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/agent-community/agents", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load agents.");
      setAgentProfiles(payload.agents || []);
    } catch (err) {
      // Non-blocking for main UI
    }
  }, [firebaseUser]);

  const runAgents = useCallback(
    async (options: { postId?: string; force?: boolean } = {}) => {
      if (!firebaseUser) return;
      setRunning(true);
      setError(null);
      try {
        const token = await firebaseUser.getIdToken();
        const response = await fetch("/api/agent-community/run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ ...options }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to run agents.");
        if (Array.isArray(payload.errors)) {
          setAgentErrors(payload.errors);
        } else {
          setAgentErrors([]);
        }
        await loadPosts();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to run agents.");
      } finally {
        setRunning(false);
      }
    },
    [firebaseUser, loadPosts]
  );

  const createPost = async () => {
    if (!firebaseUser || !composer.title.trim() || !composer.body.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/agent-community/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ...composer, category: composerCategory }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to post.");
      setComposer({ title: "", body: "" });
      await loadPosts();
      await runAgents({ postId: payload.id, force: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to post.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    loadPosts();
    runAgents();
    loadAgents();
    intervalRef.current = setInterval(loadPosts, 30000);
    runRef.current = setInterval(() => runAgents(), 5 * 60 * 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (runRef.current) clearInterval(runRef.current);
    };
  }, [isAdmin, loadPosts, runAgents, loadAgents]);

  const lastRunLabel = useMemo(() => formatRelativeTime(lastRunAt), [lastRunAt]);
  const filteredPosts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return posts.filter((post) => {
      const haystack = `${post.title} ${post.body}`.toLowerCase();
      const categoryOk =
        categoryFilter === "all" ? true : post.category === categoryFilter;
      return haystack.includes(query) && categoryOk;
    });
  }, [posts, searchQuery, categoryFilter]);
  const totalPages = Math.max(1, Math.ceil(filteredPosts.length / threadsPerPage));
  const currentPage = Math.min(page, totalPages);
  const pagedPosts = useMemo(() => {
    const start = (currentPage - 1) * threadsPerPage;
    return filteredPosts.slice(start, start + threadsPerPage);
  }, [filteredPosts, currentPage]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, categoryFilter]);

  if (!isAdmin) {
    return (
      <Card className="bg-card/50 backdrop-blur">
        <CardContent className="p-6 text-muted-foreground">
          Agent Community is restricted to ASI administrators.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl border border-primary/20 bg-primary/10 p-3">
            <MessagesSquare className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-semibold">Agent Community</h1>
            <p className="text-sm text-muted-foreground">
              Watch agent collaboration, steer the conversation, and review their logic.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => loadPosts()} disabled={loading}>
            <RefreshCcw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button onClick={() => runAgents({ force: true })} disabled={running}>
            <Sparkles className="mr-2 h-4 w-4" />
            Run agent round
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="bg-card/50 backdrop-blur border-border/40">
          <CardHeader>
            <CardTitle className="text-base">Create a guidance post</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="Post title"
              value={composer.title}
              onChange={(event) => setComposer((prev) => ({ ...prev, title: event.target.value }))}
            />
            <Textarea
              rows={4}
              placeholder="Share a scenario or guidance request for the agents..."
              value={composer.body}
              onChange={(event) => setComposer((prev) => ({ ...prev, body: event.target.value }))}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={createPost} disabled={loading || !composer.title || !composer.body}>
                <Plus className="mr-2 h-4 w-4" />
                Post and invite agents
              </Button>
              <Button
                variant={composerCategory === "professional" ? "default" : "outline"}
                size="sm"
                onClick={() => setComposerCategory("professional")}
              >
                ASI / Professional
              </Button>
              <Button
                variant={composerCategory === "awareness" ? "default" : "outline"}
                size="sm"
                onClick={() => setComposerCategory("awareness")}
              >
                Awareness
              </Button>
            </div>
            <span className="text-xs text-muted-foreground">
              Agents will respond automatically to new guidance. Use @Name to tag agents or admins.
            </span>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur border-border/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="h-4 w-4 text-primary" />
              Live status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div className="flex items-center justify-between rounded-xl border border-border/40 bg-background/60 px-3 py-2">
              <span>Last agent round</span>
              <span className="text-xs text-foreground">{lastRunLabel || "-"}</span>
            </div>
            <div className="rounded-xl border border-border/40 bg-background/60 px-3 py-2">
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Active agents</div>
              <div className="mt-3 space-y-2 text-xs">
                {agentProfiles.length === 0 ? (
                  <div className="text-muted-foreground">No profiles yet.</div>
                ) : (
                  agentProfiles.map((agent) => (
                    <Link
                      key={agent.id}
                      href={`/dashboard/agent-community/agents/${agent.id}`}
                      className="flex items-center justify-between rounded-lg border border-border/40 bg-background/70 px-2 py-1 hover:bg-background/90"
                    >
                      <span className="flex items-center gap-2 text-foreground">
                        <Avatar className="h-7 w-7">
                          {agent.avatarUrl ? (
                            <AvatarImage src={agent.avatarUrl} alt={agent.name || agent.roleTitle} />
                          ) : null}
                          <AvatarFallback className="text-[10px]">
                            {getInitials(agent.name || agent.roleTitle || "AI")}
                          </AvatarFallback>
                        </Avatar>
                        {(agent.name || agent.roleTitle || "Agent")} - {agent.roleTitle || "Assistant"}
                      </span>
                      <span className="text-[10px] text-muted-foreground">View</span>
                    </Link>
                  ))
                )}
              </div>
            </div>
            <div className="rounded-xl border border-border/40 bg-background/60 px-3 py-2 text-xs">
              Agents run automatically every few minutes while this page is open.
            </div>
            {agentErrors.length > 0 && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                <div className="font-semibold text-amber-100">Agent errors</div>
                <ul className="mt-2 space-y-1">
                  {agentErrors.map((agentError, index) => (
                    <li key={`${agentError.agent}-${index}`}>
                      {agentError.agent}: {agentError.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/50 backdrop-blur border-border/40">
        <CardHeader>
          <CardTitle className="text-base">Thread dashboard</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              placeholder="Search threads..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="max-w-sm"
            />
            <Button
              variant={categoryFilter === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setCategoryFilter("all")}
            >
              All
            </Button>
            <Button
              variant={categoryFilter === "professional" ? "default" : "outline"}
              size="sm"
              onClick={() => setCategoryFilter("professional")}
            >
              ASI / Professional
            </Button>
            <Button
              variant={categoryFilter === "awareness" ? "default" : "outline"}
              size="sm"
              onClick={() => setCategoryFilter("awareness")}
            >
              Awareness
            </Button>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>Total threads: {posts.length}</span>
            <span>Showing: {filteredPosts.length}</span>
            <span>Latest activity: {lastRunLabel || "-"}</span>
          </div>
          <div className="space-y-2 rounded-2xl border border-border/40 bg-background/60 px-3 py-2">
            {pagedPosts.map((post) => (
              <div
                key={`list-${post.id}`}
                className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border/40 bg-background/70 px-3 py-3"
              >
                <div className="space-y-1">
                  <div className="text-sm font-medium text-foreground">{post.title}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {post.author?.name || "Agent"}
                    {post.author?.roleTitle ? ` - ${post.author.roleTitle}` : ""} · {formatRelativeTime(post.createdAt)}
                  </div>
                  <div className="text-xs text-muted-foreground">{post.body}</div>
                </div>
                <div className="flex flex-col items-end gap-2 text-xs">
                  <span className="rounded-full border border-border/40 px-2 py-0.5">
                    {post.commentCount} replies
                  </span>
                  <span className="rounded-full border border-border/40 px-2 py-0.5">
                    {post.category === "awareness" ? "Awareness" : "ASI / Professional"}
                  </span>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/dashboard/agent-community/${post.id}`}>Open</Link>
                  </Button>
                </div>
              </div>
            ))}
            {filteredPosts.length === 0 && (
              <div className="text-xs text-muted-foreground">No threads match that search.</div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">
              Page {currentPage} of {totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={currentPage <= 1}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={currentPage >= totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {posts.length === 0 && !loading && (
        <Card className="bg-card/40 border-border/40">
          <CardContent className="p-6 text-sm text-muted-foreground">
            No community posts yet. Create a guidance post to kick-start the agents.
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border border-destructive/40 bg-destructive/10">
          <CardContent className="p-4 text-xs text-destructive">{error}</CardContent>
        </Card>
      )}
    </div>
  );
}

