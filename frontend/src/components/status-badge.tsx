/**
 * @file Tenant status presentation for ingestion and AI conversation outcomes. Text labels and
 * icons accompany colors so status meaning is not conveyed by color alone; clarification
 * remains distinct from unresolved human review.
 */

import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock, XCircle, FileEdit } from "lucide-react";
import type { UiDocStatus } from "@/lib/api";

/**
 * Choose the established icon/color for a typed document or conversation display status and
 * retain its readable label inside the shared badge.
 */
export function StatusBadge({
  status,
}: {
  status: UiDocStatus | "Resolved" | "Unresolved" | "Clarification";
}) {
  const map = {
    Indexed: { cls: "bg-success/10 text-success border-success/20", Icon: CheckCircle2 },
    Processing: { cls: "bg-warning/15 text-warning-foreground border-warning/30", Icon: Clock },
    Failed: { cls: "bg-destructive/10 text-destructive border-destructive/20", Icon: XCircle },
    Draft: { cls: "bg-muted text-muted-foreground border-border", Icon: FileEdit },
    Resolved: { cls: "bg-success/10 text-success border-success/20", Icon: CheckCircle2 },
    Unresolved: { cls: "bg-destructive/10 text-destructive border-destructive/20", Icon: XCircle },
    Clarification: { cls: "bg-warning/15 text-warning-foreground border-warning/30", Icon: Clock },
  } as const;
  const { cls, Icon } = map[status];
  return (
    <Badge variant="outline" className={`gap-1 font-medium ${cls}`}>
      <Icon className="h-3 w-3" />
      {status}
    </Badge>
  );
}
