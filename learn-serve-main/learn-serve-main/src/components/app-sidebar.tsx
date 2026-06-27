import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  FileText,
  Upload,
  Link2,
  MessageSquare,
  Code2,
  BarChart3,
  Settings,
  CreditCard,
} from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { useAnalytics } from "@/hooks/use-data";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { to: "/dashboard/documents", label: "Documents", icon: FileText },
  { to: "/dashboard/upload", label: "Upload", icon: Upload },
  { to: "/dashboard/sources", label: "URL Sources", icon: Link2 },
  { to: "/dashboard/playground", label: "Playground", icon: MessageSquare },
  { to: "/dashboard/widget", label: "Widget", icon: Code2 },
  { to: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/dashboard/settings", label: "Settings", icon: Settings },
  { to: "/dashboard/billing", label: "Billing", icon: CreditCard },
];

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: analytics } = useAnalytics();
  const conversationLimit = 50000;
  const conversations = analytics?.total_questions ?? 0;
  const usagePercent = Math.min(100, Math.round((conversations / conversationLimit) * 100));

  return (
    <aside className="hidden md:flex w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 items-center gap-2 px-5 border-b">
        <BrandLogo imageClassName="h-9 max-w-[190px]" />
      </div>
      <nav className="flex-1 overflow-y-auto p-3">
        <div className="px-2 pb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Workspace
        </div>
        <ul className="space-y-0.5">
          {nav.map((item) => {
            const active = pathname === item.to;
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t p-4">
        <div className="rounded-lg border bg-card p-3 text-xs">
          <div className="font-medium">Pro plan</div>
          <div className="text-muted-foreground mt-0.5">
            {conversations.toLocaleString()} / {conversationLimit.toLocaleString()} conversations
          </div>
          <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${usagePercent}%`, background: "var(--gradient-primary)" }}
            />
          </div>
        </div>
      </div>
    </aside>
  );
}
