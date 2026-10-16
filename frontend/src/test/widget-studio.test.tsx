/**
 * @file Widget Studio race regressions using deferred upload/save promises and the actual
 * registered route component. Verify that upload completion preserves later design/content
 * edits and that save-pending controls unlock after failure. Mock only external
 * hooks/preview/transport boundaries to keep the form logic under test.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route } from "@/routes/dashboard.widget";
import { defaultDesign } from "@/lib/widget-design";
import type { WidgetSettings } from "@/lib/api";

/** Use the registered component so production route splitting needs no test-only named export. */
const WidgetStudio = Route.options.component as React.ComponentType;

const mocks = vi.hoisted(() => ({ upload: vi.fn(), save: vi.fn() }));
const settings: WidgetSettings = {
  brand_name: "Acme",
  primary_color: "#2563eb",
  greeting_message: "Welcome!",
  support_email: null,
  strict_mode: true,
  allowed_domains: ["acme.example"],
  design: defaultDesign,
};
vi.mock("@/hooks/use-data", () => ({
  /**
   * Provide one complete saved configuration so the tests can compare later local drafts
   * against a stable server baseline.
   */
  useWidgetSettings: () => ({ data: settings, isPending: false, isError: false }),
}));
vi.mock("@/hooks/use-auth", () => ({
  /**
   * Supply the synthetic public company ID needed to render an install snippet without running
   * the authentication workflow.
   */
  useCurrentUser: () => ({ data: { organization: { public_id: "company_acme" } } }),
}));
vi.mock("@/components/dashboard-header", () => ({
  /**
   * Retain the real Studio action controls while replacing unrelated account/header chrome in
   * the focused form test.
   */
  DashboardHeader: ({ actions }: { actions: React.ReactNode }) => <header>{actions}</header>,
}));
vi.mock("@/components/widget-preview", () => ({
  /**
   * Exclude iframe networking from form-state tests; shared-renderer behavior is covered by
   * the browser widget journey.
   */
  WidgetPreview: () => <div aria-label="Widget preview" />,
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  /**
   * Expose the deferred logo-upload transport spy so later form edits can occur before its
   * response arrives.
   */
  apiRequest: (...args: unknown[]) => mocks.upload(...args),
  /**
   * Capture the final submitted settings and allow save completion/failure to be controlled
   * independently.
   */
  updateWidgetSettings: (...args: unknown[]) => mocks.save(...args),
}));

beforeEach(() => vi.clearAllMocks());
/**
 * Render the route's actual component under a fresh QueryClientProvider so save-cache updates
 * execute normally.
 */
const show = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <WidgetStudio />
    </QueryClientProvider>,
  );

describe("Widget Studio asynchronous drafts", () => {
  it("merges a completed logo upload into edits made while the upload was pending", async () => {
    let finish!: (value: { logo_path: string }) => void;
    mocks.upload.mockImplementation(
      () => new Promise<{ logo_path: string }>((resolve) => (finish = resolve)),
    );
    mocks.save.mockImplementation(async (value: WidgetSettings) => value);
    show();
    const user = userEvent.setup();
    await user.upload(
      screen.getByLabelText("Upload logo"),
      new File(["logo"], "logo.png", { type: "image/png" }),
    );
    await user.clear(screen.getByLabelText("Window width"));
    await user.type(screen.getByLabelText("Window width"), "430");
    await user.click(screen.getByRole("tab", { name: "Content" }));
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Updated during upload");
    finish({ logo_path: "/api/v1/widget/assets/new_logo.png" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save design" })).toBeEnabled());
    expect(screen.getByLabelText("Title")).toHaveValue("Updated during upload");
    await user.click(screen.getByRole("button", { name: "Save design" }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith(
        expect.objectContaining({
          brand_name: "Updated during upload",
          design: expect.objectContaining({
            width: 430,
            identity: "custom",
            logo_path: "/api/v1/widget/assets/new_logo.png",
          }),
        }),
      ),
    );
  });

  it("locks submitted fields while a save is pending and unlocks them after failure", async () => {
    let fail!: (reason: Error) => void;
    mocks.save.mockImplementation(() => new Promise((_, reject) => (fail = reject)));
    show();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Save design" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(screen.getByLabelText("Window width")).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Content" })).toBeDisabled();
    fail(new Error("Network interrupted"));
    await waitFor(() => expect(screen.getByLabelText("Window width")).toBeEnabled());
  });
});
