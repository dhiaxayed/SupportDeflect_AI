/** Check escaped invitation content, MIME composition and conservative delivery outcomes.
 * Stream transports avoid real mail. Two ephemeral loopback HTTP servers verify
 * privileged POST handling and cross-origin redirect refusal with synthetic tokens.
 * These tests do not prove delivery through an external SMTP provider.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import nodemailer from "nodemailer";
import { createServer } from "node:http";
import { renderMessage } from "./templates.mjs";
import { deliver, errorCode, mailerApi, transportConfig } from "./worker.mjs";

const message = { id: "test-message", recipient: "agent@example.test", subject: "Votre acces",
  template: "invitation", login_url: "https://app.example.test/login",
  payload: { name: '<script>alert("x")</script>', organization: "Acme", role: "support_agent", initial_password: "test-initial-password" } };

test("branded invitation contains escaped account details and mandatory reset notice", () => {
  const result = renderMessage(message);
  assert.ok(result.html.includes("cid:supportdeflect-logo"));
  assert.ok(result.html.includes("&lt;script&gt;"));
  assert.ok(!result.html.includes("<script>"));
  assert.ok(result.text.includes("test-initial-password"));
  assert.ok(result.text.includes("remplacer a votre premiere connexion"));
  assert.throws(() => renderMessage({ ...message, login_url: "javascript:alert(1)" }));
});

test("Nodemailer builds multipart mail with inline logo and a single recipient", async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
  const info = await transport.sendMail({ from: "dhiaayed03@gmail.com", to: message.recipient, ...renderMessage(message) });
  const mime = info.message.toString();
  assert.ok(mime.includes("multipart/"));
  assert.ok(mime.includes("Content-ID: <supportdeflect-logo>"));
  assert.ok(mime.includes("To: agent@example.test"));
  assert.ok(!mime.includes("Bcc:"));
  assert.ok(await deliver(message, transport, "dhiaayed03@gmail.com"));
});

test("SMTP requires TLS and classifies uncertain delivery for manual review", () => {
  assert.equal(transportConfig({ SMTP_PORT: "587" }).requireTLS, true);
  assert.equal(transportConfig({}).secure, true);
  assert.equal(errorCode({ code: "EAUTH" }), "authentication_failed");
  assert.equal(errorCode({ code: "ETIMEDOUT" }), "delivery_failed");
  assert.equal(errorCode({ code: "ECONNECTION", command: "CONN" }), "delivery_failed");
  assert.equal(errorCode({ code: "EDNS" }), "connection_failed");
});

test("unencrypted mail is restricted to the local capture service", () => {
  const config = transportConfig({ SMTP_HOST: "mailpit", SMTP_PORT: "1025", SMTP_ALLOW_INSECURE_LOCAL: "true" });
  assert.equal(config.secure, false);
  assert.equal(config.ignoreTLS, true);
  assert.equal(config.auth, undefined);
  assert.throws(() => transportConfig({ SMTP_HOST: "external.example.com", SMTP_ALLOW_INSECURE_LOCAL: "true" }));
});

test("invalid invitations cannot send undefined passwords or malformed expiry", () => {
  assert.throws(() => renderMessage({ ...message, payload: { ...message.payload, initial_password: undefined } }), { code: "EINVALIDMESSAGE" });
  assert.throws(() => renderMessage({ ...message, payload: { ...message.payload, expires_at: "invalid-date" } }), { code: "EINVALIDMESSAGE" });
  assert.equal(errorCode({ code: "EINVALIDMESSAGE" }), "invalid_message");
});

test("SMTP without any accepted recipient is not reported as successful", async () => {
  const transport = {
    /** Simulate an SMTP response that accepts nobody without an explicit rejected list. */
    sendMail: async () => ({ messageId: "fixture", accepted: [], rejected: [] }),
  };
  await assert.rejects(deliver(message, transport, "sender@example.test"), { code: "EENVELOPE" });
});

/** Start an ephemeral loopback HTTP fixture and register socket/server cleanup on the test. */
async function httpFixture(testContext, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  testContext.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

test("internal API rejects redirects before privileged headers reach another origin", async (t) => {
  let redirectedRequests = 0;
  const otherOrigin = await httpFixture(t, (_request, response) => {
    redirectedRequests++;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ message: null }));
  });
  for (const status of [302, 307, 308]) {
    const apiOrigin = await httpFixture(t, (_request, response) => {
      response.writeHead(status, { Location: `${otherOrigin}/capture` });
      response.end();
    });
    await assert.rejects(mailerApi(apiOrigin, "test-only-service-token", "/claim", { smtp_ready: true }));
  }
  assert.equal(redirectedRequests, 0);
});

test("internal API retains authenticated POST bodies and rejects HTTP errors", async (t) => {
  let requestDetails;
  const apiOrigin = await httpFixture(t, async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requestDetails = {
      method: request.method,
      url: request.url,
      authenticated: request.headers["x-mailer-token"] === "test-only-service-token",
      body: JSON.parse(Buffer.concat(chunks).toString()),
    };
    response.writeHead(request.url.endsWith("/claim") ? 200 : 503, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ message: null }));
  });
  assert.deepEqual(await mailerApi(apiOrigin, "test-only-service-token", "/claim", { smtp_ready: true }), { message: null });
  assert.deepEqual(requestDetails, {
    method: "POST", url: "/internal/mail/claim", authenticated: true, body: { smtp_ready: true },
  });
  await assert.rejects(mailerApi(apiOrigin, "test-only-service-token", "/result", {}), /returned 503/);
});
