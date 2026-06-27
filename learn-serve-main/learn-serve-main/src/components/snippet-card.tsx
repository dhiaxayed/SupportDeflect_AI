import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SnippetCard({ code, language = "html" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="overflow-hidden rounded-xl border bg-[oklch(0.16_0.02_265)] text-[oklch(0.92_0.005_265)]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2 text-xs">
        <span className="font-mono uppercase tracking-wider text-white/60">{language}</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={copy}
          className="h-7 gap-1.5 text-white/80 hover:bg-white/10 hover:text-white"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}
