/**
 * @file Shared Sonner notification host mounted once by the root route. Theme classes keep
 * feature toast messages visually consistent; mutations invoke Sonner separately, so this
 * component owns presentation rather than notification business logic.
 */

import { Toaster as Sonner } from "sonner";

/**
 * Sonner host properties reused directly so wrapper consumers retain the notification
 * library's supported configuration.
 */
type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * Mount the themed toast region and forward Sonner host options so root-level configuration
 * can override placement or behavior.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
