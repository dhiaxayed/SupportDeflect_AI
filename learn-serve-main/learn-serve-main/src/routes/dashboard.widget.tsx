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
import { WidgetPreview } from "@/components/widget-preview";
import { SnippetCard } from "@/components/snippet-card";
import { Separator } from "@/components/ui/separator";
import { useWidgetSettings } from "@/hooks/use-data";
import { useCurrentUser } from "@/hooks/use-auth";
import { API_BASE_URL, updateWidgetSettings, type WidgetSettings } from "@/lib/api";

export const Route = createFileRoute("/dashboard/widget")({
  head: () => ({ meta: [{ title: "Widget — SupportDeflect AI" }] }),
  component: Widget,
});

function Widget() {
  const { data: settings } = useWidgetSettings();
  const { data: user } = useCurrentUser();
  const queryClient = useQueryClient();

  const [brand, setBrand] = useState("");
  const [color, setColor] = useState("#2563eb");
  const [welcome, setWelcome] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [domains, setDomains] = useState("");

  useEffect(() => {
    if (settings) {
      setBrand(settings.brand_name);
      setColor(settings.primary_color);
      setWelcome(settings.greeting_message);
      setSupportEmail(settings.support_email ?? "");
      setDomains((settings.allowed_domains ?? []).join(", "));
    }
  }, [settings]);

  const companyId = user?.organization.public_id ?? "company_…";

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload: WidgetSettings = {
        brand_name: brand,
        primary_color: color,
        greeting_message: welcome,
        support_email: supportEmail.trim() ? supportEmail.trim() : null,
        strict_mode: settings?.strict_mode ?? true,
        allowed_domains: domains
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean),
      };
      return updateWidgetSettings(payload);
    },
    onSuccess: () => {
      toast.success("Widget settings saved");
      queryClient.invalidateQueries({ queryKey: ["settings", "widget"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to save settings"),
  });

  const snippet = `<script
  src="${API_BASE_URL}/widget/script.js"
  data-company="${companyId}">
</script>`;

  return (
    <>
      <DashboardHeader
        title="Widget integration"
        description="Customize, preview and embed your assistant in minutes."
      />
      <div className="grid gap-6 p-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <CardHeader>
              <CardTitle>Install snippet</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <SnippetCard code={snippet} />
              <div className="text-sm text-muted-foreground">
                Paste this snippet just before{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">&lt;/body&gt;</code> on
                every page where you want the widget to appear.
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Branding</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
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
              <div className="space-y-1.5 sm:col-span-2">
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
              <div className="space-y-1.5">
                <Label>Allowed domains</Label>
                <Input
                  value={domains}
                  onChange={(e) => setDomains(e.target.value)}
                  placeholder="acme.com, help.acme.com"
                />
              </div>
              <Separator className="sm:col-span-2" />
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Company public ID</Label>
                <Input value={companyId} readOnly className="font-mono text-sm" />
              </div>
              <div className="sm:col-span-2">
                <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
                    </>
                  ) : (
                    "Save changes"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card className="sticky top-24">
            <CardHeader>
              <CardTitle>Live preview</CardTitle>
            </CardHeader>
            <CardContent>
              <WidgetPreview brandName={brand} primaryColor={color} welcomeMessage={welcome} />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
