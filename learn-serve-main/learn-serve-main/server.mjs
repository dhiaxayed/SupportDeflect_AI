import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
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
};

function getStaticPath(pathname) {
  const decodedPath = decodeURIComponent(pathname);
  const normalizedPath = normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(join(clientDir, normalizedPath));
  if (!filePath.startsWith(clientDir)) return undefined;
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return undefined;
  return filePath;
}

function sendStatic(res, filePath) {
  const extension = extname(filePath);
  res.writeHead(200, {
    "content-type": contentTypes[extension] ?? "application/octet-stream",
    "cache-control": filePath.includes(`${normalize("/assets/")}`) ? "public, max-age=31536000, immutable" : "no-cache",
  });
  createReadStream(filePath).pipe(res);
}

function createRequest(req) {
  const protocol = req.headers["x-forwarded-proto"] ?? "http";
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
    console.error(error);
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Internal Server Error");
  }
}).listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
});
