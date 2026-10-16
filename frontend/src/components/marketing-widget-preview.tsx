/**
 * @file Explicitly illustrative widget on the public landing page. Its conversation is static
 * product guidance rather than a simulated AI backend; hydration gates the open/close
 * controls, and the call to action leads to registration without making authenticated
 * requests.
 */

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, MessageCircle, X } from "lucide-react";
import iconUrl from "@/assets/official-icon.png";
import { useHydrated } from "@/hooks/use-hydrated";

// This labeled product illustration has no simulated chat or authenticated API requests.
/**
 * Render the labeled example conversation and controlled launcher; closing the illustration
 * never changes saved tenant widget settings.
 */
export function MarketingWidgetPreview() {
  const hydrated = useHydrated();
  const [open, setOpen] = useState(true);
  return (
    <figure className="marketing-widget-preview relative w-full overflow-hidden rounded-xl border bg-gradient-to-br from-muted/30 to-background">
      <figcaption className="absolute left-5 top-5 text-xs text-muted-foreground">
        Example conversation
      </figcaption>
      {open && (
        <div className="marketing-widget-panel absolute bottom-4 right-4 overflow-hidden rounded-2xl border bg-card text-left shadow-xl">
          <div className="flex items-center justify-between bg-[#6e56cf] px-4 py-3 text-white">
            <div className="flex min-w-0 items-center gap-2">
              <img
                src={iconUrl}
                alt=""
                className="h-7 w-7 rounded-full bg-white object-contain p-1"
              />
              <span className="text-sm font-semibold">Acme Support</span>
            </div>
            <button
              type="button"
              disabled={!hydrated}
              onClick={() => setOpen(false)}
              aria-label="Close example widget"
              title="Close example widget"
              className="flex size-7 items-center justify-center rounded-md hover:bg-white/15"
            >
              <X size={16} />
            </button>
          </div>
          <div className="space-y-3 p-4 text-sm">
            <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-muted px-3 py-2">
              Hi! How can we help?
            </div>
            <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-[#6e56cf] px-3 py-2 text-white">
              How do I add our company logo?
            </div>
            <div className="max-w-[90%] rounded-2xl rounded-tl-sm bg-muted px-3 py-2">
              Open Widget Design Studio, upload your logo and save your design.
            </div>
          </div>
          <Link
            to="/register"
            className="flex items-center justify-between gap-2 border-t bg-background px-4 py-3 text-xs text-primary hover:bg-muted/40"
          >
            Try with your own documents <ArrowRight size={15} />
          </Link>
        </div>
      )}
      <button
        type="button"
        disabled={!hydrated}
        onClick={() => setOpen(!open)}
        aria-label={open ? "Hide example widget" : "Open example widget"}
        title={open ? "Hide example widget" : "Open example widget"}
        className="marketing-widget-launcher absolute bottom-4 flex size-12 items-center justify-center rounded-full bg-[#6e56cf] text-white shadow-lg"
      >
        <MessageCircle size={20} />
      </button>
    </figure>
  );
}
