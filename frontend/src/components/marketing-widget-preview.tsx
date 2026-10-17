/** The production renderer, in an opaque sandbox, with a local scripted answer bridge. */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Check, RotateCcw } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useReducedMotion } from "motion/react";
import { demoScenarios } from "@/components/marketing/demo-data";
import { defaultDesign } from "@/lib/widget-design";
// Byte-for-byte snapshot of backend/app/static/widget.js. Keep the frontend Docker
// build self-contained; scripts/sync-marketing-widget.mjs checks or refreshes it.
const rendererUrl = "/demo/widget/script.js";

const colors = [
  ["Royal blue", "#2167e8"],
  ["Blue", "#226dd8"],
  ["Graphite", "#30394c"],
] as const;

// This adapter only submits the real widget's native form from the sample-question buttons.
// The renderer, markup, CSS, keyboard behavior and source disclosure remain unchanged.
const sampleAdapter = `
  const allowedParent = new URL(document.referrer).origin;
  addEventListener('message', (event) => {
    if (event.source !== parent || event.origin !== allowedParent) return;
    if (event.data?.type === 'sd:config') {
      parent.postMessage({type: 'marketing:ready'}, allowedParent);
      return;
    }
    if (event.data?.type !== 'marketing:ask') return;
    const root = document.querySelector('[data-supportdeflect="preview"]')?.shadowRoot;
    const input = root?.querySelector('.sd-input');
    if (!input || input.disabled) return;
    root.querySelector('.sd-launcher').getAttribute('aria-expanded') === 'false' && root.querySelector('.sd-launcher').click();
    input.value = event.data.question;
    root.querySelector('.sd-form').requestSubmit();
  });
`;

/** Host the unchanged renderer in an opaque sandbox and answer its bridge with local samples. */
export function MarketingWidgetPreview() {
  const frame = useRef<HTMLIFrameElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reduce = useReducedMotion();
  const reduceRef = useRef(reduce);
  useEffect(() => {
    reduceRef.current = reduce;
  }, [reduce]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [color, setColor] = useState<string>(colors[0][1]);
  const [revision, setRevision] = useState(0);
  const settings = useMemo(
    () => ({
      brand_name: "SupportDeflect AI",
      primary_color: color,
      greeting_message: "Hi! How can I help you today?",
      design: {
        ...defaultDesign,
        identity: "robot",
        offset_x: 14,
        offset_y: 14,
        open_behavior: "open",
      },
    }),
    [color],
  );
  const documentSource = useMemo(
    () =>
      `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>SupportDeflect widget demonstration</title></head><body style="margin:0"><script data-preview="true" src="${rendererUrl}"></script><script>${sampleAdapter}</script></body></html>`,
    [],
  );

  useEffect(() => {
    /** Deliver public settings/responses only to this opaque-origin iframe. */
    const send = (value: unknown) => frame.current?.contentWindow?.postMessage(value, "*");
    /** Correlate ready/question messages with this frame and cancel scripted replies on cleanup. */
    const listener = (event: MessageEvent) => {
      // Opaque-origin sandbox: bind the bridge to this exact frame. Only public samples
      // cross it. No credentials, API calls or accessible browser storage are involved.
      if (event.source !== frame.current?.contentWindow || event.origin !== "null") return;
      if (event.data?.type === "sd:ready") {
        send({ type: "sd:config", settings });
      }
      if (event.data?.type === "marketing:ready") {
        setReady(true);
      }
      if (event.data?.type !== "sd:question" || typeof event.data.question !== "string") return;
      const index = demoScenarios.findIndex(
        (item) => item.question.toLowerCase() === event.data.question.trim().toLowerCase(),
      );
      const scenario = demoScenarios[index];
      setSelected(index < 0 ? null : index);
      setBusy(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(
        () => {
          send({
            type: "sd:answer",
            id: event.data.id,
            payload: {
              answer:
                scenario?.answer ??
                "This is a scripted demo. Try one of the three sample questions beside the widget to explore an example answer, its sources, or human support.",
              sources: scenario?.source
                ? [{ reference: 1, title: scenario.source, snippet: scenario.excerpt }]
                : [],
              needs_human: scenario?.id === "handoff",
            },
          });
          setBusy(false);
        },
        reduceRef.current ? 0 : 650,
      );
    };
    window.addEventListener("message", listener);
    send({ type: "sd:config", settings });
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener("message", listener);
    };
  }, [settings, revision]);

  /** Recreate the sandbox, cancelling pending answers and clearing its in-memory conversation. */
  const reset = () => {
    clearTimeout(timer.current);
    setBusy(false);
    setReady(false);
    setSelected(null);
    setRevision((value) => value + 1);
  };
  /** Bring the widget into view when necessary and submit its native form via the adapter. */
  const choose = (question: string) => {
    const bounds = stage.current?.getBoundingClientRect();
    if (bounds && (bounds.top < 80 || bounds.bottom > window.innerHeight - 16))
      stage.current?.scrollIntoView({
        block: "start",
        behavior: reduceRef.current ? "instant" : "smooth",
      });
    frame.current?.contentWindow?.postMessage({ type: "marketing:ask", question }, "*");
  };

  return (
    <div className="sd-product-demo" data-testid="marketing-demo">
      <div className="sd-product-demo-controls">
        <div className="sd-demo-authentic">
          <span className="sd-status-dot" /> REAL WIDGET. SAMPLE CONVERSATION.
        </div>
        <h3>
          Meet the widget
          <br />
          your customers get.
        </h3>
        <p>
          The same chat you embed on your site. Pick a question, inspect its source, or try the
          composer.
        </p>
        <div className="sd-demo-question-list" role="group" aria-label="Demo scenarios">
          {demoScenarios.map((item, index) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={selected === index}
              disabled={!ready || busy}
              onClick={() => choose(item.question)}
            >
              <span>0{index + 1}</span>
              <div>
                <strong>{item.label}</strong>
                <small>{item.question}</small>
              </div>
              <ArrowUpRight size={17} />
            </button>
          ))}
        </div>
        <div className="sd-demo-appearance">
          <div>
            <span>Make it yours</span>
            <small>Primary color · Widget Design Studio</small>
          </div>
          <div role="group" aria-label="Widget brand preview color">
            {colors.map(([name, value]) => (
              <button
                key={name}
                type="button"
                aria-label={`${name} brand preview`}
                aria-pressed={color === value}
                disabled={!ready || busy}
                style={{ backgroundColor: value }}
                onClick={() => setColor(value)}
              >
                {color === value && <Check size={13} />}
              </button>
            ))}
          </div>
        </div>
        <div className="sd-demo-sandbox-note">
          <span>SIMULATION</span>
          <p>
            Predefined answers and example sources.
            <br />
            No connected AI. No support ticket is created.
          </p>
        </div>
      </div>
      <div ref={stage} className="sd-widget-demo-stage">
        <div className="sd-demo-stage-heading">
          <span>YOUR WEBSITE, MEET YOUR ASSISTANT.</span>
          <button type="button" disabled={!ready} onClick={reset} aria-label="Restart demo">
            <RotateCcw size={14} /> Reset
          </button>
        </div>
        <div className="sd-demo-site-backdrop" aria-hidden="true">
          <span>
            Help, right
            <br />
            where it belongs.
          </span>
          <p>
            Your product. Your knowledge.
            <br />
            An assistant that fits right in.
          </p>
          <i />
          <i />
          <i />
        </div>
        <iframe
          key={revision}
          ref={frame}
          title="Interactive support widget"
          className="sd-real-widget-frame"
          sandbox="allow-scripts allow-forms"
          srcDoc={documentSource}
        />
        <noscript>
          <p className="sd-demo-noscript">
            Enable JavaScript to try the widget. The examples show document answers, sources and
            human support.
          </p>
        </noscript>
      </div>
      <div className="sd-product-demo-footer">
        <p>Same embedded widget · Sample responses</p>
        <Link to="/register">
          Connect your own knowledge <ArrowRight size={15} />
        </Link>
      </div>
    </div>
  );
}
