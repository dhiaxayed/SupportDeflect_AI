import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/dashboard-header";
import { ChatPlayground } from "@/components/chat-playground";

export const Route = createFileRoute("/dashboard/playground")({
  head: () => ({ meta: [{ title: "Playground — SupportDeflect AI" }] }),
  component: Playground,
});

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
