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
  logout,
  apiRequest,
} from "@/lib/api";

/** Allow each test to choose the exact order in which network requests complete. */
function controlledFetch() {
  const finish: ((response: Response) => void)[] = [];
  const fetch = vi.fn(() => new Promise<Response>((resolve) => finish.push(resolve)));
  vi.stubGlobal("fetch", fetch);
  return { fetch, finish };
}

/** Encode a synthetic authentication result without contacting an account service. */
function sessionResponse(token: string) {
  return new Response(JSON.stringify({ access_token: token, user: { role: "tenant_admin" } }));
}

describe("API contracts", () => {
  it("lets the latest login finish after an earlier request returns an expired-session response", async () => {
    setToken("expired");
    const { finish } = controlledFetch();
    const oldRequest = getSubscriptionUsage();
    const rejected = expect(oldRequest).rejects.toThrow();
    const signingIn = login("new@example.com", "password");
    finish[0](new Response("{}", { status: 401 }));
    await rejected;
    finish[1](sessionResponse("fresh"));
    await signingIn;
    expect(getToken()).toBe("fresh");
  });
  it("marks an older authentication failure as superseded while the latest login is pending", async () => {
    clearToken();
    const { finish } = controlledFetch();
    const older = login("older@example.com", "wrong-password");
    const rejected = expect(older).rejects.toMatchObject({ name: "SessionChangedError" });
    const newer = login("newer@example.com", "password");
    finish[0](new Response("{}", { status: 401 }));
    await rejected;
    finish[1](sessionResponse("latest"));
    await newer;
    expect(getToken()).toBe("latest");
  });
  it("identifies a failed fetch from an obsolete session before account cleanup can run", async () => {
    setToken("old");
    let fail!: (error: Error) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((_, reject) => (fail = reject))),
    );
    const request = login("old@example.com", "password");
    const rejected = expect(request).rejects.toMatchObject({ name: "SessionChangedError" });
    setToken("new");
    fail(new Error("Connection interrupted"));
    await rejected;
    expect(getToken()).toBe("new");
  });
  it.each(["older-first", "newer-first"])(
    "keeps the latest login when %s completes",
    async (order) => {
      clearToken();
      const { finish } = controlledFetch();
      const older = login("older@example.com", "password");
      const rejected = expect(older).rejects.toThrow("Session changed");
      const newer = login("newer@example.com", "password");
      if (order === "older-first") {
        finish[0](sessionResponse("older"));
        await rejected;
        expect(getToken()).toBeNull();
        finish[1](sessionResponse("newer"));
      } else {
        finish[1](sessionResponse("newer"));
        await newer;
        finish[0](sessionResponse("older"));
      }
      await newer;
      await rejected;
      expect(getToken()).toBe("newer");
    },
  );
  it.each([true, false])(
    "orders registration and login together (registration first: %s)",
    async (registrationFirst) => {
      clearToken();
      const { finish } = controlledFetch();
      /** Start either public authentication flow under the shared sequencing rule. */
      const start = (registration: boolean) =>
        registration
          ? register({
              organization_name: "New org",
              admin_email: "new@example.com",
              password: "password",
            })
          : login("account@example.com", "password");
      const older = start(registrationFirst);
      const rejected = expect(older).rejects.toThrow("Session changed");
      const newer = start(!registrationFirst);
      finish[1](sessionResponse("latest"));
      await newer;
      finish[0](sessionResponse("obsolete"));
      await rejected;
      expect(getToken()).toBe("latest");
    },
  );
  it("does not restore a pending anonymous login after logout", async () => {
    clearToken();
    const { finish } = controlledFetch();
    const pending = login("account@example.com", "password");
    const rejected = expect(pending).rejects.toThrow("Session changed");
    logout();
    finish[0](sessionResponse("cancelled"));
    await rejected;
    expect(getToken()).toBeNull();
  });
  it("rejects a response initiated anonymously when another request signs in", async () => {
    clearToken();
    const { finish } = controlledFetch();
    const anonymous = apiRequest("/settings/widget");
    const rejected = expect(anonymous).rejects.toThrow("Session changed");
    setToken("signed-in");
    finish[0](new Response(JSON.stringify({ private: "outdated" })));
    await rejected;
  });
  it("detects a logout/login cycle even if the same token is restored", async () => {
    setToken("same-token");
    const { finish } = controlledFetch();
    const pending = getWidgetSettings();
    const rejected = expect(pending).rejects.toThrow("Session changed");
    logout();
    setToken("same-token");
    finish[0](new Response("{}"));
    await rejected;
  });
  it("rejects a login superseded by a cross-tab session event", async () => {
    clearToken();
    const { finish } = controlledFetch();
    const pending = login("account@example.com", "password");
    const rejected = expect(pending).rejects.toThrow("Session changed");
    window.localStorage.setItem("supportdeflect_admin_token", "other-tab");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "supportdeflect_admin_token", storageArea: localStorage }),
    );
    finish[0](sessionResponse("obsolete"));
    await rejected;
    expect(getToken()).toBe("other-tab");
  });
  it("does not clear a valid account when a new login has invalid credentials", async () => {
    setToken("valid-session");
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    await expect(login("wrong@example.com", "incorrect")).rejects.toThrow();
    expect(new Headers(fetch.mock.calls[0][1].headers).has("Authorization")).toBe(false);
    expect(getToken()).toBe("valid-session");
  });
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
