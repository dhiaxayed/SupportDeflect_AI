/**
 * @file Tenant route adapter for the shared protected ChatPlayground. Keep route metadata and
 * page framing here; conversation history, diagnostics, evidence display and analytics/quota
 * refresh belong to the reusable playground component.
 */

import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/dashboard-header";
import { ChatPlayground } from "@/components/chat-playground";

export const Route = createFileRoute("/dashboard/playground")({
  /**
   * Set the administrator chat-testing page title.
   */
  head: () => ({ meta: [{ title: "Playground — SupportDeflect AI" }] }),
  component: Playground,
});

/**
 * Place ChatPlayground under its standard tenant page heading so the route reuses the existing
 * authenticated chat workflow.
 */
function Playground() {
  return (
    <>
      <DashboardHeader
        title="Playground"
        description="Test your assistant before embedding the widget."
      />
      <div className="p-6">
        <ChatPlayground />
      </div>
    </>
  );
}
