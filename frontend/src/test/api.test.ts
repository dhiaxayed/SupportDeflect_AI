/**
 * @file Shared API-client regressions using synthetic responses and browser tokens. Cover
 * authentication/session notifications, structured quota failures, unchanged login/register
 * contracts, stale-success/401 races, streamed export isolation and widget-settings round
 * trips. These transport tests isolate network timing rather than asserting a live backend is
 * available.
 */

import { describe, expect, it, vi } from "vitest";
import { downloadLedger } from "@/lib/admin-api";
import {
  getToken,
  setToken,
  clearToken,
  subscribeSession,
  apiResponse,
  login,
  register,
  getSubscriptionUsage,
  homeForRole,
  updateWidgetSettings,
  getWidgetSettings,
  publicApiUrl,
} from "@/lib/api";
describe("API contracts", () => {
  it("notifies same-tab and cross-tab session changes and unsubscribes cleanly", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSession(listener);
    setToken("new-account");
    clearToken();
    window.dispatchEvent(new StorageEvent("storage", { key: "supportdeflect_admin_token" }));
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    setToken("after-unsubscribe");
    expect(listener).toHaveBeenCalledTimes(3);
  });
  it("stores the token after login and sends the expected credentials", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ access_token: "test-token", user: { role: "tenant_admin" } }),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    await login("user@example.com", "password");
    expect(getToken()).toBe("test-token");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      email: "user@example.com",
      password: "password",
    });
  });
  it("registers an organization and stores the returned token", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ access_token: "new-token" })));
    vi.stubGlobal("fetch", fetch);
    await register({
      organization_name: "Acme",
      admin_email: "user@example.com",
      password: "password",
    });
    expect(fetch.mock.calls[0][0]).toBe("/api/v1/auth/register");
    expect(getToken()).toBe("new-token");
  });
  it("shows structured quota errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ detail: { message: "Trial expired" } }), { status: 402 }),
        ),
    );
    await expect(getSubscriptionUsage()).rejects.toThrow("Trial expired");
  });
  it("clears an expired token", async () => {
    window.localStorage.setItem("supportdeflect_admin_token", "expired");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    await expect(getSubscriptionUsage()).rejects.toThrow();
    expect(getToken()).toBeNull();
  });
  it("does not let a late unauthorized response clear a newer session", async () => {
    setToken("old-session");
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const request = getSubscriptionUsage();
    setToken("new-session");
    finish(new Response("{}", { status: 401 }));
    await expect(request).rejects.toThrow();
    expect(getToken()).toBe("new-session");
  });
  it("rejects an old account's successful response after a session switch", async () => {
    setToken("old-session");
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (finish = resolve))),
    );
    const request = getWidgetSettings();
    setToken("new-session");
    finish(new Response(JSON.stringify({ brand_name: "Old tenant private settings" })));
    await expect(request).rejects.toThrow("Session changed");
    expect(getToken()).toBe("new-session");
  });
  it("rejects old account data when the session changes while its body is being decoded", async () => {
    setToken("old-session");
    let finish!: (value: unknown) => void;
    let decoding!: () => void;
    const started = new Promise<void>((resolve) => (decoding = resolve));
    const response = new Response();
    response.json = () => {
      decoding();
      return new Promise((resolve) => (finish = resolve));
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const request = getWidgetSettings();
    await started;
    setToken("new-session");
    finish({ brand_name: "Old tenant private settings" });
    await expect(request).rejects.toThrow("Session changed");
    expect(getToken()).toBe("new-session");
  });
  it("rejects an old account's ledger while the export body is still streaming", async () => {
    setToken("old-session");
    let finish!: (value: Blob) => void;
    let reading!: () => void;
    const started = new Promise<void>((resolve) => (reading = resolve));
    const response = new Response();
    response.blob = () => {
      reading();
      return new Promise<Blob>((resolve) => (finish = resolve));
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const download = downloadLedger(30, "EUR");
    await started;
    setToken("new-session");
    finish(new Blob(["id,amount\nprivate,100\n"]));
    await expect(download).rejects.toThrow("Session changed");
    expect(getToken()).toBe("new-session");
  });
  it("routes each role to its workspace", () => {
    expect(homeForRole("super_admin")).toBe("/platform");
    expect(homeForRole("tenant_admin")).toBe("/dashboard");
    expect(homeForRole("support_agent")).toBe("/dashboard/inbox");
  });
  it("saves and retrieves widget settings", async () => {
    const settings = {
      brand_name: "Acme",
      primary_color: "#123456",
      greeting_message: "Hello",
      support_email: null,
      strict_mode: true,
      allowed_domains: ["acme.example"],
    };
    const fetch = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify(settings))));
    vi.stubGlobal("fetch", fetch);
    expect(await updateWidgetSettings(settings)).toEqual(settings);
    expect(fetch.mock.calls[0][1].method).toBe("PUT");
    expect(await getWidgetSettings()).toEqual(settings);
  });
  it("makes external embed URLs absolute", () => {
    expect(publicApiUrl()).toMatch(/^http.*\/api\/v1$/);
  });
  it("uses the same expired-session handling for ledger downloads", async () => {
    window.localStorage.setItem("supportdeflect_admin_token", "expired");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ detail: "Session expired" }), { status: 401 }),
        ),
    );
    await expect(downloadLedger(30, "EUR")).rejects.toThrow("Session expired");
    expect(getToken()).toBeNull();
  });
  it("preserves binary and CSV response bodies", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("id,amount\n1,100\n"));
    vi.stubGlobal("fetch", fetch);
    window.localStorage.setItem("supportdeflect_admin_token", "current");
    const response = await apiResponse("/platform/billing/export");
    expect(await response.text()).toBe("id,amount\n1,100\n");
    expect(fetch.mock.calls[0][1].headers.get("Authorization")).toBe("Bearer current");
  });
});
