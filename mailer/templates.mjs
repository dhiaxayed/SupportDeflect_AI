/** Render account mail as French text/HTML with an inline local brand image.
 * Backend outbox records supply the recipient and payload; this module builds content
 * only. SMTP delivery, claims and acknowledgements belong to worker.mjs.
 */
import { fileURLToPath } from "node:url";

// Resolve a trusted bundled image independently of the worker's current directory.
export const logoPath = fileURLToPath(new URL("../widget/supportdeflect-logo.png", import.meta.url));
/** Escape dynamic HTML text/attributes; plain-text email intentionally retains readable input. */
export const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);

/** Build subject, text, HTML and CID attachment for one already-claimed outbox message.
 * HTTP(S) login URLs are required. Invitations also require a nonblank initial
 * password and a parseable expiry when supplied; malformed credentials throw
 * EINVALIDMESSAGE before SMTP submission. Dynamic HTML fields are escaped here.
 */
export function renderMessage(message) {
  const { payload = {}, template, subject, login_url: loginUrl } = message;
  const url = new URL(loginUrl);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("Invalid application URL");
  const greeting = payload.name ? `Bonjour ${payload.name},` : "Bonjour,";
  const invitation = template === "invitation";
  if (invitation && (typeof payload.initial_password !== "string" || !payload.initial_password.trim())) {
    throw Object.assign(new Error("Invitation credentials are missing"), { code: "EINVALIDMESSAGE" });
  }
  if (invitation && payload.expires_at && !Number.isFinite(Date.parse(payload.expires_at))) {
    throw Object.assign(new Error("Invitation expiry is invalid"), { code: "EINVALIDMESSAGE" });
  }
  const body = invitation
    ? `Votre compte ${payload.role === "tenant_admin" ? "administrateur" : "agent de support"} est pret dans l'espace ${payload.organization}.`
    : payload.message || "Une mise a jour concernant votre espace SupportDeflect AI est disponible.";
  const expiry = payload.expires_at ? `Ce mot de passe expire le ${new Date(payload.expires_at).toISOString().replace("T", " ").slice(0, 16)} UTC.` : "Ce mot de passe est temporaire.";
  const resetNotice = `${expiry} Vous devrez le remplacer a votre premiere connexion. Seule votre invitation la plus recente est valable.`;
  const credentials = invitation ? `Adresse email : ${message.recipient}\nMot de passe initial : ${payload.initial_password}\n${resetNotice}` : "";
  const text = `${subject}\n\n${greeting}\n\n${body}\n\n${credentials}\n\nAcceder a votre espace : ${url.href}\n\nL'equipe SupportDeflect AI`;
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f4f4;color:#161616;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(subject)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:36px 16px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:auto;background:#fff;border-top:4px solid #0f62fe">
<tr><td style="padding:32px 32px 24px;border-bottom:1px solid #e0e0e0"><img src="cid:supportdeflect-logo" alt="SupportDeflect AI" width="220" style="display:block;width:220px;max-width:100%;height:auto"></td></tr>
<tr><td style="padding:32px"><p style="font-size:12px;color:#6f6f6f;margin:0 0 12px">${escapeHtml(payload.organization || "VOTRE COMPTE")}</p>
<h1 style="font-size:24px;line-height:1.35;font-weight:400;margin:0 0 28px">${escapeHtml(subject)}</h1>
<p style="font-size:15px;line-height:1.7">${escapeHtml(greeting)}</p>
<p style="font-size:15px;line-height:1.7;white-space:pre-line">${escapeHtml(body)}</p>
${invitation ? `<table role="presentation" width="100%" style="background:#f4f4f4;margin:24px 0;font-size:14px"><tr><td style="padding:20px"><div style="color:#525252">Adresse email</div><div style="padding:6px 0 18px">${escapeHtml(message.recipient)}</div><div style="color:#525252">Mot de passe initial</div><div style="padding-top:6px;font:16px monospace;word-break:break-all">${escapeHtml(payload.initial_password)}</div></td></tr></table><p style="font-size:13px;line-height:1.6;color:#525252">${resetNotice}</p>` : ""}
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0"><tr><td bgcolor="#0f62fe" style="padding:15px 24px"><a href="${escapeHtml(url.href)}" style="color:white;text-decoration:none;font-size:14px">Acceder a mon espace &rarr;</a></td></tr></table>
<p style="font-size:14px;line-height:1.6;margin:28px 0 0">L'equipe SupportDeflect AI</p></td></tr>
<tr><td style="padding:24px 32px;border-top:1px solid #e0e0e0;font-size:12px;line-height:1.6;color:#6f6f6f">SupportDeflect AI &middot; Service client et gestion de votre espace.<br>Vous recevez cet email concernant votre compte ou votre organisation.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html, attachments: [{ filename: "supportdeflect-logo.png", path: logoPath, cid: "supportdeflect-logo" }] };
}
