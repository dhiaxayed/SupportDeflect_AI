import { MessageCircle, X, Send, Sparkles } from "lucide-react";

export function WidgetPreview({
  brandName = "Acme Support",
  primaryColor = "#6E56CF",
  welcomeMessage = "Hi 👋 How can we help?",
}: {
  brandName?: string;
  primaryColor?: string;
  welcomeMessage?: string;
}) {
  return (
    <div className="relative h-[460px] w-full overflow-hidden rounded-xl border bg-gradient-to-br from-muted/30 to-background">
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)",
          backgroundSize: "16px 16px",
        }}
      />
      <div className="absolute bottom-4 right-4 w-[320px] overflow-hidden rounded-2xl border bg-card shadow-2xl">
        <div
          className="flex items-center justify-between px-4 py-3 text-white"
          style={{ background: primaryColor }}
        >
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <div className="text-sm font-semibold">{brandName}</div>
          </div>
          <X className="h-4 w-4 opacity-80" />
        </div>
        <div className="space-y-3 p-4 text-sm">
          <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-foreground">
            {welcomeMessage}
          </div>
          <div
            className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm px-3 py-2 text-white"
            style={{ background: primaryColor }}
          >
            How do I reset my API key?
          </div>
          <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-muted px-3 py-2">
            You can rotate your API key from <span className="font-medium">Settings → API</span>.
            Click <em>Regenerate</em>.
          </div>
        </div>
        <div className="flex items-center gap-2 border-t bg-background px-3 py-2">
          <input
            className="flex-1 bg-transparent text-sm outline-none"
            placeholder="Ask a question…"
          />
          <button
            className="flex h-7 w-7 items-center justify-center rounded-md text-white"
            style={{ background: primaryColor }}
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <button
        className="absolute bottom-4 right-[360px] flex h-12 w-12 items-center justify-center rounded-full text-white shadow-lg"
        style={{ background: primaryColor }}
      >
        <MessageCircle className="h-5 w-5" />
      </button>
    </div>
  );
}
