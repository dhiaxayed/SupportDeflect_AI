/**
 * @file SSR adapter regressions with a stubbed TanStack entrypoint. Verify static recovery for
 * sentinel failures while preserving ordinary JSON errors and successful responses;
 * tests exercise request-local behavior without starting the production HTTP listener.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import server from "../server";

const { handler } = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock("@tanstack/react-start/server-entry", () => ({ default: { fetch: handler } }));

afterEach(() => vi.restoreAllMocks());

describe("SSR error boundary", () => {
  it("normalizes structured fatal errors without logging response payloads", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    handler.mockResolvedValue(
      new Response(
        JSON.stringify({ message: "HTTPError", unhandled: true, private: "private-data" }, null, 2),
        { status: 500, headers: { "content-type": "application/json" } },
      ),
    );
    const response = await server.fetch(new Request("http://localhost/"), undefined, undefined);
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).not.toContain("private-data");
    expect(log).toHaveBeenCalledExactlyOnceWith("SSR handler returned an unhandled server error");
  });

  it.each([
    [200, "text/html", "<main>Landing</main>"],
    [404, "application/json", '{"detail":"Missing"}'],
    [500, "application/json", '{"detail":"Application error"}'],
    [500, "application/json", "invalid-json"],
  ])("preserves other responses (%i %s)", async (status, type, body) => {
    const original = new Response(body, { status, headers: { "content-type": type } });
    handler.mockResolvedValue(original);
    const response = await server.fetch(new Request("http://localhost/"), undefined, undefined);
    expect(response).toBe(original);
    expect(await response.text()).toBe(body);
  });
});
