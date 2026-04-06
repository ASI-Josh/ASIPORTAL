"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/contexts/AuthContext";
import { Bot, Send, User as UserIcon, Loader2, Star } from "lucide-react";

type Message = {
  role: "user" | "assistant";
  content: string;
  satisfaction?: { score: number; captured: boolean };
};

export default function ClientAthenaPage() {
  const { user, firebaseUser } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [ratingScore, setRatingScore] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const orgName = user?.organizationName || "your organisation";

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Welcome message
  useEffect(() => {
    setMessages([
      {
        role: "assistant",
        content: `Hello! I'm Athena, your dedicated AI assistant for ${orgName}. I can help you with:\n\n• **Fleet performance** — fuel savings, environmental impact, protection status\n• **Service history** — completed works, upcoming bookings, inspection results\n• **Sustainability data** — CO2 reduction, waste avoidance, ESG reporting support\n• **General questions** — anything about your fleet protection program\n\nHow can I help you today?`,
      },
    ]);
  }, [orgName]);

  const handleSend = async () => {
    if (!input.trim() || loading || !firebaseUser) return;

    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setLoading(true);

    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/client/athena", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: userMessage }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || "Request failed");
      }

      const data = await response.json();
      setMessages((prev) => [...prev, { role: "assistant", content: data.response }]);

      // After every 5 messages, prompt for satisfaction
      const userMsgCount = messages.filter((m) => m.role === "user").length + 1;
      if (userMsgCount > 0 && userMsgCount % 5 === 0) {
        setShowRating(true);
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `I'm sorry, I wasn't able to process that request. Please try again or contact your ASI representative. (${err.message})` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleRating = async (score: number) => {
    setRatingScore(score);
    setShowRating(false);

    if (!firebaseUser) return;
    try {
      const token = await firebaseUser.getIdToken();
      await fetch("/api/client/athena", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: "__satisfaction_rating__",
          satisfactionScore: score,
        }),
      });
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Thank you for your feedback! Your rating of ${score}/5 has been recorded. This helps us continuously improve our service to ${orgName}.`,
        },
      ]);
    } catch {
      // Silent fail for rating
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <div className="mb-4">
        <h2 className="text-3xl font-headline font-bold tracking-tight flex items-center gap-3">
          <Bot className="h-8 w-8 text-primary" />
          Athena
        </h2>
        <p className="text-muted-foreground">
          Your AI assistant for {orgName} fleet data, performance insights, and service enquiries.
        </p>
      </div>

      <Card className="flex-1 flex flex-col bg-card/50 backdrop-blur overflow-hidden">
        <ScrollArea className="flex-1 p-4">
          <div className="space-y-4 pb-4">
            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "assistant" && (
                  <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                )}
                <div
                  className={`rounded-lg px-4 py-3 max-w-[80%] text-sm whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  {msg.content}
                </div>
                {msg.role === "user" && (
                  <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <UserIcon className="h-4 w-4" />
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex gap-3">
                <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div className="bg-muted rounded-lg px-4 py-3">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              </div>
            )}

            {/* Satisfaction Rating Prompt */}
            {showRating && (
              <div className="flex gap-3">
                <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <Card className="max-w-[80%]">
                  <CardContent className="py-3 px-4">
                    <p className="text-sm mb-2">How would you rate your experience with our service?</p>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((score) => (
                        <Button
                          key={score}
                          variant="ghost"
                          size="sm"
                          className="p-1"
                          onClick={() => handleRating(score)}
                        >
                          <Star
                            className={`h-6 w-6 ${score <= ratingScore ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`}
                          />
                        </Button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
            <div ref={scrollRef} />
          </div>
        </ScrollArea>

        {/* Input Area */}
        <div className="border-t p-4">
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your fleet performance, service history, sustainability data..."
              disabled={loading}
              className="flex-1"
            />
            <Button onClick={handleSend} disabled={loading || !input.trim()} size="icon">
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex gap-2 mt-2 flex-wrap">
            {[
              "What are our fuel savings?",
              "Show our environmental impact",
              "Any upcoming services?",
              "Sustainability report summary",
            ].map((q) => (
              <Badge
                key={q}
                variant="outline"
                className="cursor-pointer hover:bg-muted text-xs"
                onClick={() => { setInput(q); }}
              >
                {q}
              </Badge>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
