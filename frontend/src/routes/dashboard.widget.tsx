/**
 * @file Tenant Widget Design Studio connecting draft form state, saved settings, local logo
 * uploads and the real iframe renderer. One normalized configuration is persisted and
 * previewed; upload completion merges into the latest draft, and submitted controls lock while
 * saving so responses cannot discard later edits.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, RotateCcw, Upload, Loader2, Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { WidgetPreview } from "@/components/widget-preview";
import { DashboardHeader } from "@/components/dashboard-header";
import { Button } from "@/components/ui/button";
import { useWidgetSettings } from "@/hooks/use-data";
import { useCurrentUser } from "@/hooks/use-auth";
import { apiRequest, publicApiUrl, updateWidgetSettings, type WidgetSettings } from "@/lib/api";
import { defaultDesign, type WidgetDesign } from "@/lib/widget-design";
import "@/widget-studio.css";

export const Route = createFileRoute("/dashboard/widget")({
  /**
   * Set the Studio browser title while inheriting shared account-shell metadata.
   */
  head: () => ({ meta: [{ title: "Widget Design Studio - SupportDeflect AI" }] }),
  component: WidgetStudio,
});

/**
 * Own configuration/domain drafts, tab state and upload/save lifecycle; render controls, exact
 * installation snippet and shared preview from the same current design.
 */
function WidgetStudio() {
  const query = useWidgetSettings();
  const { data: user } = useCurrentUser();
  const cache = useQueryClient();
  const [draft, setDraft] = useState<WidgetSettings | null>(null);
  const [domains, setDomains] = useState<string | null>(null);
  const [tab, setTab] = useState("Appearance");
  const [uploading, setUploading] = useState(false);
  const current = draft ?? query.data;
  const design = { ...defaultDesign, ...current?.design };
  /**
   * Merge top-level branding changes into the latest draft, preserving other edits made since
   * a callback was created.
   */
  const patch = (value: Partial<WidgetSettings>) =>
    current && setDraft((latest) => ({ ...(latest ?? current), ...value }));
  /**
   * Merge design-only edits into the newest settings plus defaults; asynchronous logo
   * completion must not restore a stale snapshot.
   */
  const changeDesign = (value: Partial<WidgetDesign>) => {
    if (!current) return;
    // Upload completion can arrive after more edits; merge into the current draft, not its old closure.
    setDraft((latest) => {
      const settings = latest ?? current;
      return { ...settings, design: { ...defaultDesign, ...settings.design, ...value } };
    });
  };
  const domainText = domains ?? current?.allowed_domains.join(", ") ?? "";
  const dirty =
    JSON.stringify(draft ?? query.data) !== JSON.stringify(query.data) ||
    (domains !== null && domains !== query.data?.allowed_domains.join(", "));
  const save = useMutation({
    /**
     * Submit the current configuration with trimmed nonempty hostname entries; the backend
     * validates domains, dimensions, colors and logo ownership.
     */
    mutationFn: () =>
      updateWidgetSettings({
        ...current!,
        design,
        allowed_domains: domainText
          .split(/[\n,]/)
          .map((v) => v.trim())
          .filter(Boolean),
      }),
    /**
     * Adopt the backend-normalized configuration in both cache and draft, clear the separate
     * domain draft and confirm the saved state.
     */
    onSuccess: (result) => {
      cache.setQueryData(["settings", "widget"], result);
      setDraft(result);
      setDomains(null);
      toast.success("Widget design saved");
    },
    /**
     * Present save failure without discarding the administrator's unsaved configuration.
     */
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Unable to save design"),
  });
  const snippet =
    '<script defer src="' +
    publicApiUrl() +
    '/widget/script.js" data-company="' +
    (user?.organization?.public_id ?? "") +
    '"></script>';
  /**
   * Copy the exact public installation snippet when Clipboard API access is available; provide
   * a manual-selection fallback message on unsupported HTTP contexts.
   */
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      toast.success("Snippet copied");
    } catch {
      toast.error("Clipboard unavailable. Select the snippet to copy it.");
    }
  };
  /**
   * Create a standalone client HTML file containing the same snippet so integration can be
   * inspected on an independent host.
   */
  const download = () => {
    const html =
      '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Client integration</title><body><main><h1>Client website</h1></main>' +
      snippet +
      "</body></html>";
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "supportdeflect-client.html";
    a.click();
    URL.revokeObjectURL(url);
  };
  /**
   * Accept only bounded PNG/JPEG/WebP selections before multipart upload, then merge the
   * returned tenant-owned PNG asset path into the current design. The server still decodes,
   * sanitizes and validates ownership.
   */
  const upload = async (file?: File) => {
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 2 * 1024 * 1024
    ) {
      toast.error("Choose a PNG, JPEG or WebP image up to 2 MB");
      return;
    }
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const result = await apiRequest<{ logo_path: string }>("/settings/widget/logo", {
        method: "POST",
        body,
      });
      changeDesign({ identity: "custom", logo_path: result.logo_path });
      toast.success("Logo uploaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  if (query.isPending)
    return (
      <div className="p-8" role="status">
        Loading widget settings...
      </div>
    );
  if (query.isError || !current)
    return (
      <div className="p-8" role="alert">
        <p>Unable to load widget settings.</p>
        <button onClick={() => query.refetch()}>Retry</button>
      </div>
    );
  return (
    <div className="widget-studio">
      <DashboardHeader
        title="Widget Design Studio"
        description="Customize, preview and embed your support assistant."
        actions={
          <div className="studio-actions">
            <span role="status">{dirty ? "Unsaved changes" : "Saved"}</span>
            <Button
              variant="outline"
              size="icon"
              type="button"
              title="Discard changes"
              aria-label="Discard changes"
              disabled={!dirty || save.isPending || uploading}
              onClick={() => {
                setDraft(null);
                setDomains(null);
              }}
            >
              <RotateCcw size={18} />
            </Button>
            <Button form="widget-design-form" type="submit" disabled={save.isPending || uploading}>
              {save.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}{" "}
              Save design
            </Button>
          </div>
        }
      />
      <div className="studio-layout">
        <form
          id="widget-design-form"
          className="studio-controls"
          onSubmit={(e) => {
            e.preventDefault();
            if (!save.isPending && !uploading) save.mutate();
          }}
        >
          {/* Prevent the saved response from replacing edits made during its request. */}
          <fieldset disabled={save.isPending} className="min-w-0 border-0 p-0">
            <nav role="tablist" aria-label="Widget settings">
              {["Appearance", "Content", "Install"].map((t) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  key={t}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
            </nav>
            <div role="tabpanel" aria-label={tab} className="studio-fields">
              {tab === "Appearance" && (
                <>
                  <section>
                    <h2>Identity</h2>
                    <label>
                      Widget identity
                      <select
                        value={design.identity}
                        onChange={(e) =>
                          changeDesign({ identity: e.target.value as WidgetDesign["identity"] })
                        }
                      >
                        <option value="default">SupportDeflectAI icon</option>
                        <option value="robot">Robot</option>
                        <option value="custom" disabled={!design.logo_path}>
                          Custom logo
                        </option>
                      </select>
                    </label>
                    <label className="studio-upload">
                      <Upload size={16} />
                      {uploading ? "Uploading..." : "Upload logo"}
                      <input
                        aria-label="Upload logo"
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        disabled={uploading}
                        onChange={(e) => {
                          void upload(e.target.files?.[0]);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    {design.logo_path && (
                      <img
                        className="studio-logo"
                        alt="Uploaded logo"
                        src={new URL(design.logo_path, publicApiUrl()).href}
                      />
                    )}
                    <Numeric
                      label="Header logo size"
                      value={design.logo_size}
                      min={20}
                      max={56}
                      onChange={(v) => changeDesign({ logo_size: v })}
                    />
                  </section>
                  <section>
                    <h2>Color & theme</h2>
                    <label>
                      Theme
                      <select
                        value={design.theme}
                        onChange={(e) =>
                          changeDesign({ theme: e.target.value as WidgetDesign["theme"] })
                        }
                      >
                        <option value="light">Light</option>
                        <option value="dark">Dark</option>
                        <option value="system">System</option>
                      </select>
                    </label>
                    <label className="studio-color">
                      Accent color
                      <input
                        aria-label="Accent color"
                        type="color"
                        value={current.primary_color}
                        onChange={(e) => patch({ primary_color: e.target.value })}
                      />
                      <span>{current.primary_color}</span>
                    </label>
                    <label className="studio-color">
                      Light background
                      <input
                        type="color"
                        value={design.background_color}
                        onChange={(e) => changeDesign({ background_color: e.target.value })}
                      />
                      <span>{design.background_color}</span>
                    </label>
                    <label className="studio-color">
                      Light text
                      <input
                        type="color"
                        value={design.text_color}
                        onChange={(e) => changeDesign({ text_color: e.target.value })}
                      />
                      <span>{design.text_color}</span>
                    </label>
                  </section>
                  <section>
                    <h2>Size & placement</h2>
                    <label>
                      Position
                      <select
                        value={design.position}
                        onChange={(e) =>
                          changeDesign({ position: e.target.value as WidgetDesign["position"] })
                        }
                      >
                        <option value="bottom-right">Bottom right</option>
                        <option value="bottom-left">Bottom left</option>
                      </select>
                    </label>
                    <div className="studio-pair">
                      <Numeric
                        label="Window width"
                        value={design.width}
                        min={280}
                        max={640}
                        onChange={(v) => changeDesign({ width: v })}
                      />
                      <Numeric
                        label="Window height"
                        value={design.height}
                        min={320}
                        max={800}
                        onChange={(v) => changeDesign({ height: v })}
                      />
                      <Numeric
                        label="Launcher size"
                        value={design.launcher_size}
                        min={40}
                        max={88}
                        onChange={(v) => changeDesign({ launcher_size: v })}
                      />
                      <Numeric
                        label="Corner radius"
                        value={design.radius}
                        min={0}
                        max={32}
                        onChange={(v) => changeDesign({ radius: v })}
                      />
                      <Numeric
                        label="Horizontal spacing"
                        value={design.offset_x}
                        min={8}
                        max={80}
                        onChange={(v) => changeDesign({ offset_x: v })}
                      />
                      <Numeric
                        label="Bottom spacing"
                        value={design.offset_y}
                        min={8}
                        max={80}
                        onChange={(v) => changeDesign({ offset_y: v })}
                      />
                    </div>
                  </section>
                </>
              )}
              {tab === "Content" && (
                <>
                  <section>
                    <h2>Conversation</h2>
                    <label>
                      Title
                      <input
                        value={current.brand_name}
                        maxLength={120}
                        required
                        onChange={(e) => patch({ brand_name: e.target.value })}
                      />
                    </label>
                    <label>
                      Subtitle
                      <input
                        value={design.subtitle}
                        maxLength={80}
                        onChange={(e) => changeDesign({ subtitle: e.target.value })}
                      />
                    </label>
                    <label>
                      Welcome message
                      <textarea
                        aria-label="Welcome message"
                        rows={4}
                        value={current.greeting_message}
                        maxLength={500}
                        required
                        onChange={(e) => patch({ greeting_message: e.target.value })}
                      />
                    </label>
                    <label>
                      Input placeholder
                      <input
                        value={design.placeholder}
                        maxLength={100}
                        required
                        onChange={(e) => changeDesign({ placeholder: e.target.value })}
                      />
                    </label>
                    <label>
                      Support email
                      <input
                        type="email"
                        value={current.support_email ?? ""}
                        onChange={(e) => patch({ support_email: e.target.value || null })}
                      />
                    </label>
                    <label className="studio-check">
                      <input
                        type="checkbox"
                        checked={current.strict_mode}
                        onChange={(e) => patch({ strict_mode: e.target.checked })}
                      />
                      Strict knowledge grounding
                    </label>
                  </section>
                  <section>
                    <h2>Opening behavior</h2>
                    <label>
                      Initial state
                      <select
                        value={design.open_behavior}
                        onChange={(e) =>
                          changeDesign({
                            open_behavior: e.target.value as WidgetDesign["open_behavior"],
                          })
                        }
                      >
                        <option value="closed">Closed</option>
                        <option value="open">Open</option>
                        <option value="delayed">Open after a delay</option>
                      </select>
                    </label>
                    {design.open_behavior === "delayed" && (
                      <Numeric
                        label="Delay (seconds)"
                        value={design.open_delay_seconds}
                        min={1}
                        max={60}
                        unit="s"
                        onChange={(v) => changeDesign({ open_delay_seconds: v })}
                      />
                    )}
                  </section>
                </>
              )}
              {tab === "Install" && (
                <>
                  <section>
                    <h2>Website access</h2>
                    <label>
                      Allowed hostnames
                      <textarea
                        aria-label="Allowed hostnames"
                        value={domainText}
                        rows={4}
                        placeholder="example.com, localhost"
                        onChange={(e) => setDomains(e.target.value)}
                      />
                    </label>
                    <label>
                      Company ID
                      <input readOnly value={user?.organization?.public_id ?? ""} />
                    </label>
                  </section>
                  <section>
                    <h2>Embed snippet</h2>
                    <pre className="studio-snippet">
                      <code>{snippet}</code>
                    </pre>
                    <div className="studio-install-actions">
                      <button type="button" onClick={copy}>
                        <Copy size={16} />
                        Copy snippet
                      </button>
                      <button type="button" onClick={download}>
                        <Download size={16} />
                        Client HTML
                      </button>
                    </div>
                  </section>
                </>
              )}
            </div>
          </fieldset>
        </form>
        <WidgetPreview settings={{ ...current, design }} />
      </div>
    </div>
  );
}

/**
 * Render one labeled integer design field with its API-aligned min/max and displayed unit;
 * forward numeric edits to the controlled draft.
 */
function Numeric({
  label,
  value,
  min,
  max,
  unit = "px",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      {label}
      <div className="studio-number">
        <input
          aria-label={label}
          type="number"
          value={value}
          min={min}
          max={max}
          step={1}
          required
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span>{unit}</span>
      </div>
    </label>
  );
}
