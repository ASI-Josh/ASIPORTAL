"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, MessagesSquare, SendHorizonal, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/contexts/AuthContext";
import { extractMentions } from "@/lib/mentions";




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

export default function AgentCommunityThreadPage() {
  const { user, firebaseUser } = useAuth();
  const params = useParams<{ id: string }>();
  const [post, setPost] = useState<AgentCommunityPost | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");

  const isAdmin = user?.role === "admin";

  const loadPost = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    setError(null);
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch(`/api/agent-community/posts/${params.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to load post.");
      setPost(payload.post || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load post.");
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, params.id]);

  const runAgents = useCallback(
    async (topic?: string) => {
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
          body: JSON.stringify({ postId: params.id, force: true, ...(topic ? { topic } : {}) }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to run agents.");
        await loadPost();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to run agents.");
      } finally {
        setRunning(false);
      }
    },
    [firebaseUser, loadPost, params.id]
  );

  const createComment = async () => {
    const body = comment.trim();
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
        body: JSON.stringify({ postId: params.id, body }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to comment.");
      setComment("");
      await loadPost();
      if (extractMentions(body).length > 0) {
        await runAgents(body);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to comment.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    loadPost();
  }, [isAdmin, loadPost]);

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
            <h1 className="text-3xl font-semibold">Thread View</h1>
            <p className="text-sm text-muted-foreground">Focused discussion with full replies.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href="/dashboard/agent-community">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to community
            </Link>
          </Button>
          <Button onClick={() => runAgents()} disabled={running}>
            <Sparkles className="mr-2 h-4 w-4" />
            Ask agents
          </Button>
        </div>
      </div>

      <Card className="bg-card/40 border-border/40">
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-xl">{post?.title || "Loading..."}</CardTitle>
            <Badge variant="outline">
              {post?.category === "awareness" ? "Awareness" : "ASI / Professional"}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground">
            {post?.author?.name || "-"}
            {post?.author?.roleTitle ? ` - ${post.author.roleTitle}` : ""} -{" "}
            {formatRelativeTime(post?.createdAt)}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-foreground/90 whitespace-pre-line">{post?.body}</p>

          <div className="space-y-3">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Thread</div>
            <ScrollArea className="h-[420px] rounded-2xl border border-border/40 bg-background/60 px-4 py-3">
              <div className="space-y-3">
                {post?.comments?.length ? (
                  post.comments.map((reply) => (
                    <div key={reply.id} className="space-y-1">
                      <div className="text-xs text-muted-foreground">
                        {reply.author?.name || "Agent"}
                        {reply.author?.roleTitle ? ` - ${reply.author.roleTitle}` : ""} -{" "}
                        {formatRelativeTime(reply.createdAt)}
                      </div>
                      <div className="rounded-xl bg-muted px-3 py-2 text-sm text-foreground">
                        {reply.body}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-muted-foreground">No responses yet.</div>
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="flex items-center gap-2">
            <Input
              placeholder="Add a comment or direction..."
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
            <Button
              variant="outline"
              size="icon"
              onClick={createComment}
              disabled={loading || !comment.trim()}
            >
              <SendHorizonal className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="border border-destructive/40 bg-destructive/10">
          <CardContent className="p-4 text-xs text-destructive">{error}</CardContent>
        </Card>
      )}
    </div>
  );
}
