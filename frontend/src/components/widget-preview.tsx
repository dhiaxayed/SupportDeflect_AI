/**
 * @file Live Studio iframe adapter loading the same standalone widget renderer used by
 * customer snippets. Send draft configuration to the exact frame origin and bridge preview
 * questions to protected /chat in the parent. The administrator JWT stays out of iframe
 * messages, and source/origin checks reject unrelated windows.
 */

import { useEffect, useRef, useState } from "react";
import { Monitor, Smartphone, MessageCircle } from "lucide-react";
import { apiRequest, publicApiUrl, type BackendChatResponse, type WidgetSettings } from "@/lib/api";
import { defaultDesign } from "@/lib/widget-design";
import { useWidgetSettings } from "@/hooks/use-data";

/**
 * Render a controlled desktop/mobile preview stage, synchronize supplied or saved settings
 * with the iframe, and remove the message listener when dependencies or the component change.
 */
export function WidgetPreview({
  settings: provided,
  className = "",
}: {
  settings?: WidgetSettings;
  className?: string;
}) {
  const { data } = useWidgetSettings();
  const settings = provided ?? data;
  const iframe = useRef<HTMLIFrameElement>(null);
  const [mobile, setMobile] = useState(false);
  const url = publicApiUrl() + "/widget/preview";
  useEffect(() => {
    const origin = new URL(url, window.location.href).origin;
    /**
     * Post the current settings plus design defaults only to this instance's preview origin;
     * repeat on the frame's ready event to cover either loading order.
     */
    const sendConfig = () =>
      iframe.current?.contentWindow?.postMessage(
        {
          type: "sd:config",
          settings: settings && { ...settings, design: settings.design ?? defaultDesign },
        },
        origin,
      );
    /**
     * Accept ready/questions only from the expected iframe and origin. Forward questions
     * through the authenticated parent API and return a correlated answer/error without
     * exposing the bearer token.
     */
    const listener = (event: MessageEvent) => {
      if (event.source !== iframe.current?.contentWindow || event.origin !== origin) return;
      if (event.data?.type === "sd:ready") sendConfig();
      if (event.data?.type === "sd:question" && typeof event.data.question === "string") {
        // JWT stays in the parent application; the public preview frame never receives it.
        apiRequest<BackendChatResponse>("/chat", {
          method: "POST",
          body: JSON.stringify({
            question: event.data.question,
            history: event.data.history ?? [],
          }),
        })
          .then((payload) =>
            iframe.current?.contentWindow?.postMessage(
              { type: "sd:answer", id: event.data.id, payload },
              origin,
            ),
          )
          .catch((error) =>
            iframe.current?.contentWindow?.postMessage(
              { type: "sd:answer", id: event.data.id, error: String(error) },
              origin,
            ),
          );
      }
    };
    window.addEventListener("message", listener);
    sendConfig();
    return () => window.removeEventListener("message", listener);
  }, [url, settings]);

  return (
    <div className={"studio-preview " + className}>
      <div className="studio-preview-toolbar">
        <span>Live preview</span>
        <div role="group" aria-label="Preview viewport">
          <button
            type="button"
            aria-label="Desktop preview"
            title="Desktop preview"
            aria-pressed={!mobile}
            onClick={() => setMobile(false)}
          >
            <Monitor size={18} />
          </button>
          <button
            type="button"
            aria-label="Mobile preview"
            title="Mobile preview"
            aria-pressed={mobile}
            onClick={() => setMobile(true)}
          >
            <Smartphone size={18} />
          </button>
          <button
            type="button"
            aria-label="Open preview chat"
            title="Open preview chat"
            onClick={() =>
              iframe.current?.contentWindow?.postMessage(
                { type: "sd:open", open: true },
                new URL(url, location.href).origin,
              )
            }
          >
            <MessageCircle size={18} />
          </button>
        </div>
      </div>
      <div className="studio-preview-stage">
        <iframe
          ref={iframe}
          src={url}
          title="Widget live preview"
          sandbox="allow-scripts allow-same-origin allow-forms"
          style={{ width: mobile ? "390px" : "100%" }}
        />
      </div>
    </div>
  );
}
