import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { DashboardHeader } from "@/components/dashboard-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useWidgetSettings } from "@/hooks/use-data";
import { useCurrentUser } from "@/hooks/use-auth";
import { API_BASE_URL, updateWidgetSettings, type WidgetSettings } from "@/lib/api";

export const Route = createFileRoute("/dashboard/settings")({
  head: () => ({ meta: [{ title: "Settings — SupportDeflect AI" }] }),
  component: Settings,
});

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Settings() {
  const { data: settings } = useWidgetSettings();
  const { data: user } = useCurrentUser();
  const queryClient = useQueryClient();

  const [brand, setBrand] = useState("");
  const [color, setColor] = useState("#2563eb");
  const [welcome, setWelcome] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [domains, setDomains] = useState("");
  const [strict, setStrict] = useState(true);

  useEffect(() => {
    if (settings) {
      setBrand(settings.brand_name);
      setColor(settings.primary_color);
      setWelcome(settings.greeting_message);
      setSupportEmail(settings.support_email ?? "");
      setDomains((settings.allowed_domains ?? []).join(", "));
      setStrict(settings.strict_mode);
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload: WidgetSettings = {
        brand_name: brand,
        primary_color: color,
        greeting_message: welcome,
        support_email: supportEmail.trim() ? supportEmail.trim() : null,
        strict_mode: strict,
        allowed_domains: domains
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean),
      };
      return updateWidgetSettings(payload);
    },
    onSuccess: () => {
      toast.success("Settings saved");
      queryClient.invalidateQueries({ queryKey: ["settings", "widget"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to save settings"),
  });

  return (
    <>
      <DashboardHeader
        title="Settings"
        description="Configure your workspace, branding, security and API."
      />
      <div className="grid gap-6 p-6 lg:grid-cols-2">
        <Section title="Organization" description="Public information about your company.">
          <div className="space-y-1.5">
            <Label>Company name</Label>
            <Input value={user?.organization.name ?? ""} readOnly />
          </div>
          <div className="space-y-1.5">
            <Label>Admin email</Label>
            <Input value={user?.email ?? ""} readOnly />
          </div>
          <div className="space-y-1.5">
            <Label>Public company ID</Label>
            <Input
              value={user?.organization.public_id ?? ""}
              readOnly
              className="font-mono text-sm"
            />
          </div>
        </Section>

        <Section title="Widget branding" description="Customize how your widget feels.">
          <div className="space-y-1.5">
            <Label>Brand name</Label>
            <Input value={brand} onChange={(e) => setBrand(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Primary color</Label>
            <div className="flex gap-2">
              <Input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-14 p-1"
              />
              <Input value={color} onChange={(e) => setColor(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Welcome message</Label>
            <Input value={welcome} onChange={(e) => setWelcome(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Support email</Label>
            <Input
              type="email"
              value={supportEmail}
              onChange={(e) => setSupportEmail(e.target.value)}
              placeholder="support@company.com"
            />
          </div>
        </Section>

        <Section title="Security" description="Lock down where and how your assistant can be used.">
          <div className="space-y-1.5">
            <Label>Allowed domains</Label>
            <Input
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              placeholder="acme.com, help.acme.com"
            />
          </div>
          <Row label="Strict answer mode" hint="Only answer from indexed documents">
            <Switch checked={strict} onCheckedChange={setStrict} />
          </Row>
        </Section>

        <Section title="API" description="Programmatic access for advanced use cases.">
          <div className="space-y-1.5">
            <Label>API base URL</Label>
            <Input value={API_BASE_URL} readOnly className="font-mono text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label>Public company ID</Label>
            <Input
              value={user?.organization.public_id ?? ""}
              readOnly
              className="font-mono text-xs"
            />
          </div>
        </Section>

        <div className="lg:col-span-2">
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
              </>
            ) : (
              "Save settings"
            )}
          </Button>
        </div>
      </div>
    </>
  );
}
