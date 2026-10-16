/**
 * @file Read-only tenant account/integration details with links to the dedicated widget Studio
 * and password-change workflows. Identity comes from the current account response, and the
 * public company/API fields support integration without exposing the administrator bearer
 * token.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, KeyRound, Palette } from "lucide-react";
import { DashboardHeader } from "@/components/dashboard-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCurrentUser } from "@/hooks/use-auth";
import { publicApiUrl } from "@/lib/api";

export const Route = createFileRoute("/dashboard/settings")({
  /**
   * Set the account-settings route title.
   */
  head: () => ({ meta: [{ title: "Account settings - SupportDeflect AI" }] }),
  component: Settings,
});

/**
 * Render organization/account identity, public integration identifiers and navigation to
 * existing branding/security editors rather than duplicating mutation forms.
 */
function Settings() {
  const { data: user } = useCurrentUser();
  return (
    <>
      <DashboardHeader
        title="Account settings"
        description="Your workspace, assistant and account security."
      />
      <div className="grid gap-6 p-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Organization</CardTitle>
            <p className="text-sm text-muted-foreground">
              Public information about your workspace.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="block space-y-1.5 text-sm">
              <span>Company name</span>
              <Input value={user?.organization?.name ?? ""} readOnly />
            </label>
            <label className="block space-y-1.5 text-sm">
              <span>Account email</span>
              <Input value={user?.email ?? ""} readOnly />
            </label>
            <label className="block space-y-1.5 text-sm">
              <span>Public company ID</span>
              <Input
                value={user?.organization?.public_id ?? ""}
                readOnly
                className="font-mono text-xs"
              />
            </label>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Widget branding</CardTitle>
            <p className="text-sm text-muted-foreground">
              Make your assistant feel at home on your website.
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Palette size={22} />
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Manage your logo, colors, welcome message and allowed websites in the Widget Design
              Studio.
            </p>
            <Button asChild>
              <Link to="/dashboard/widget">
                Open Design Studio <ArrowRight size={16} />
              </Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Security</CardTitle>
            <p className="text-sm text-muted-foreground">Keep access to your workspace secure.</p>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/change-password">
                <KeyRound size={16} />
                Change password
              </Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>API</CardTitle>
            <p className="text-sm text-muted-foreground">
              Connection details for your integration.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="block space-y-1.5 text-sm">
              <span>API base URL</span>
              <Input value={publicApiUrl()} readOnly className="font-mono text-xs" />
            </label>
            <label className="block space-y-1.5 text-sm">
              <span>Public company ID</span>
              <Input
                value={user?.organization?.public_id ?? ""}
                readOnly
                className="font-mono text-xs"
              />
            </label>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
