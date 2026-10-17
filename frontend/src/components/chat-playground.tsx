/**
 * @file Tenant administrator conversation tester connected to the protected /chat endpoint.
 * Keep draft/history in component memory, bound requests through askPlayground and refresh
 * analytics/usage after accepted answers. Evidence, clarification and provider outages are
 * displayed distinctly; the score is retrieval similarity, not factual certainty.
 */

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Send, MessageSquareText, RotateCcw, FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { askPlayground, type PlaygroundAnswer } from "@/lib/api";

/**
 * Local playground message with optional assistant evidence/diagnostics; user messages need
 * only role and content, and nothing is persisted in browser storage.
 */
interface Msg {
  role: "user" | "assistant";
  content: string;
  confidence?: number;
  sources?: { title: string; chunk: string }[];
  resolved?: boolean;
  reason?: PlaygroundAnswer["reason"];
  errorCode?: string | null;
}

const EXAMPLES = [
  "How do I reset my API key?",
  "What is your refund policy?",
  "How can I integrate the widget?",
  "Do you support SSO?",
];

/**
 * Render an accessible conversation log, source evidence and question form, keeping
 * follow-scroll optional when the reader scrolls away. Clearing resets this local test
 * conversation only.
 */
export function ChatPlayground() {
  const cache = useQueryClient();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesPane = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  useEffect(() => {
    if (followLatest.current && messagesPane.current) {
      messagesPane.current.scrollTop = messagesPane.current.scrollHeight;
    }
  }, [msgs, loading]);

  /**
   * Validate and trim the draft before adding a turn, send recent history once, append the
   * returned answer/diagnostics and refresh usage/report caches. Surface failures without
   * fabricating an assistant response.
   */
  const send = async (q: string) => {
    const question = q.trim();
    // Match ChatRequest validation before clearing the draft or adding a conversation turn.
    if (question.length < 2 || question.length > 2000 || loading) return;
    followLatest.current = true;
    setMsgs((m) => [...m, { role: "user", content: question }]);
    setInput("");
    setLoading(true);
    try {
      const res = await askPlayground(
        question,
        msgs.map((message) => ({ role: message.role, content: message.content })),
      );
      void cache.invalidateQueries({ queryKey: ["analytics"] });
      void cache.invalidateQueries({ queryKey: ["settings", "subscription"] });
      setMsgs((m) => [
        ...m,
        {
          role: "assistant",
          content: res.answer,
          confidence: Math.round(res.confidence * 100),
          sources: res.sources,
          resolved: res.resolved,
          reason: res.reason,
          errorCode: res.errorCode,
        },
      ]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to get an answer");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-220px)] flex-col rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-md"
            style={{ background: "var(--gradient-primary)" }}
          >
            <MessageSquareText className="h-3.5 w-3.5 text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold">Test assistant</div>
            <div className="text-xs text-muted-foreground">
              Answers only from your indexed documents
            </div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={loading}
          onClick={() => setMsgs([])}
          className="gap-1.5"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Clear
        </Button>
      </div>

      <div
        ref={messagesPane}
        role="log"
        aria-label="Conversation"
        aria-live="polite"
        aria-busy={loading}
        onScroll={(event) => {
          const pane = event.currentTarget;
          followLatest.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 80;
        }}
        className="flex-1 overflow-y-auto p-6 space-y-4"
      >
        {msgs.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <MessageSquareText className="h-5 w-5" />
            </div>
            <h3 className="mt-4 text-base font-semibold">Try a question</h3>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              See how your assistant responds before embedding the widget.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2 max-w-lg">
              {EXAMPLES.map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  className="rounded-full border bg-background px-3 py-1.5 text-xs hover:bg-accent"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
            <div
              className={
                m.role === "user"
                  ? "max-w-[75%] rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground"
                  : "max-w-[80%] space-y-3"
              }
            >
              {m.role === "assistant" ? (
                <>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={
                        m.resolved
                          ? "bg-success/10 text-success border-success/20"
                          : m.reason === "clarification_needed"
                            ? "bg-warning/15 text-warning-foreground border-warning/30"
                            : "bg-destructive/10 text-destructive border-destructive/20"
                      }
                    >
                      {m.reason === "greeting"
                        ? "Conversation"
                        : m.reason === "clarification_needed"
                          ? "Clarification needed"
                          : m.reason === "llm_unavailable"
                            ? "AI unavailable"
                            : m.reason === "retrieval_unavailable"
                              ? "Knowledge search unavailable"
                              : m.reason === "insufficient_knowledge"
                                ? "Insufficient documentation"
                                : m.resolved
                                  ? "Answered"
                                  : "Needs human review"}
                    </Badge>
                    {m.reason !== "greeting" &&
                      m.reason !== "clarification_needed" &&
                      m.reason !== "llm_unavailable" &&
                      m.reason !== "retrieval_unavailable" && (
                        <Badge variant="outline">
                          Retrieval score {((m.confidence ?? 0) / 100).toFixed(2)}
                        </Badge>
                      )}
                    {m.errorCode && (
                      <Badge variant="outline">
                        {m.errorCode === "authentication"
                          ? "Groq credentials rejected"
                          : m.errorCode === "rate_limit"
                            ? "Groq rate limit reached"
                            : m.errorCode === "configuration"
                              ? "Groq configuration missing"
                              : m.errorCode === "model_unavailable"
                                ? "Groq model unavailable"
                                : m.errorCode === "timeout"
                                  ? "AI request timed out"
                                  : "Service error"}
                      </Badge>
                    )}
                  </div>
                  {!!m.sources?.length && (
                    <details className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
                      <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <span>Sources</span> ({m.sources.length})
                      </summary>
                      {m.sources.map((s, j) => (
                        <div key={j} className="flex items-start gap-2 text-xs">
                          <FileText className="mt-0.5 h-3.5 w-3.5 text-primary shrink-0" />
                          <div className="min-w-0 break-words">
                            <div className="font-medium">{s.title}</div>
                            <div className="whitespace-pre-wrap text-muted-foreground">
                              {s.chunk}
                            </div>
                          </div>
                        </div>
                      ))}
                    </details>
                  )}
                </>
              ) : (
                m.content
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="flex gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" />
            </div>
            Thinking…
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex gap-2 border-t p-3"
      >
        <Input
          aria-label="Your question"
          minLength={2}
          maxLength={2000}
          required
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything about your product…"
          className="flex-1"
        />
        <Button
          type="submit"
          aria-label="Send message"
          disabled={loading || input.trim().length < 2}
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
