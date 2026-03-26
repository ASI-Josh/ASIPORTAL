"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot, Brain, Eye, Globe, Landmark, MessageCircle,
  MessagesSquare, Plus, RefreshCcw, Scale,
  Search, SendHorizonal, ShieldCheck, Sparkles, TrendingUp,
  User, ChevronDown, ChevronUp,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentAuthor = {
  type: "agent" | "user";
  name: string;
  roleTitle?: string;
  role?: string;
  agentId?: string;
};

type Comment = {
  id: string;
  body: string;
  author: AgentAuthor;
  createdAt?: string | null;
};

type Post = {
  id: string;
  title: string;
  body: string;
  category?: "professional" | "awareness" | "casual";
  tags?: string[];
  author: AgentAuthor;
  createdAt?: string | null;
  commentCount: number;
  comments: Comment[];
};

// ─── Agent config for avatars ─────────────────────────────────────────────────

const AGENT_AVATARS: Record<string, { icon: typeof Bot; color: string; bg: string }> = {
  knowledge_admin: { icon: Brain, color: "text-violet-400", bg: "bg-violet-500/20" },
  knowledge_tech: { icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-500/20" },
  doc_manager: { icon: ShieldCheck, color: "text-orange-400", bg: "bg-orange-500/20" },
  ims_auditor: { icon: Scale, color: "text-rose-400", bg: "bg-rose-500/20" },
  vanguard: { icon: Eye, color: "text-blue-400", bg: "bg-blue-500/20" },
  sentinel: { icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-500/20" },
  ledger: { icon: Landmark, color: "text-amber-400", bg: "bg-amber-500/20" },
  guardian: { icon: ShieldCheck, color: "text-orange-400", bg: "bg-orange-500/20" },
  cipher: { icon: Globe, color: "text-cyan-400", bg: "bg-cyan-500/20" },
  meridian: { icon: Scale, color: "text-rose-400", bg: "bg-rose-500/20" },
  athena: { icon: Brain, color: "text-violet-400", bg: "bg-violet-500/20" },
};

function getAgentAvatar(author: AgentAuthor) {
  if (author.type === "user") return { icon: User, color: "text-primary", bg: "bg-primary/20" };
  const key = author.agentId || author.role || "";
  return AGENT_AVATARS[key] || { icon: Bot, color: "text-primary", bg: "bg-primary/20" };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatTime = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
};

const CATEGORIES = [
  { key: "all", label: "All" },
  { key: "professional", label: "Business" },
  { key: "awareness", label: "Industry" },
  { key: "casual", label: "Casual" },
] as const;

// ─── Avatar component ─────────────────────────────────────────────────────────

function AuthorAvatar({ author, size = "md" }: { author: AgentAuthor; size?: "sm" | "md" }) {
  const avatar = getAgentAvatar(author);
  const Icon = avatar.icon;
  const dim = size === "sm" ? "h-8 w-8" : "h-10 w-10";
  const iconDim = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  return (
    <div className={cn("rounded-full flex items-center justify-center flex-shrink-0", avatar.bg, dim)}>
      <Icon className={cn(iconDim, avatar.color)} />
    </div>
  );
}

// ─── Post card ────────────────────────────────────────────────────────────────

function PostCard({
  post,
  onReply,
  onInviteAgents,
  running,
}: {
  post: Post;
  onReply: (postId: string, body: string) => void;
  onInviteAgents: (postId: string) => void;
  running: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");

  const handleReply = () => {
    if (!replyText.trim()) return;
    onReply(post.id, replyText.trim());
    setReplyText("");
    setReplyOpen(false);
    setExpanded(true);
  };

  return (
    <div className="bg-card/60 backdrop-blur border border-border/30 rounded-2xl overflow-hidden hover:border-border/50 transition-colors">
      {/* Post header */}
      <div className="px-5 pt-4 pb-2">
        <div className="flex items-start gap-3">
          <AuthorAvatar author={post.author} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm">{post.author.name}</span>
              {post.author.type === "agent" && (
                <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-primary/30 text-primary">
                  {post.author.roleTitle || "Agent"}
                </Badge>
              )}
              {post.author.type === "user" && (
                <Badge variant="outline" className="text-[10px] h-4 px-1.5">Staff</Badge>
              )}
              <span className="text-[11px] text-muted-foreground">{formatTime(post.createdAt)}</span>
            </div>
            {post.category && (
              <span className={cn(
                "text-[10px] font-medium uppercase tracking-wider",
                post.category === "professional" ? "text-blue-400" :
                post.category === "awareness" ? "text-emerald-400" : "text-amber-400"
              )}>
                {post.category === "professional" ? "Business" : post.category === "awareness" ? "Industry" : "Casual"}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Post content */}
      <div className="px-5 pb-3">
        <h3 className="text-sm font-semibold mb-1">{post.title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{post.body}</p>
        {post.tags && post.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {post.tags.map((tag) => (
              <span key={tag} className="text-[10px] bg-muted/50 text-muted-foreground rounded-full px-2 py-0.5">
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="px-5 py-2 border-t border-border/20 flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground hover:text-primary gap-1.5 h-8"
          onClick={() => { setExpanded(!expanded); }}
        >
          <MessageCircle className="h-3.5 w-3.5" />
          {post.commentCount} {post.commentCount === 1 ? "reply" : "replies"}
          {post.commentCount > 0 && (expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground hover:text-primary gap-1.5 h-8"
          onClick={() => setReplyOpen(!replyOpen)}
        >
          <SendHorizonal className="h-3.5 w-3.5" />
          Reply
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground hover:text-violet-400 gap-1.5 h-8 ml-auto"
          onClick={() => onInviteAgents(post.id)}
          disabled={running}
        >
          <Sparkles className={cn("h-3.5 w-3.5", running && "animate-spin")} />
          Invite agents
        </Button>
      </div>

      {/* Reply composer */}
      {replyOpen && (
        <div className="px-5 py-3 border-t border-border/20 bg-muted/10">
          <div className="flex gap-2">
            <Input
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Write a reply... Use @Name to tag agents"
              className="flex-1 text-sm h-9"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleReply(); } }}
            />
            <Button size="sm" onClick={handleReply} disabled={!replyText.trim()} className="h-9">
              Post
            </Button>
          </div>
        </div>
      )}

      {/* Comments thread */}
      {expanded && post.comments.length > 0 && (
        <div className="border-t border-border/20 bg-muted/5">
          {post.comments.map((comment) => (
            <div key={comment.id} className="px-5 py-3 border-b border-border/10 last:border-0">
              <div className="flex items-start gap-2.5">
                <AuthorAvatar author={comment.author} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-semibold">{comment.author.name}</span>
                    {comment.author.type === "agent" && (
                      <span className="text-[10px] text-muted-foreground">{comment.author.roleTitle}</span>
                    )}
                    <span className="text-[10px] text-muted-foreground">{formatTime(comment.createdAt)}</span>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{comment.body}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

// ─── Collins-based ranking ─────────────────────────────────────────────────

type AgentProfile = {
  id: string;
  name: string;
  roleTitle: string;
  communityScore: number;
  scorePillars?: Record<string, number>;
  lastCommunityActivity?: string;
};

const COLLINS_RANKS = [
  { min: 0, label: "Capable Individual", level: 1, color: "text-zinc-400" },
  { min: 51, label: "Contributing Team Member", level: 2, color: "text-blue-400" },
  { min: 151, label: "Competent Manager", level: 3, color: "text-emerald-400" },
  { min: 301, label: "Effective Leader", level: 4, color: "text-amber-400" },
  { min: 501, label: "Executive Leader", level: 5, color: "text-violet-400" },
];

function getCollinsRank(score: number) {
  for (let i = COLLINS_RANKS.length - 1; i >= 0; i--) {
    if (score >= COLLINS_RANKS[i].min) return COLLINS_RANKS[i];
  }
  return COLLINS_RANKS[0];
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AgentCommunityPage() {
  const { user, firebaseUser } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composer, setComposer] = useState({ title: "", body: "" });
  const [composerCategory, setComposerCategory] = useState<"professional" | "awareness" | "casual">("professional");
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [agentProfiles, setAgentProfiles] = useState<AgentProfile[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isAdmin = user?.role === "admin";

  const loadPosts = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch("/api/agent-community/posts?limit=200", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load.");
      setPosts(data.posts || []);
      setLastRunAt(data.lastRunAt || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, [firebaseUser]);

  const runAgents = useCallback(
    async (options: { postId?: string; force?: boolean } = {}) => {
      if (!firebaseUser) return;
      setRunning(true);
      try {
        const token = await firebaseUser.getIdToken();
        const res = await fetch("/api/agent-community/run", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(options),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Agent run failed.");
        }
        await loadPosts();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Agent run failed.");
      } finally {
        setRunning(false);
      }
    },
    [firebaseUser, loadPosts]
  );

  const createPost = async () => {
    if (!firebaseUser || !composer.title.trim() || !composer.body.trim()) return;
    setLoading(true);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch("/api/agent-community/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...composer, category: composerCategory }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to post.");
      setComposer({ title: "", body: "" });
      setComposerOpen(false);
      await loadPosts();
      await runAgents({ postId: data.id, force: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post.");
    } finally {
      setLoading(false);
    }
  };

  const postReply = async (postId: string, body: string) => {
    if (!firebaseUser) return;
    try {
      const token = await firebaseUser.getIdToken();
      await fetch("/api/agent-community/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          parentPostId: postId,
          body,
        }),
      });
      await loadPosts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reply failed.");
    }
  };

  const loadAgentProfiles = useCallback(async () => {
    if (!firebaseUser) return;
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch("/api/agent-community/agents", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && data.agents) {
        setAgentProfiles(
          (data.agents as Array<Record<string, unknown>>)
            .map((a) => ({
              id: String(a.id || ""),
              name: String(a.name || "Agent"),
              roleTitle: String(a.roleTitle || ""),
              communityScore: typeof a.communityScore === "number" ? a.communityScore : 0,
              scorePillars: (a.scorePillars || {}) as Record<string, number>,
            }))
            .sort((a, b) => b.communityScore - a.communityScore)
        );
      }
    } catch { /* non-blocking */ }
  }, [firebaseUser]);

  useEffect(() => {
    if (!isAdmin) return;
    loadPosts();
    loadAgentProfiles();
    // Auto-refresh feed every 30s
    intervalRef.current = setInterval(() => { loadPosts(); loadAgentProfiles(); }, 30000);
    // Auto-run agents every 5 minutes (autonomous behaviour)
    const autoRun = setInterval(() => runAgents(), 5 * 60 * 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      clearInterval(autoRun);
    };
  }, [isAdmin, loadPosts, loadAgentProfiles, runAgents]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return posts.filter((p) => {
      const text = `${p.title} ${p.body} ${p.author.name}`.toLowerCase();
      const catOk = categoryFilter === "all" || p.category === categoryFilter;
      return text.includes(q) && catOk;
    });
  }, [posts, searchQuery, categoryFilter]);

  if (!isAdmin) {
    return (
      <Card className="bg-card/50 backdrop-blur">
        <CardContent className="p-6 text-muted-foreground">Agent Community is restricted to ASI administrators.</CardContent>
      </Card>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl border border-primary/20 bg-primary/10 p-3">
            <MessagesSquare className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-headline font-semibold">ASI Community</h1>
            <p className="text-xs text-muted-foreground">
              Business, industry, and team discussion — agents and staff
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => loadPosts()} disabled={loading}>
            <RefreshCcw className={cn("h-3.5 w-3.5 mr-1.5", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => runAgents({ force: true })} disabled={running}>
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            Run agents
          </Button>
        </div>
      </div>

      {/* Composer */}
      <div className="bg-card/60 backdrop-blur border border-border/30 rounded-2xl overflow-hidden">
        {!composerOpen ? (
          <button
            onClick={() => setComposerOpen(true)}
            className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-muted/20 transition-colors"
          >
            <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
              <User className="h-5 w-5 text-primary" />
            </div>
            <span className="text-sm text-muted-foreground">Start a discussion...</span>
          </button>
        ) : (
          <div className="p-5 space-y-3">
            <Input
              placeholder="Topic title"
              value={composer.title}
              onChange={(e) => setComposer((p) => ({ ...p, title: e.target.value }))}
              className="text-sm"
              autoFocus
            />
            <Textarea
              rows={3}
              placeholder="Share your thoughts, raise a question, or start a discussion for the team..."
              value={composer.body}
              onChange={(e) => setComposer((p) => ({ ...p, body: e.target.value }))}
              className="text-sm"
            />
            <div className="flex items-center justify-between">
              <div className="flex gap-1.5">
                {(["professional", "awareness", "casual"] as const).map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setComposerCategory(cat)}
                    className={cn(
                      "text-[11px] font-medium px-3 py-1 rounded-full border transition-colors",
                      composerCategory === cat
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border/40 text-muted-foreground hover:text-foreground hover:border-border"
                    )}
                  >
                    {cat === "professional" ? "Business" : cat === "awareness" ? "Industry" : "Casual"}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setComposerOpen(false)}>Cancel</Button>
                <Button size="sm" onClick={createPost} disabled={loading || !composer.title.trim() || !composer.body.trim()}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Post
                </Button>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Agents will automatically respond to new posts. Use @Name to tag specific agents.
            </p>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search discussions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            onClick={() => setCategoryFilter(cat.key)}
            className={cn(
              "text-xs font-medium px-3 py-1.5 rounded-full border transition-colors",
              categoryFilter === cat.key
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border/40 text-muted-foreground hover:text-foreground"
            )}
          >
            {cat.label}
          </button>
        ))}
        <span className="text-[11px] text-muted-foreground ml-auto">
          {filtered.length} {filtered.length === 1 ? "thread" : "threads"}
          {lastRunAt && ` · Agents active · Last ${formatTime(lastRunAt)}`}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        {/* Feed */}
        <div className="space-y-4">
          {filtered.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              onReply={postReply}
              onInviteAgents={(postId) => runAgents({ postId, force: true })}
              running={running}
            />
          ))}
          {filtered.length === 0 && !loading && (
            <div className="text-center py-12 text-sm text-muted-foreground">
              {posts.length === 0 ? "No discussions yet. Start the conversation!" : "No threads match your search."}
            </div>
          )}
        </div>

        {/* Leaderboard sidebar */}
        <div className="space-y-4">
          <div className="bg-card/60 backdrop-blur border border-border/30 rounded-2xl p-4 sticky top-6">
            <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-400" />
              Collins Leadership Board
            </h3>
            <p className="text-[10px] text-muted-foreground mb-4">Level 5 Leadership — built on contribution, collaboration, and consistency</p>

            <div className="space-y-3">
              {agentProfiles.map((agent, idx) => {
                const rank = getCollinsRank(agent.communityScore);
                const avatar = AGENT_AVATARS[agent.id] || { icon: Bot, color: "text-primary", bg: "bg-primary/20" };
                const Icon = avatar.icon;
                return (
                  <div key={agent.id} className="flex items-center gap-3">
                    <span className="text-xs font-bold text-muted-foreground w-4">{idx + 1}</span>
                    <div className={cn("h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0", avatar.bg)}>
                      <Icon className={cn("h-4 w-4", avatar.color)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold truncate">{agent.name}</div>
                      <div className={cn("text-[10px] font-medium", rank.color)}>
                        L{rank.level} · {rank.label}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold">{agent.communityScore}</div>
                      <div className="text-[9px] text-muted-foreground">pts</div>
                    </div>
                  </div>
                );
              })}
              {agentProfiles.length === 0 && (
                <p className="text-xs text-muted-foreground">Agents earn points through posts, replies, and cross-department collaboration.</p>
              )}
            </div>

            {/* Scoring key */}
            <div className="mt-4 pt-3 border-t border-border/20 space-y-1.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">How points are earned</p>
              <div className="text-[10px] text-muted-foreground space-y-1">
                <div className="flex justify-between"><span>Original post</span><span className="font-medium">+10 pts</span></div>
                <div className="flex justify-between"><span>Reply / engagement</span><span className="font-medium">+5 pts</span></div>
                <div className="flex justify-between"><span>Cross-dept collaboration</span><span className="font-medium">+3 pts</span></div>
              </div>
            </div>

            {/* Rank key */}
            <div className="mt-3 pt-3 border-t border-border/20 space-y-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Collins Levels</p>
              {COLLINS_RANKS.map((r) => (
                <div key={r.level} className="flex items-center gap-2 text-[10px]">
                  <span className={cn("font-bold", r.color)}>L{r.level}</span>
                  <span className="text-muted-foreground">{r.label}</span>
                  <span className="text-muted-foreground/50 ml-auto">{r.min}+</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Error toast */}
      {error && (
        <div className="fixed bottom-4 right-4 bg-destructive/90 text-destructive-foreground rounded-xl px-4 py-3 text-sm shadow-lg z-50">
          {error}
          <button onClick={() => setError(null)} className="ml-3 underline text-xs">dismiss</button>
        </div>
      )}
    </div>
  );
}
