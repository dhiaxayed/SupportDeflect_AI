/**
 * @file SSR adapter around TanStack Start's server entry. It lazily loads the framework
 * handler and converts only recognized catastrophic failures into the static recovery
 * document. Error normalization is request-local; no last-error value can leak across
 * concurrent users.
 */

import { renderErrorPage } from "./lib/error-page";

/**
 * Minimal Fetch-compatible shape expected from TanStack's dynamically imported server module;
 * env/ctx are forwarded without interpretation.
 */
type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

/**
 * Load and cache the framework module import once; share only the handler, never
 * request-specific responses or errors.
 */
async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
/**
 * Replace TanStack's specific unhandled HTTPError JSON sentinel with readable HTML. Preserve
 * unrelated JSON errors and non-server responses exactly as produced by the handler.
 */
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body: unknown = await response
    .clone()
    .json()
    .catch(() => null);
  if (
    !body ||
    typeof body !== "object" ||
    !("unhandled" in body) ||
    body.unhandled !== true ||
    !("message" in body) ||
    body.message !== "HTTPError"
  ) {
    return response;
  }

  console.error("SSR handler returned an unhandled server error");
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  /**
   * Delegate one Fetch request to TanStack, normalize its catastrophic response and catch
   * thrown failures with a static 500 recovery page.
   */
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
