"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  MessagesSquare,
  Plus,
  RefreshCcw,
  SendHorizonal,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

type AgentAuthor = {
  type: "agent" | "user";
  name: string;
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
  tags?: string[];
  author: AgentAuthor;
  createdAt?: string | null;
  commentCount: number;
  comments: AgentCommunityComment[];
};

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
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isAdmin = user?.role === "admin";

  const loadPosts = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    setError(null);
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/agent-community/posts?limit=15", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to load feed.");
      setPosts(payload.posts || []);
      setLastRunAt(payload.lastRunAt || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load feed.");
    } finally {
      setLoading(false);
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
        body: JSON.stringify(composer),
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

  const createComment = async (postId: string) => {
    const body = commentDrafts[postId]?.trim();
    if (!firebaseUser || !body) return;
    setLoading(true);
    setError(null);
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/agent-community/comments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ postId, body }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to comment.");
      setCommentDrafts((prev) => ({ ...prev, [postId]: "" }));
      await loadPosts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to comment.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    loadPosts();
    runAgents();
    intervalRef.current = setInterval(loadPosts, 30000);
    runRef.current = setInterval(() => runAgents(), 5 * 60 * 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (runRef.current) clearInterval(runRef.current);
    };
  }, [isAdmin, loadPosts, runAgents]);

  const lastRunLabel = useMemo(() => formatRelativeTime(lastRunAt), [lastRunAt]);

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

      <div className="grid gap-6 lg:grid-cols-[1fr_0.7fr]">
        <div className="space-y-6">
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
                <span className="text-xs text-muted-foreground">
                  Agents will respond automatically to new guidance.
                </span>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            {posts.map((post) => (
              <Card key={post.id} className="bg-card/40 border-border/40">
                <CardHeader className="space-y-2">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <CardTitle className="text-base">{post.title}</CardTitle>
                      <div className="text-xs text-muted-foreground">
                        {post.author?.name} - {formatRelativeTime(post.createdAt)}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => runAgents({ postId: post.id, force: true })}
                      disabled={running}
                    >
                      Ask agents
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-foreground/90 whitespace-pre-line">{post.body}</p>

                  <div className="space-y-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                      Thread
                    </div>
                    <ScrollArea className="max-h-64 rounded-2xl border border-border/40 bg-background/60 px-4 py-3">
                      <div className="space-y-3">
                        {post.comments.length ? (
                          post.comments.map((comment) => (
                            <div key={comment.id} className="space-y-1">
                              <div className="text-xs text-muted-foreground">
                                {comment.author?.name || "Agent"} - {formatRelativeTime(comment.createdAt)}
                              </div>
                              <div className="rounded-xl bg-muted px-3 py-2 text-sm text-foreground">
                                {comment.body}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="text-xs text-muted-foreground">No responses yet.</div>
                        )}
                      </div>
                    </ScrollArea>

                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="Add a comment or direction..."
                        value={commentDrafts[post.id] || ""}
                        onChange={(event) =>
                          setCommentDrafts((prev) => ({ ...prev, [post.id]: event.target.value }))
                        }
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => createComment(post.id)}
                        disabled={loading || !(commentDrafts[post.id] || "").trim()}
                      >
                        <SendHorizonal className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}

            {posts.length === 0 && !loading && (
              <Card className="bg-card/40 border-border/40">
                <CardContent className="p-6 text-sm text-muted-foreground">
                  No community posts yet. Create a guidance post to kick-start the agents.
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        <div className="space-y-4">
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
                <ul className="mt-2 space-y-1 text-xs">
                  <li>Operations Strategist</li>
                  <li>Field Technician</li>
                  <li>Doc Manager</li>
                  <li>IMS Auditor</li>
                </ul>
              </div>
              <div className="rounded-xl border border-border/40 bg-background/60 px-3 py-2 text-xs">
                Agents run automatically every few minutes while this page is open.
              </div>
            </CardContent>
          </Card>

          {error && (
            <Card className="border border-destructive/40 bg-destructive/10">
              <CardContent className="p-4 text-xs text-destructive">{error}</CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

