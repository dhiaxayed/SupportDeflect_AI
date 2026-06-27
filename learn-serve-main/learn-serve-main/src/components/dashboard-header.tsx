import { Search, Upload, Bell, ChevronDown, LogOut } from "lucide-react";
import { Link } from "@tanstack/react-router";
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

export function DashboardHeader({ title, description }: { title: string; description?: string }) {
  const { data: user } = useCurrentUser();
  const logout = useLogout();
  const orgName = user?.organization.name ?? "Workspace";
  const displayName = user?.full_name || user?.email || "Account";

  return (
    <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
      <div className="flex h-16 items-center gap-4 px-6">
        <div className="flex items-center gap-2 text-sm">
          <div className="flex items-center gap-2 rounded-md border px-2.5 py-1.5">
            <span className="flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-primary text-[10px] font-semibold">
              {initials(orgName)}
            </span>
            <span className="font-medium max-w-[160px] truncate">{orgName}</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
        </div>
        <div className="relative ml-2 hidden flex-1 max-w-md md:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search documents, questions, settings…"
            className="pl-9 h-9 bg-muted/40 border-transparent focus-visible:bg-background"
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-9 w-9">
            <Bell className="h-4 w-4" />
          </Button>
          <Button asChild size="sm" className="h-9">
            <Link to="/dashboard/upload">
              <Upload className="h-4 w-4 mr-1.5" /> Upload docs
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="rounded-full outline-none">
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
              <DropdownMenuItem onClick={logout} className="text-destructive">
                <LogOut className="mr-2 h-4 w-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="px-6 pb-5 pt-2">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
    </header>
  );
}
