/** Deliver backend outbox claims through SMTP and acknowledge each fenced claim.
 * The internal API owns persistence/retry policy; this worker owns SMTP, a local
 * heartbeat and safe delivery classifications. Importing it never starts polling.
 */
import nodemailer from "nodemailer";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { renderMessage } from "./templates.mjs";

/** Translate SMTP environment settings into bounded Nodemailer connection options.
 * Port 465 uses implicit TLS; other remote ports require STARTTLS. Explicit local
 * capture mode disables TLS/auth only for the three allowed capture hosts. URL
 * attachment fetching stays disabled; the bundled logo needs local file access.
 */
export function transportConfig(env) {
  const local = env.SMTP_ALLOW_INSECURE_LOCAL === "true";
  if (local && !["mailpit", "localhost", "127.0.0.1"].includes(env.SMTP_HOST)) {
    throw new Error("Unencrypted SMTP is restricted to the local mail capture service");
  }
  const port = Number(env.SMTP_PORT || 465);
  return {
    host: env.SMTP_HOST || "smtp.gmail.com", port, secure: port === 465,
    requireTLS: !local && port !== 465,
    ...(local ? { ignoreTLS: true } : { auth: { user: env.SMTP_USER || "dhiaayed03@gmail.com", pass: env.SMTP_PASS } }),
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
    disableFileAccess: false, disableUrlAccess: true,
  };
}

/** Submit one rendered message and return the SMTP adapter's message identifier.
 * A stable Message-ID aids diagnosis but cannot guarantee SMTP deduplication.
 * Explicit rejection or an empty accepted-recipient list throws EENVELOPE; all
 * transport/rendering failures propagate for conservative outcome classification.
 */
export async function deliver(message, transport, from) {
  const content = renderMessage(message);
  const info = await transport.sendMail({
    from: { name: "SupportDeflect AI", address: from }, to: message.recipient,
    messageId: `<${message.id}@supportdeflect.local>`, ...content,
  });
  if (info.rejected?.length || (Array.isArray(info.accepted) && !info.accepted.length)) {
    throw Object.assign(new Error("Recipient rejected"), { code: "EENVELOPE" });
  }
  return info.messageId;
}

/** Reduce provider errors to backend-safe status codes without returning credentials.
 * DNS/TLS failures are classified as connection failures. Ambiguous timeouts/socket
 * closes remain delivery_failed because the server might already have accepted DATA.
 */
export function errorCode(error) {
  if (error.code === "EINVALIDMESSAGE") return "invalid_message";
  if (error.code === "EAUTH") return "authentication_failed";
  if (error.code === "EENVELOPE") return "recipient_rejected";
  // ECONNECTION also describes a socket closed after DATA; its command is not reliable evidence.
  if (["EDNS", "ETLS"].includes(error.code)) return "connection_failed";
  return "delivery_failed";
}

/** POST JSON to the privileged mail API with a 20-second deadline and no redirects.
 * Reject non-success HTTP statuses; return parsed JSON otherwise. Redirect refusal
 * prevents invitation credentials and the service token from reaching another origin.
 */
export async function mailerApi(base, token, path, body) {
  const result = await fetch(`${base}/internal/mail${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Mailer-Token": token },
    // A proxy redirect must never forward the privileged worker token or invitation payload.
    redirect: "error", body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
  });
  if (!result.ok) throw new Error(`Mailer API returned ${result.status}`);
  return result.json();
}

/** Poll claims until SIGINT/SIGTERM, verify SMTP periodically and close on shutdown.
 * Requires a service token of at least 32 characters. SMTP readiness is checked at
 * most once per minute; successful claims update the temporary heartbeat. Idle/error
 * cycles wait 15 seconds, delivery cycles 1.5 seconds. Only result acknowledgements
 * are retried here, up to three times: a failed acknowledgement never resends SMTP
 * within that cycle. Backend claim expiry handles lost acknowledgements separately.
 */
async function run() {
  const token = process.env.MAILER_SERVICE_TOKEN;
  if (!token || token.length < 32) throw new Error("Configure MAILER_SERVICE_TOKEN (32 characters minimum)");
  const base = (process.env.MAILER_API_URL || "http://127.0.0.1:8000/api/v1").replace(/\/$/, "");
  const local = process.env.SMTP_ALLOW_INSECURE_LOCAL === "true";
  const transport = (local || process.env.SMTP_PASS) ? nodemailer.createTransport(transportConfig(process.env)) : null;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || "dhiaayed03@gmail.com";
  let stopped = false;
  let checkedAt = 0;
  let ready = false;
  let detail = "not_configured";
  process.on("SIGTERM", () => { stopped = true; });
  process.on("SIGINT", () => { stopped = true; });
  /** Bind worker credentials once for claim/result requests without exposing them in logs. */
  const api = (path, body) => mailerApi(base, token, path, body);
  while (!stopped) {
    let delay = 15000;
    try {
      if (transport && Date.now() - checkedAt > 60000) {
        checkedAt = Date.now();
        try { await transport.verify(); ready = true; detail = local ? "local_capture" : "ready"; }
        catch (error) { ready = false; detail = error.code === "EAUTH" ? "authentication_failed" : "connection_failed"; }
      }
      const { message } = await api("/claim", { smtp_ready: ready, detail });
      await writeFile(join(tmpdir(), "supportdeflect-mailer-heartbeat"), String(Date.now()));
      if (message && transport) {
        let outcome;
        try { outcome = { success: true, message_id: await deliver(message, transport, from) }; }
        catch (error) { outcome = { success: false, error_code: errorCode(error) }; }
        // Acknowledgement retries never repeat the SMTP send.
        for (let attempt = 0; attempt < 3; attempt++) {
          try { await api(`/${message.id}/result`, { claim_token: message.claim_token, ...outcome }); break; }
          catch (error) { if (attempt === 2) throw error; await new Promise((resolve) => setTimeout(resolve, 1000)); }
        }
        console.info(JSON.stringify({ message_id: message.id, result: outcome.success ? "sent" : outcome.error_code }));
        delay = 1500;
      }
    } catch (error) {
      console.error("Mailer cycle interrupted:", error.message);
    }
    if (!stopped) await new Promise((resolve) => setTimeout(resolve, delay));
  }
  transport?.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
