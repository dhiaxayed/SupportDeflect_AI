import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock, XCircle, FileEdit } from "lucide-react";
import type { UiDocStatus } from "@/lib/api";

export function StatusBadge({ status }: { status: UiDocStatus | "Resolved" | "Unresolved" }) {
  const map = {
    Indexed: { cls: "bg-success/10 text-success border-success/20", Icon: CheckCircle2 },
    Processing: { cls: "bg-warning/15 text-warning-foreground border-warning/30", Icon: Clock },
    Failed: { cls: "bg-destructive/10 text-destructive border-destructive/20", Icon: XCircle },
    Draft: { cls: "bg-muted text-muted-foreground border-border", Icon: FileEdit },
    Resolved: { cls: "bg-success/10 text-success border-success/20", Icon: CheckCircle2 },
    Unresolved: { cls: "bg-destructive/10 text-destructive border-destructive/20", Icon: XCircle },
  } as const;
  const { cls, Icon } = map[status];
  return (
    <Badge variant="outline" className={`gap-1 font-medium ${cls}`}>
      <Icon className="h-3 w-3" />
      {status}
    </Badge>
  );
}
