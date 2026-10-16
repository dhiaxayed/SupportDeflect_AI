/**
 * @file Shared tenant page header with account identity, logout and document-search
 * navigation. It reads the current account and uses router search state to open the document
 * list; individual feature pages supply only their title, description and optional actions.
 */

import { Upload, LogOut, Search, Bell, KeyRound } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCurrentUser, useLogout } from "@/hooks/use-auth";

/**
 * Build a compact avatar fallback from at most two nonempty name/email words so an account
 * without an image still has a stable identity.
 */
function initials(value: string): string {
  const parts = value
    .trim()
    .split(/[\s@.]+/)
    .filter(Boolean);
  if (parts.length === 0) return "U";
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Render the page heading and account menu, and navigate document searches to the shared
 * documents q filter rather than maintaining an independent result set.
 */
export function DashboardHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  const { data: user } = useCurrentUser();
  const logout = useLogout();
  const orgName = user?.organization?.name ?? "Workspace";
  const displayName = user?.full_name || user?.email || "Account";
  const [search, setSearch] = useState("");
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
      <div className="flex h-16 items-center gap-2 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <div className="flex items-center gap-2 rounded-md border px-2.5 py-1.5">
            <span className="flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-primary text-[10px] font-semibold">
              {initials(orgName)}
            </span>
            <span className="max-w-[100px] truncate font-medium sm:max-w-[160px]">{orgName}</span>
          </div>
        </div>
        {user?.role === "tenant_admin" && (
          <form
            className="relative ml-2 hidden max-w-md flex-1 md:block"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              void navigate({
                to: "/dashboard/documents",
                search: { q: search.trim() || undefined },
              });
            }}
          >
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search workspace documents"
              placeholder="Search documents..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-9 bg-muted/40 border-transparent pl-9 focus-visible:bg-background"
            />
          </form>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Button asChild variant="ghost" size="icon" className="size-9">
            <Link to="/dashboard/inbox" aria-label="Support inbox" title="Support inbox">
              <Bell size={16} />
            </Link>
          </Button>
          {user?.role === "tenant_admin" && (
            <Button asChild size="sm" className="h-9">
              <Link to="/dashboard/upload" aria-label="Upload documents" title="Upload documents">
                <Upload className="h-4 w-4" /> <span className="hidden sm:inline">Upload docs</span>
              </Link>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="rounded-full outline-none" aria-label="Account menu">
                <Avatar className="h-9 w-9">
                  <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                    {initials(displayName)}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="px-2 py-1.5 text-sm">
                <div className="font-medium truncate">{displayName}</div>
                {user?.email && (
                  <div className="text-xs text-muted-foreground truncate">{user.email}</div>
                )}
              </div>
              <DropdownMenuItem asChild>
                <Link to="/change-password">
                  <KeyRound className="mr-2 size-4" />
                  Account security
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={logout} className="text-destructive">
                <LogOut className="mr-2 h-4 w-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 px-6 pb-5 pt-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
    </header>
  );
}
