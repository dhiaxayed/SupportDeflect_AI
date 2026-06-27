(function () {
  "use strict";

  var script = document.currentScript || (function () {
    var scripts = document.getElementsByTagName("script");
    return scripts[scripts.length - 1];
  })();

  var companyId = script && script.getAttribute("data-company");
  if (!companyId) {
    console.warn("SupportDeflect AI widget: missing data-company attribute.");
    return;
  }

  var explicitApiBase = script.getAttribute("data-api-base");
  var scriptUrl = script.src ? new URL(script.src, window.location.href) : null;
  var apiBase = explicitApiBase || (scriptUrl ? scriptUrl.origin : window.location.origin);
  apiBase = apiBase.replace(/\/$/, "");

  var storageKey = "supportdeflect:visitor:" + companyId;
  var visitorId = getOrCreateVisitorId(storageKey);
  var settings = {
    brand_name: "Support",
    primary_color: "#2563eb",
    greeting_message: "Hi! Ask me anything about this product.",
    support_email: null
  };

  var host = document.createElement("div");
  host.id = "supportdeflect-widget-root";
  document.documentElement.appendChild(host);
  var root = host.attachShadow({ mode: "open" });

  root.innerHTML = '\n' +
    '<style>' + css() + '</style>' +
    '<div class="sd-widget" aria-live="polite">' +
    '  <button class="sd-launcher" type="button" aria-label="Open support chat">' +
    '    <span class="sd-launcher-icon">?</span>' +
    '  </button>' +
    '  <section class="sd-panel" aria-label="Support chat" hidden>' +
    '    <header class="sd-header">' +
    '      <div><strong class="sd-brand">Support</strong><span>AI assistant</span></div>' +
    '      <button class="sd-close" type="button" aria-label="Close support chat">x</button>' +
    '    </header>' +
    '    <div class="sd-messages"></div>' +
    '    <form class="sd-form">' +
    '      <textarea class="sd-input" rows="1" placeholder="Ask a question..." maxlength="2000"></textarea>' +
    '      <button class="sd-send" type="submit">Send</button>' +
    '    </form>' +
    '  </section>' +
    '</div>';

  var launcher = root.querySelector(".sd-launcher");
  var panel = root.querySelector(".sd-panel");
  var closeButton = root.querySelector(".sd-close");
  var brand = root.querySelector(".sd-brand");
  var messages = root.querySelector(".sd-messages");
  var form = root.querySelector(".sd-form");
  var input = root.querySelector(".sd-input");
  var send = root.querySelector(".sd-send");

  launcher.addEventListener("click", togglePanel);
  closeButton.addEventListener("click", closePanel);
  form.addEventListener("submit", onSubmit);
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.dispatchEvent(new Event("submit", { cancelable: true }));
    }
  });

  loadSettings().then(function () {
    applySettings();
    appendMessage("assistant", settings.greeting_message || "Hi! How can I help?");
  }).catch(function () {
    applySettings();
    appendMessage("assistant", settings.greeting_message || "Hi! How can I help?");
  });

  function togglePanel() {
    if (panel.hidden) {
      panel.hidden = false;
      setTimeout(function () { input.focus(); }, 40);
    } else {
      closePanel();
    }
  }

  function closePanel() {
    panel.hidden = true;
  }

  function applySettings() {
    root.querySelector(".sd-widget").style.setProperty("--sd-primary", settings.primary_color || "#2563eb");
    brand.textContent = settings.brand_name || "Support";
  }

  function loadSettings() {
    return fetch(apiBase + "/api/v1/widget/settings/" + encodeURIComponent(companyId), {
      method: "GET",
      credentials: "omit",
      headers: { "Accept": "application/json" }
    }).then(function (response) {
      if (!response.ok) throw new Error("settings_failed");
      return response.json();
    }).then(function (payload) {
      settings = {
        brand_name: payload.brand_name,
        primary_color: payload.primary_color,
        greeting_message: payload.greeting_message,
        support_email: payload.support_email
      };
    });
  }

  function onSubmit(event) {
    event.preventDefault();
    var question = input.value.trim();
    if (!question) return;
    appendMessage("user", question);
    input.value = "";
    autosize();
    setLoading(true);
    postQuestion(question).then(function (payload) {
      appendMessage("assistant", payload.answer || "No answer returned.", payload.sources || [], payload);
    }).catch(function () {
      var fallback = "Sorry, the support assistant is unavailable right now.";
      if (settings.support_email) fallback += " You can contact support at " + settings.support_email + ".";
      appendMessage("assistant", fallback);
    }).finally(function () {
      setLoading(false);
    });
  }

  function postQuestion(question) {
    return fetch(apiBase + "/api/v1/widget/chat", {
      method: "POST",
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        company_id: companyId,
        visitor_id: visitorId,
        question: question
      })
    }).then(function (response) {
      if (!response.ok) throw new Error("chat_failed");
      return response.json();
    });
  }

  function appendMessage(role, text, sources, meta) {
    var item = document.createElement("div");
    item.className = "sd-message sd-" + role;
    var bubble = document.createElement("div");
    bubble.className = "sd-bubble";
    bubble.textContent = text;
    item.appendChild(bubble);

    if (meta && typeof meta.confidence_score === "number") {
      var status = document.createElement("div");
      status.className = "sd-status";
      status.textContent = (meta.status === "resolved" ? "Resolved" : "Needs human") + " · Confidence " + Math.round(meta.confidence_score * 100) + "%";
      item.appendChild(status);
    }

    if (sources && sources.length) {
      var details = document.createElement("details");
      details.className = "sd-sources";
      var summary = document.createElement("summary");
      summary.textContent = "Sources";
      details.appendChild(summary);
      sources.slice(0, 3).forEach(function (source) {
        var sourceItem = document.createElement("div");
        sourceItem.className = "sd-source";
        sourceItem.textContent = (source.title || "Document") + " · chunk " + source.chunk_index + " · " + Math.round((source.score || 0) * 100) + "%";
        details.appendChild(sourceItem);
      });
      item.appendChild(details);
    }

    messages.appendChild(item);
    messages.scrollTop = messages.scrollHeight;
  }

  function setLoading(loading) {
    send.disabled = loading;
    input.disabled = loading;
    send.textContent = loading ? "..." : "Send";
  }

  function autosize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 110) + "px";
  }

  function getOrCreateVisitorId(key) {
    try {
      var existing = window.localStorage.getItem(key);
      if (existing) return existing;
      var generated = "visitor_" + (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
      window.localStorage.setItem(key, generated);
      return generated;
    } catch (error) {
      return "visitor_" + Math.random().toString(36).slice(2);
    }
  }

  function css() {
    return '' +
      ':host{all:initial;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#0f172a}' +
      '.sd-widget{--sd-primary:#2563eb;position:fixed;z-index:2147483647;right:20px;bottom:20px;font-family:inherit}' +
      '.sd-launcher{width:58px;height:58px;border-radius:999px;border:0;background:var(--sd-primary);color:#fff;box-shadow:0 18px 45px rgba(15,23,42,.28);cursor:pointer;font-size:24px;font-weight:800;display:grid;place-items:center}' +
      '.sd-launcher:hover{filter:brightness(.96);transform:translateY(-1px)}' +
      '.sd-launcher-icon{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:999px;border:2px solid rgba(255,255,255,.75)}' +
      '.sd-panel{position:absolute;right:0;bottom:74px;width:380px;max-width:calc(100vw - 28px);height:560px;max-height:calc(100vh - 110px);background:#fff;border:1px solid rgba(148,163,184,.28);border-radius:22px;box-shadow:0 22px 70px rgba(15,23,42,.26);overflow:hidden;display:flex;flex-direction:column}' +
      '.sd-panel[hidden]{display:none}' +
      '.sd-header{display:flex;justify-content:space-between;align-items:center;padding:16px 18px;background:linear-gradient(135deg,var(--sd-primary),#0f172a);color:#fff}' +
      '.sd-header strong{display:block;font-size:15px;line-height:1.2}.sd-header span{font-size:12px;opacity:.8}' +
      '.sd-close{border:0;background:rgba(255,255,255,.14);color:#fff;width:32px;height:32px;border-radius:10px;cursor:pointer;font-size:18px}' +
      '.sd-messages{flex:1;padding:16px;overflow:auto;background:#f8fafc}' +
      '.sd-message{display:flex;flex-direction:column;margin:0 0 12px;max-width:90%}.sd-user{margin-left:auto;align-items:flex-end}.sd-assistant{margin-right:auto;align-items:flex-start}' +
      '.sd-bubble{white-space:pre-wrap;line-height:1.45;font-size:14px;padding:11px 13px;border-radius:16px;box-shadow:0 1px 3px rgba(15,23,42,.08)}' +
      '.sd-user .sd-bubble{background:var(--sd-primary);color:#fff;border-bottom-right-radius:5px}.sd-assistant .sd-bubble{background:#fff;color:#0f172a;border:1px solid #e2e8f0;border-bottom-left-radius:5px}' +
      '.sd-status{font-size:11px;color:#64748b;margin-top:5px}.sd-sources{font-size:11px;color:#475569;margin-top:6px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:7px 9px}.sd-sources summary{cursor:pointer;font-weight:700}.sd-source{margin-top:5px}' +
      '.sd-form{display:flex;gap:8px;align-items:flex-end;padding:12px;border-top:1px solid #e2e8f0;background:#fff}.sd-input{flex:1;resize:none;min-height:42px;max-height:110px;border:1px solid #cbd5e1;border-radius:14px;padding:11px 12px;font:inherit;font-size:14px;outline:none}.sd-input:focus{border-color:var(--sd-primary);box-shadow:0 0 0 3px rgba(37,99,235,.12)}' +
      '.sd-send{border:0;border-radius:13px;background:var(--sd-primary);color:#fff;font:inherit;font-weight:700;padding:11px 14px;cursor:pointer}.sd-send:disabled{opacity:.65;cursor:not-allowed}' +
      '@media (max-width:480px){.sd-widget{right:14px;bottom:14px}.sd-panel{position:fixed;left:10px;right:10px;bottom:84px;width:auto;height:min(580px,calc(100vh - 100px));max-width:none}.sd-launcher{width:56px;height:56px}}';
  }
})();
