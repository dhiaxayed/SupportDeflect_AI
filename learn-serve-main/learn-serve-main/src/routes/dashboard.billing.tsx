import { createFileRoute } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { DashboardHeader } from "@/components/dashboard-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useSubscriptionUsage } from "@/hooks/use-data";

export const Route = createFileRoute("/dashboard/billing")({
  head: () => ({ meta: [{ title: "Billing — SupportDeflect AI" }] }),
  component: Billing,
});

const plans = [
  {
    name: "Starter",
    price: "Manual",
    desc: "For small teams validating support automation",
    features: ["25 documents", "2,000 questions / 30 days", "Widget branding", "Manual activation"],
  },
  {
    name: "Pro",
    price: "Manual",
    desc: "For growing teams",
    features: [
      "250 documents",
      "25,000 questions / 30 days",
      "Advanced analytics",
      "Priority manual support",
    ],
  },
  {
    name: "Enterprise",
    price: "Custom",
    desc: "For scale",
    features: ["Custom limits", "Security review", "SLA & DPA", "Dedicated onboarding"],
  },
];

function Billing() {
  const { data: usage } = useSubscriptionUsage();
  const questions = usage?.questions_used_30d ?? 0;
  const questionLimit = usage?.questions_limit_30d ?? 100;
  const documents = usage?.documents_used ?? 0;
  const documentLimit = usage?.documents_limit ?? 3;
  const chunks = usage?.chunks_used ?? 0;
  const chunkLimit = usage?.chunks_limit ?? 200;
  const questionUsage = Math.min(100, Math.round((questions / Math.max(questionLimit, 1)) * 100));
  const documentUsage = Math.min(100, Math.round((documents / Math.max(documentLimit, 1)) * 100));
  const chunkUsage = Math.min(100, Math.round((chunks / Math.max(chunkLimit, 1)) * 100));

  return (
    <>
      <DashboardHeader title="Billing & plans" description="Manage your subscription and usage." />
      <div className="space-y-6 p-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Current usage</CardTitle>
              <p className="text-sm text-muted-foreground">
                Measured from your workspace activity.
              </p>
            </div>
            <Badge>{usage?.plan_label ?? "Free Trial"}</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Questions, last 30 days</span>
                <span className="text-muted-foreground">
                  {questions.toLocaleString()} / {questionLimit.toLocaleString()}
                </span>
              </div>
              <Progress value={questionUsage} className="mt-2 h-2" />
            </div>
            <div>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Documents</span>
                <span className="text-muted-foreground">
                  {documents.toLocaleString()} / {documentLimit.toLocaleString()}
                </span>
              </div>
              <Progress value={documentUsage} className="mt-2 h-2" />
            </div>
            <div>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Knowledge chunks</span>
                <span className="text-muted-foreground">
                  {chunks.toLocaleString()} / {chunkLimit.toLocaleString()}
                </span>
              </div>
              <Progress value={chunkUsage} className="mt-2 h-2" />
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-5 md:grid-cols-3">
          {plans.map((p) => (
            <Card
              key={p.name}
              className={
                usage?.plan_label === p.name
                  ? "ring-2 ring-primary shadow-[var(--shadow-elegant)]"
                  : ""
              }
            >
              <CardHeader>
                {usage?.plan_label === p.name && <Badge className="w-fit mb-2">Current plan</Badge>}
                <CardTitle>{p.name}</CardTitle>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-3xl font-bold">{p.price}</span>
                </div>
                <p className="text-sm text-muted-foreground">{p.desc}</p>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-success" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  className="mt-6 w-full"
                  variant={usage?.plan_label === p.name ? "outline" : "default"}
                  disabled={usage?.plan_label === p.name}
                >
                  {usage?.plan_label === p.name ? "Current" : "Contact us"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Payment method</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Payments are handled manually. After a customer contacts support and payment is
            confirmed, update their `subscription_plan` and `subscription_status` directly in Neon.
          </CardContent>
        </Card>
      </div>
    </>
  );
}
