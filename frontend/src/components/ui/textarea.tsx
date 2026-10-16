/**
 * @file Shared multiline native input wrapper used for notes and human replies. Keep business
 * limits and labels in feature views while centralizing border, focus, disabled appearance and
 * DOM ref forwarding.
 */

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Render a styled native textarea with caller-controlled content, validation limits and
 * events; preserve the ref for focus or form integration.
 */
const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
