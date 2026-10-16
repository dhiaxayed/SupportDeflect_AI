/**
 * @file Super-admin workspace shell with platform navigation, current operator identity and
 * logout. RoleGuard grants rendering only to the database-resolved super_admin role; the
 * platform is separate from tenant administration and does not imply tenant membership.
 */

import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Building2,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Mail,
  ScrollText,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { RoleGuard } from "@/components/role-guard";
import { BrandLogo } from "@/components/brand-logo";
import { useCurrentUser, useLogout } from "@/hooks/use-auth";
import "@/admin.css";

export const Route = createFileRoute("/platform")({ component: PlatformLayout });
const nav = [
  { to: "/platform", label: "Business overview", icon: LayoutDashboard, group: "WORKSPACE" },
  { to: "/platform/organizations", label: "Organizations", icon: Building2 },
  { to: "/platform/subscriptions", label: "Subscriptions", icon: CreditCard },
  { to: "/platform/billing", label: "Revenue & payments", icon: BarChart3 },
  { to: "/platform/usage", label: "Product analytics", icon: Activity },
  { to: "/platform/communications", label: "Communications", icon: Mail, group: "OPERATIONS" },
  { to: "/platform/health", label: "System health", icon: Activity },
  { to: "/platform/audit", label: "Audit trail", icon: ScrollText },
] as const;

/**
 * Compose the platform navigation/header and nested route outlet only inside the super-admin
 * role gate; use the shared logout workflow to clear private data.
 */
function PlatformLayout() {
  const logout = useLogout();
  const { data: user } = useCurrentUser();
  return (
    <RoleGuard roles={["super_admin"]}>
      <div className="admin-shell">
        <header className="admin-topbar">
          <Link to="/platform" className="admin-brand">
            <span className="admin-brand-image">
              <BrandLogo imageClassName="h-7 max-w-[174px]" />
            </span>
            <span className="admin-console-label">Administration</span>
          </Link>
          <div className="admin-topbar-right">
            <span className="admin-access">
              <ShieldCheck size={14} /> Super admin
            </span>
            <Link to="/change-password" title="Account security" aria-label="Account security">
              <UserRound size={18} />
            </Link>
            <button onClick={logout} title="Sign out" aria-label="Sign out">
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <aside className="admin-sidebar">
          <div className="admin-workspace">
            <span className="admin-workspace-icon">
              <ShieldCheck size={20} />
            </span>
            <div>
              <strong>SupportDeflect AI</strong>
              <span>Platform workspace</span>
            </div>
          </div>
          <nav aria-label="Platform navigation">
            {nav.map((item) => (
              <div key={item.to}>
                {"group" in item && <div className="admin-nav-group">{item.group}</div>}
                <Link
                  to={item.to}
                  className="admin-nav-link"
                  activeOptions={{ exact: item.to === "/platform" }}
                >
                  <item.icon size={17} />
                  <span>{item.label}</span>
                  {item.to === "/platform/communications" && (
                    <ArrowUpRight className="ml-auto" size={13} />
                  )}
                </Link>
              </div>
            ))}
          </nav>
          <div className="admin-profile">
            <span className="admin-avatar">
              {(user?.full_name || user?.email || "SA").slice(0, 2).toUpperCase()}
            </span>
            <div>
              <strong>{user?.full_name || "Administrator"}</strong>
              <span>{user?.email}</span>
            </div>
          </div>
        </aside>
        <main className="admin-main">
          <Outlet />
        </main>
      </div>
    </RoleGuard>
  );
}
