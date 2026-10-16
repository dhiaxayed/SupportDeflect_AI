/**
 * @file Disposable browser-test infrastructure, not an application development server.
 * Discover the repository, create a fresh SQLite/assets directory, seed synthetic accounts and
 * launch FastAPI with explicit mock AI/fake embeddings. A separate plain HTTP client host
 * accepts the tested install snippet and serves hostile CSS to verify widget isolation;
 * signal/child-exit handlers shut down both services.
 */

import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";

let root = resolve(".");
while (!existsSync(join(root, ".git")) && dirname(root) !== root) root = dirname(root);
const backend = join(root, "backend");
const fixture = mkdtempSync(join(tmpdir(), "supportdeflect-e2e-"));
const localPython = join(
  root,
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
const python = process.env.E2E_PYTHON || (existsSync(localPython) ? localPython : "python");
const env = {
  ...process.env,
  ENVIRONMENT: "test",
  DATABASE_URL: "sqlite:///" + join(fixture, "admin_e2e.db").replaceAll("\\", "/"),
  SECRET_KEY: "fixture-only-secret-never-used-outside-e2e-12345",
  LLM_PROVIDER: "mock",
  EMBEDDING_PROVIDER: "fake",
  VECTOR_PROVIDER: "database",
  RATE_LIMIT_PROVIDER: "memory",
  INGESTION_MODE: "inline",
  INIT_DATABASE_ON_STARTUP: "false",
  ADMIN_RATE_LIMIT_PER_MINUTE: "2000",
  WIDGET_RATE_LIMIT_PER_MINUTE: "200",
  ENFORCE_TRUSTED_HOSTS: "false",
  WIDGET_ASSETS_DIRECTORY: join(fixture, "assets"),
  MAILER_SERVICE_TOKEN: "fixture-only-mailer-token-at-least-32-characters",
  FRONTEND_URL: "http://127.0.0.1:5175",
};
const seed = spawnSync(python, ["scripts/seed_admin_e2e.py"], {
  cwd: backend,
  env,
  stdio: "inherit",
});
if (seed.status !== 0) process.exit(seed.status || 1);
const api = spawn(
  python,
  ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8020"],
  { cwd: backend, env, stdio: "inherit" },
);
// This separate HTTP server has no React, application CSS, cookies or build step.
let snippet =
  '<script defer src="http://127.0.0.1:8020/api/v1/widget/script.js" data-company="company_e2e_0"></script>';
const client = createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/snippet") {
    let body = "";
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 2000) {
        response.writeHead(413);
        response.end();
        return;
      }
    }
    snippet = body;
    response.writeHead(204);
    response.end();
    return;
  }
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(
    readFileSync(new URL("./client.html", import.meta.url), "utf8").replace(
      "<!-- WIDGET_SNIPPET -->",
      snippet,
    ),
  );
}).listen(8055, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    api.kill();
    client.close();
  });
api.on("exit", (code) => {
  client.close();
  process.exit(code || 0);
});
