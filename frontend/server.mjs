/**
 * @file Production Node HTTP entry used by the frontend container after vite build. Serve
 * files only inside dist/client, adapt remaining Node requests to the Fetch interface consumed
 * by dist/server/server.js, then stream its response. Proxy HTTPS metadata is honored only
 * from the configured trusted proxy address.
 */

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { Readable } from "node:stream";

import handler from "./dist/server/server.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const clientDir = resolve("dist/client");

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ico": "image/x-icon",
};

/**
 * Decode and normalize a URL path, then return only an existing regular file strictly inside
 * dist/client. Invalid escapes throw URIError for the request adapter to return 400.
 */
function getStaticPath(pathname) {
  const decodedPath = decodeURIComponent(pathname);
  const normalizedPath = normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(join(clientDir, normalizedPath));
  if (!filePath.startsWith(clientDir + sep)) return undefined;
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return undefined;
  return filePath;
}

/**
 * Stream a known build asset with its MIME type; fingerprinted assets are immutable, while
 * other static files require revalidation.
 */
function sendStatic(res, filePath) {
  const extension = extname(filePath);
  res.writeHead(200, {
    "content-type": contentTypes[extension] ?? "application/octet-stream",
    "cache-control": filePath.includes(`${normalize("/assets/")}`)
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  });
  createReadStream(filePath).pipe(res);
}

/**
 * Translate Node headers and request streams into a Fetch Request. Forwarded HTTPS is trusted
 * only from TRUSTED_PROXY_IP; non-GET/HEAD bodies use Node's required half-duplex option.
 */
function createRequest(req) {
  const remote = req.socket.remoteAddress?.replace(/^::ffff:/, "");
  const protocol =
    remote === process.env.TRUSTED_PROXY_IP && req.headers["x-forwarded-proto"] === "https"
      ? "https"
      : "http";
  const hostHeader = req.headers.host ?? `localhost:${port}`;
  const url = `${protocol}://${hostHeader}${req.url ?? "/"}`;
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  return new Request(url, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : Readable.toWeb(req),
    duplex: req.method === "GET" || req.method === "HEAD" ? undefined : "half",
  });
}

createServer(async (req, res) => {
  try {
    const staticPath = getStaticPath(new URL(req.url ?? "/", "http://localhost").pathname);
    if (staticPath) {
      sendStatic(res, staticPath);
      return;
    }

    const response = await handler.fetch(createRequest(req), process.env, {});
    res.writeHead(response.status, Object.fromEntries(response.headers));

    if (!response.body || req.method === "HEAD") {
      res.end();
      return;
    }

    Readable.fromWeb(response.body).pipe(res);
  } catch (error) {
    if (error instanceof URIError) {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end("Invalid URL");
      return;
    }
    console.error(error);
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Internal Server Error");
  }
}).listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
});
