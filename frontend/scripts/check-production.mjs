/**
 * @file Executable smoke check for the built frontend container entrypoint. Start an isolated
 * loopback production server, verify SSR landing/login HTML, local font delivery and
 * malformed-URL handling, and terminate the child in finally. This checks production serving
 * rather than the Vite development path.
 */

import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";

// Exercise the same server entrypoint used by the frontend container after build.
const port = "3010";
const child = spawn(process.execPath, ["server.mjs"], {
  env: { ...process.env, PORT: port, HOST: "127.0.0.1", NODE_ENV: "production" },
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
try {
  await Promise.race([
    once(child.stdout, "data", { signal: AbortSignal.timeout(15000) }),
    once(child, "exit").then(() => {
      throw new Error("Production server exited before readiness");
    }),
  ]);
  const home = await fetch(`http://127.0.0.1:${port}/`, { redirect: "manual" });
  assert.equal(home.status, 200);
  assert.match(await home.text(), /<h1[^>]*>Your knowledge\./);
  const login = await fetch(`http://127.0.0.1:${port}/login`);
  assert.equal(login.status, 200);
  assert.match(await login.text(), /SupportDeflect/);
  const registration = await fetch(`http://127.0.0.1:${port}/register`);
  assert.equal(registration.status, 200);
  assert.match(await registration.text(), /Create your workspace/);
  const font = (await readdir("dist/client/assets")).find(
    (name) => name.startsWith("instrument-sans-latin-wght-normal") && name.endsWith(".woff2"),
  );
  assert.ok(font);
  const asset = await fetch(`http://127.0.0.1:${port}/assets/${font}`);
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get("content-type"), "font/woff2");
  assert.ok((await asset.arrayBuffer()).byteLength > 1000);
  const widget = await fetch(`http://127.0.0.1:${port}/demo/widget/script.js`);
  assert.equal(widget.status, 200);
  assert.match(widget.headers.get("content-type"), /javascript/);
  assert.ok(
    Buffer.from(await widget.arrayBuffer()).equals(await readFile("public/demo/widget/script.js")),
    "The production demo must serve the unchanged widget renderer",
  );
  const malformed = await fetch(`http://127.0.0.1:${port}/%ZZ`);
  assert.equal(malformed.status, 400);
  console.info(
    "Production SSR, public forms, local font, exact demo renderer delivery and malformed-URL checks passed.",
  );
} finally {
  if (child.exitCode === null) {
    const exited = once(child, "exit");
    child.kill();
    await exited;
  }
}
