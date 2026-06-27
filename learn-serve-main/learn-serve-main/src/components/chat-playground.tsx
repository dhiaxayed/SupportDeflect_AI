import { useState } from "react";
import { Send, Sparkles, RotateCcw, FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { askPlayground } from "@/lib/api";

interface Msg {
  role: "user" | "assistant";
  content: string;
  confidence?: number;
  sources?: { title: string; chunk: string }[];
  resolved?: boolean;
}

const EXAMPLES = [
  "How do I reset my API key?",
  "What is your refund policy?",
  "How can I integrate the widget?",
  "Do you support SSO?",
];

export function ChatPlayground() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const send = async (q: string) => {
    if (!q.trim()) return;
    setMsgs((m) => [...m, { role: "user", content: q }]);
    setInput("");
    setLoading(true);
    try {
      const res = await askPlayground(q);
      setMsgs((m) => [
        ...m,
        {
          role: "assistant",
          content: res.answer,
          confidence: Math.round(res.confidence * 100),
          sources: res.sources,
          resolved: res.resolved,
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
            <Sparkles className="h-3.5 w-3.5 text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold">Test assistant</div>
            <div className="text-xs text-muted-foreground">
              Answers only from your indexed documents
            </div>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setMsgs([])} className="gap-1.5">
          <RotateCcw className="h-3.5 w-3.5" /> Clear
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {msgs.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" />
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
                  <div className="text-sm leading-relaxed">{m.content}</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className="bg-success/10 text-success border-success/20"
                    >
                      {m.resolved ? "Resolved" : "Needs human review"}
                    </Badge>
                    <Badge variant="outline">Confidence {m.confidence}%</Badge>
                  </div>
                  {m.sources && (
                    <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Sources
                      </div>
                      {m.sources.map((s, j) => (
                        <div key={j} className="flex items-start gap-2 text-xs">
                          <FileText className="mt-0.5 h-3.5 w-3.5 text-primary shrink-0" />
                          <div>
                            <div className="font-medium">{s.title}</div>
                            <div className="text-muted-foreground">{s.chunk}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                m.content
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
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
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything about your product…"
          className="flex-1"
        />
        <Button type="submit" disabled={loading || !input.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
