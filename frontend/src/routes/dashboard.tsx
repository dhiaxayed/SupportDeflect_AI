/**
 * @file Tenant route shell combining role gating, sidebar and nested route outlet. The Inbox
 * permits both tenant administrators and support agents; all other dashboard paths require
 * tenant administration. Server-side endpoint checks independently enforce those permissions.
 */

import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { AppSidebar } from "@/components/app-sidebar";
import { RoleGuard } from "@/components/role-guard";

export const Route = createFileRoute("/dashboard")({
  component: DashboardLayout,
});

/**
 * Select the allowed roles for the current tenant route and mount workspace chrome only after
 * RoleGuard confirms the account.
 */
function DashboardLayout() {
  const pathname = useRouterState({
    /**
     * Read only pathname to decide whether this navigation targets the shared support Inbox or
     * an administrator-only feature.
     */
    select: (s) => s.location.pathname,
  });

  return (
    <RoleGuard
      roles={pathname === "/dashboard/inbox" ? ["tenant_admin", "support_agent"] : ["tenant_admin"]}
    >
      <div className="tenant-shell flex min-h-screen w-full flex-col md:flex-row bg-background">
        <AppSidebar />
        <div className="flex-1 min-w-0 flex flex-col">
          <Outlet />
        </div>
      </div>
    </RoleGuard>
  );
}
