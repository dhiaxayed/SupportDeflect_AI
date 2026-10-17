/**
 * @file Standalone customer widget and Studio iframe renderer served by the FastAPI widget
 * router. A Shadow DOM host isolates presentation; public requests use company/visitor
 * identifiers and optional scoped case capabilities, while preview questions cross an
 * origin/source-checked parent bridge. Keep conversation history in frame memory, persist only
 * visitor/pending-case access and render returned text without HTML interpretation.
 */

/* Lucide Bot icon (ISC), Copyright (c) Lucide Contributors 2026.
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */
(function () {
  "use strict";
  const script = document.currentScript;
  if (!script) return;
  const preview = script.dataset.preview === "true";
  const company = script.dataset.company;
  if (!preview && !company) return;
  const scriptURL = new URL(script.src, location.href);
  const api = scriptURL.href.replace(/\/widget\/script\.js(?:\?.*)?$/, "");
  /**
   * Resolve a validated local asset path against the script host, keeping logos on this
   * SupportDeflect instance rather than the embedding website.
   */
  const assetURL = (path) => new URL(path, scriptURL.origin).href;
  const parentOrigin = preview && document.referrer ? new URL(document.referrer).origin : null;
  if (document.querySelector('[data-supportdeflect="' + (company || "preview") + '"]')) return;
  const host = document.createElement("div");
  host.setAttribute("data-supportdeflect", company || "preview");
  // Host CSS cannot change descendants inside this shadow root. Important host
  // positioning also protects against broad rules such as div { position: ... }.
  host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important";
  document.documentElement.append(host);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = '<style>' + styles() + '</style><div class="sd-widget" hidden>' +
    '<button class="sd-launcher" type="button" aria-label="Open support chat" aria-expanded="false"><span class="sd-identity"></span></button>' +
    '<section class="sd-panel" aria-label="Support chat" hidden><header class="sd-header"><span class="sd-avatar sd-identity"></span>' +
    '<div class="sd-heading"><strong class="sd-brand"></strong><span class="sd-subtitle"></span></div>' +
    '<button class="sd-close" type="button" aria-label="Close support chat" title="Close support chat">&#215;</button></header>' +
    '<div class="sd-messages" role="log" aria-live="polite" aria-label="Conversation"></div>' +
    '<div class="sd-progress" role="status" hidden>Thinking...</div>' +
    '<form class="sd-form"><textarea class="sd-input" aria-label="Your question" rows="2" minlength="2" maxlength="2000" required></textarea>' +
    '<button class="sd-send" type="submit" aria-label="Send message" title="Send message">&#8593;</button></form>' +
    '<footer class="sd-footer">Powered by <span>SupportDeflectAI</span></footer></section></div>';
  /**
   * Query only this widget's shadow root so host-page selectors and other widget instances
   * cannot affect its controls.
   */
  const $ = (selector) => root.querySelector(selector);
  const widget = $(".sd-widget"), panel = $(".sd-panel"), input = $(".sd-input");
  let config, busy = false, initialized = false, timer, pending;
  let requestSequence = 0;
  // Per-frame memory only: no visitor conversation is shared through globals or browser storage.
  let history = [];
  const visitor = visitorId();
  const casesKey = "supportdeflect:cases:" + company;
  let cases = [];
  try {
    const stored = JSON.parse(localStorage.getItem(casesKey) || "[]");
    if (Array.isArray(stored)) cases = stored.filter((c) => c && typeof c.id === "string" && typeof c.token === "string" && c.expires > Date.now()).slice(-10);
  } catch { /* Storage may be disabled by the host browser. */ }
  let polling = false;
  if (!preview) setInterval(pollCases, 15000);
  const systemTheme = matchMedia("(prefers-color-scheme: dark)");
  $(".sd-launcher").addEventListener("click", () => setOpen(panel.hidden, true));
  $(".sd-close").addEventListener("click", () => setOpen(false, true));
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) setOpen(false, true);
  });
  input.addEventListener("keydown", (event) => {
    // Enter can commit an IME composition instead of sending a completed question.
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); $(".sd-form").requestSubmit(); }
  });
  $(".sd-form").addEventListener("submit", ask);
  systemTheme.addEventListener("change", () => config && apply(config));
  if (preview) {
    // Only the immediate Studio parent at its recorded origin can configure or answer this frame.
    window.addEventListener("message", (event) => {
      if (event.source !== parent || event.origin !== parentOrigin || !event.data) return;
      if (event.data.type === "sd:config") apply(event.data.settings);
      if (event.data.type === "sd:open") setOpen(Boolean(event.data.open));
      if (event.data.type === "sd:answer" && pending && event.data.id === pending.id) {
        event.data.error ? pending.reject(new Error(event.data.error)) : pending.resolve(event.data.payload);
        pending = null;
      }
    });
    if (parentOrigin) parent.postMessage({ type: "sd:ready" }, parentOrigin);
  } else {
    fetch(api + "/widget/settings/" + encodeURIComponent(company), { credentials: "omit" })
      .then(checkResponse).then(apply).catch(() => {
        // Do not display a default-looking but unauthorized/broken widget.
        host.remove();
        console.warn("SupportDeflectAI: widget unavailable; check company and allowed domain.");
      });
  }

  /**
   * Apply one saved/preview configuration with bounded dimensions, valid colors, local logo
   * paths and theme selection. Refresh the greeting and restart opening timers only when
   * opening behavior changes, preserving an ongoing conversation.
   */
  function apply(value) {
    if (!value || !value.design) return;
    const previousBehavior = config && config.design.open_behavior;
    const previousDelay = config && config.design.open_delay_seconds;
    config = value;
    const d = config.design;
    const dark = d.theme === "dark" || (d.theme === "system" && systemTheme.matches);
    const color = validColor(config.primary_color, "#2563eb");
    const background = dark ? "#262626" : validColor(d.background_color, "#f4f4f4");
    const text = dark ? "#f4f4f4" : validColor(d.text_color, "#161616");
    const vars = {
      "--sd-primary": color, "--sd-on-primary": contrast(color), "--sd-bg": background,
      "--sd-text": text, "--sd-surface": dark ? "#161616" : "#ffffff",
      "--sd-border": dark ? "#525252" : "#d6d6d6",
      "--sd-muted": dark ? "#c6c6c6" : "#525252",
      "--sd-width": number(d.width, 380, 280, 640) + "px",
      "--sd-height": number(d.height, 560, 320, 800) + "px",
      "--sd-launcher": number(d.launcher_size, 56, 40, 88) + "px",
      "--sd-x": number(d.offset_x, 20, 8, 80) + "px",
      "--sd-y": number(d.offset_y, 20, 8, 80) + "px",
      "--sd-radius": number(d.radius, 16, 0, 32) + "px",
      "--sd-logo": number(d.logo_size, 32, 20, 56) + "px",
    };
    Object.entries(vars).forEach(([key, val]) => widget.style.setProperty(key, val));
    widget.dataset.position = d.position === "bottom-left" ? "left" : "right";
    $(".sd-brand").textContent = config.brand_name || "Support";
    $(".sd-subtitle").textContent = d.subtitle || "";
    input.placeholder = d.placeholder || "Ask a question...";
    root.querySelectorAll(".sd-identity").forEach((el) => {
      el.replaceChildren();
      el.dataset.identity = d.identity === "robot" ? "robot" : "default";
      if (d.identity === "robot") {
        // Lucide Bot uses the same line-icon vocabulary as the app, without a React dependency.
        el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/></svg>';
      } else {
        const img = document.createElement("img");
        // Logos must be served by this instance, never arbitrary third-party trackers or data URLs.
        const custom = d.identity === "custom" && /^\/api\/v1\/widget\/assets\/[a-zA-Z0-9_-]+\.png$/.test(d.logo_path || "");
        el.dataset.identity = custom ? "custom" : "default";
        img.src = custom ? assetURL(d.logo_path) : api + "/widget/brand.png";
        img.alt = "";
        img.addEventListener("error", () => {
          if (custom) {
            el.dataset.identity = "default";
            img.src = api + "/widget/brand.png";
          }
        }, { once: true });
        el.append(img);
      }
    });
    const greeting = $(".sd-greeting");
    if (greeting) greeting.textContent = config.greeting_message;
    else {
      const item = append("assistant", config.greeting_message || "Hello!");
      item.querySelector(".sd-bubble").classList.add("sd-greeting");
    }
    widget.hidden = false;
    if (!initialized || previousBehavior !== d.open_behavior || previousDelay !== d.open_delay_seconds) {
      clearTimeout(timer);
      setOpen(d.open_behavior === "open");
      if (d.open_behavior === "delayed") timer = setTimeout(() => setOpen(true), number(d.open_delay_seconds, 5, 1, 60) * 1000);
    }
    initialized = true;
  }

  /**
   * Synchronize panel visibility and launcher expansion; focus the input/launcher only for
   * explicit user actions so automatic opening does not steal page focus.
   */
  function setOpen(open, focus = false) {
    panel.hidden = !open;
    $(".sd-launcher").setAttribute("aria-expanded", String(open));
    if (focus) (open ? input : $(".sd-launcher")).focus();
  }

  /**
   * Submit one validated question at a time through the public API or correlated preview
   * bridge, append safe evidence/answer text and bound recent history. Persist only returned
   * visitor-case capabilities and restore controls on errors or timeout.
   */
  async function ask(event) {
    event.preventDefault();
    const question = input.value.trim();
    if (question.length < 2 || busy) return;
    busy = true;
    $(".sd-send").disabled = true;
    $(".sd-progress").hidden = false;
    input.disabled = true;
    append("user", question);
    input.value = "";
    try {
      let result;
      if (preview) {
        result = await new Promise((resolve, reject) => {
          // This ID only correlates replies inside this frame; origin/source checks authorize the bridge.
          const id = "preview_" + ++requestSequence;
          const timeout = setTimeout(() => { pending = null; reject(new Error("Response timed out")); }, 45000);
          pending = {
            id,
            /**
             * Clear the preview deadline before fulfilling the correlated answer promise so a
             * settled request cannot later time out.
             */
            resolve: (v) => {
              clearTimeout(timeout);
              resolve(v);
            },
            /**
             * Clear the preview deadline before rejecting the correlated request, leaving the
             * main ask cleanup responsible for re-enabling controls.
             */
            reject: (e) => {
              clearTimeout(timeout);
              reject(e);
            }
          };
          parent.postMessage({ type: "sd:question", id, question, history }, parentOrigin);
        });
      } else {
        const response = await fetch(api + "/widget/" + encodeURIComponent(company) + "/chat", {
          method: "POST", credentials: "omit", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visitor_id: visitor, question, history }), signal: AbortSignal.timeout(45000),
        });
        result = await checkResponse(response);
      }
      append("assistant", result.answer, result.sources, result);
      history = [...history, { role: "user", content: question },
        { role: "assistant", content: result.answer.slice(0, 3000) }].slice(-8);
      if (!preview && result.support_case_id && result.case_access_token) {
        cases.push({ id: result.support_case_id, token: result.case_access_token, expires: Date.now() + 7 * 86400000 });
        cases = cases.slice(-10);
        saveCases();
      }
    } catch (error) {
      append("assistant", "The assistant is unavailable right now." +
        (config.support_email ? " Contact " + config.support_email + "." : " Please try again later."));
    } finally {
      busy = false;
      $(".sd-send").disabled = false;
      $(".sd-progress").hidden = true;
      input.disabled = false;
      if (!panel.hidden) input.focus();
    }
  }

  /**
   * Persist at most the current pending-case capability list when storage is available;
   * blocked host storage must not break chat.
   */
  function saveCases() {
    try { localStorage.setItem(casesKey, JSON.stringify(cases)); } catch { /* Optional persistence. */ }
  }

  /**
   * Poll pending capabilities only while the panel/document are visible and no poll is
   * running. Remove expired/denied/closed cases, show public human answers and retry transient
   * network failures on a later cycle.
   */
  async function pollCases() {
    if (polling || panel.hidden || document.hidden || !cases.length) return;
    polling = true;
    try {
      for (const item of [...cases]) {
        try {
          const response = await fetch(api + "/widget/" + encodeURIComponent(company) + "/cases/" + encodeURIComponent(item.id), {
            method: "POST", credentials: "omit", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: item.token }), signal: AbortSignal.timeout(10000),
          });
          if ([403, 404].includes(response.status) || item.expires < Date.now()) {
            cases = cases.filter((c) => c.id !== item.id);
          } else if (response.ok) {
            const result = await response.json();
            if (result.answer) {
              append("assistant", "Support team:\n" + result.answer);
              cases = cases.filter((c) => c.id !== item.id);
            } else if (result.status === "closed") cases = cases.filter((c) => c.id !== item.id);
          }
        } catch { /* Retry transient failures on the next polling cycle. */ }
      }
      saveCases();
    } finally { polling = false; }
  }

  /**
   * Build one conversation item using textContent for all answer/source text, add truthful
   * human-review status and collapsible evidence, then scroll this widget's log.
   */
  function append(role, text, sources, meta) {
    const item = document.createElement("div");
    item.className = "sd-message sd-" + role;
    const bubble = document.createElement("div");
    bubble.className = "sd-bubble";
    bubble.textContent = text || "";
    item.append(bubble);
    if (meta && meta.needs_human && (preview || meta.support_case_id)) {
      const note = document.createElement("p");
      note.className = "sd-status";
      note.textContent = preview ? "Human support recommended" : "Sent to the support team for review";
      if (config.support_email) {
        const link = document.createElement("a");
        link.href = "mailto:" + config.support_email;
        link.textContent = "Contact support";
        note.append(document.createElement("br"), link);
      }
      item.append(note);
    }
    if (Array.isArray(sources) && sources.length) {
      const details = document.createElement("details");
      details.className = "sd-sources";
      const summary = document.createElement("summary");
      summary.textContent = "Sources (" + sources.length + ")";
      details.append(summary);
      sources.forEach((source) => {
        const p = document.createElement("p");
        p.textContent = (source.reference ? "[" + source.reference + "] " : "") + source.title + ": " + (source.snippet || "");
        details.append(p);
      });
      item.append(details);
    }
    $(".sd-messages").append(item);
    $(".sd-messages").scrollTop = $(".sd-messages").scrollHeight;
    return item;
  }

  /**
   * Reject non-success HTTP responses and otherwise decode JSON; callers provide the safe
   * visitor-facing outage message.
   */
  async function checkResponse(response) {
    if (!response.ok) throw new Error("Request failed");
    return response.json();
  }
  /**
   * Clamp only finite numeric design values to the renderer's supported range, using a known
   * default for malformed configuration.
   */
  function number(value, fallback, min, max) {
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  }
  /**
   * Accept only six-digit hexadecimal colors before assigning CSS variables; fall back instead
   * of inserting arbitrary CSS values.
   */
  function validColor(value, fallback) { return /^#[\da-f]{6}$/i.test(value || "") ? value : fallback; }
  /**
   * Choose the launcher/header foreground from linearized color luminance so the primary
   * accent has a legible dark or light text color.
   */
  function contrast(color) {
    const channels = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
      .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 > 0.179 ? "#161616" : "#ffffff";
  }
  /**
   * Reuse a tenant-keyed, format-checked visitor identifier or create one; storage failure
   * falls back to an in-memory identifier without preventing public chat.
   */
  function visitorId() {
    const key = "supportdeflect:visitor:" + company;
    try {
      const existing = localStorage.getItem(key);
      if (existing && /^visitor_[\w-]{10,100}$/.test(existing)) return existing;
      const value = "visitor_" + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());
      localStorage.setItem(key, value);
      return value;
    } catch { return "visitor_" + Math.random().toString(36).slice(2) + Date.now(); }
  }

  /**
   * Return the complete shadow-scoped stylesheet, including responsive panel bounds, contained
   * logos, focus outlines and reduced-motion-aware opening animation.
   */
  function styles() {
    return [
      ":host{all:initial;color-scheme:light}*{box-sizing:border-box;letter-spacing:0}button,textarea{font:inherit}button{cursor:pointer}button:focus-visible,textarea:focus-visible,a:focus-visible{outline:2px solid var(--sd-primary);outline-offset:2px}[hidden]{display:none!important}",
      ".sd-widget{position:absolute;bottom:var(--sd-y);font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:var(--sd-text);pointer-events:auto;right:var(--sd-x)}.sd-widget[data-position=left]{left:var(--sd-x);right:auto}",
      // A circular backplate absorbs opaque image backgrounds. Custom marks fit inside an
      // inscribed square (70% diameter), so wide or square logos are never cropped or stretched.
      ".sd-launcher{display:flex;align-items:center;justify-content:center;width:var(--sd-launcher);height:var(--sd-launcher);background:var(--sd-primary);color:var(--sd-on-primary);border:0;border-radius:50%;box-shadow:0 4px 18px #0003;padding:4px}.sd-identity{display:flex;align-items:center;justify-content:center;flex:none;border-radius:50%;overflow:hidden;line-height:1}.sd-identity:not([data-identity=robot]){background:#fff}.sd-identity img{display:block;width:100%;height:100%;object-fit:contain}.sd-identity[data-identity=custom] img{width:70%;height:70%}.sd-identity svg{display:block;width:64%;height:64%}.sd-launcher .sd-identity{width:100%;height:100%}.sd-avatar{width:var(--sd-logo);height:var(--sd-logo)}",
      ".sd-panel{position:absolute;right:0;bottom:calc(var(--sd-launcher) + 12px);display:flex;flex-direction:column;width:min(var(--sd-width),calc(100vw - 2 * var(--sd-x)));height:min(var(--sd-height),calc(100dvh - var(--sd-y) - var(--sd-launcher) - 28px));background:var(--sd-surface);border:1px solid var(--sd-border);border-radius:var(--sd-radius);box-shadow:0 8px 32px #0003;overflow:hidden}.sd-widget[data-position=left] .sd-panel{right:auto;left:0}",
      ".sd-header{display:flex;align-items:center;gap:10px;padding:14px;background:var(--sd-primary);color:var(--sd-on-primary);flex:none}.sd-heading{flex:1;min-width:0;overflow-wrap:anywhere}.sd-brand{display:block;font-size:15px;line-height:1.3}.sd-subtitle{font-size:12px}.sd-close{flex:none;width:30px;height:30px;font-size:25px;line-height:1;background:transparent;color:inherit;border:0;border-radius:4px}",
      ".sd-messages{flex:1;min-height:0;overflow:auto;padding:16px;background:var(--sd-bg);overscroll-behavior:contain}.sd-message{max-width:92%;margin-bottom:12px;overflow-wrap:anywhere}.sd-user{margin-left:auto}.sd-bubble{white-space:pre-wrap;padding:10px 12px;border:1px solid var(--sd-border);border-radius: min(var(--sd-radius),12px);background:var(--sd-surface);color:var(--sd-text)}.sd-user .sd-bubble{background:var(--sd-primary);color:var(--sd-on-primary);border-color:transparent}",
      ".sd-status,.sd-sources{font-size:12px;color:var(--sd-muted);margin:6px 0 0}.sd-status a{color:inherit;text-decoration:underline}.sd-sources summary{cursor:pointer}.sd-sources p{margin:6px 0}.sd-progress{font-size:12px;padding:4px 12px;color:var(--sd-muted)}",
      ".sd-form{display:flex;align-items:center;gap:8px;padding:10px;border-top:1px solid var(--sd-border);flex:none;margin:0}.sd-input{flex:1;min-width:0;resize:none;border:1px solid var(--sd-border);border-radius:4px;background:var(--sd-surface);color:var(--sd-text);padding:8px;font-size:14px;line-height:1.4}.sd-input::placeholder{color:var(--sd-muted);opacity:1}.sd-send{flex:none;width:36px;height:36px;border:0;border-radius:4px;font-size:24px;background:var(--sd-primary);color:var(--sd-on-primary)}.sd-send:disabled{opacity:.5;cursor:wait}.sd-footer{flex:none;text-align:center;padding:0 8px 9px;font-size:10px;color:var(--sd-muted)}.sd-footer span{font-weight:600}",
      "@media(prefers-reduced-motion:no-preference){.sd-panel{animation:sd-in .15s ease-out}@keyframes sd-in{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}}"
    ].join("\n");
  }
})();
