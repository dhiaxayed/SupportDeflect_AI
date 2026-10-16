/**
 * @file Tenant subscription and usage presentation. Read actual entitlements and effective
 * status from the server, show rolling counters against limits, and reuse public plan
 * descriptions without inventing prices or letting tenant administrators change their own
 * commercial plan.
 */

import { DashboardHeader } from "@/components/dashboard-header";
import { QueryState } from "@/components/query-state";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";
import { subscriptionPlans } from "@/lib/subscription-plans";
import { useSubscriptionUsage } from "@/hooks/use-data";

/**
 * Render current plan availability, expiration and quota utilization with a manual-upgrade
 * contact flow; authoritative operations remain enforced by backend subscription checks.
 */
export function Billing() {
  const query = useSubscriptionUsage();
  const usage = query.data;
  return (
    <>
      <DashboardHeader
        title="Subscription & usage"
        description="Manage your subscription and follow your workspace activity."
      />
      <div className="space-y-6 p-6">
        <QueryState pending={query.isPending} error={query.error} />
        {usage && (
          <>
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
                <div>
                  <CardTitle>Current usage</CardTitle>
                  <p className="text-sm text-muted-foreground mt-2 capitalize">
                    {usage.effective_status ?? usage.status}
                  </p>
                  {usage.trial_ends_at && (
                    <p className="text-sm mt-2">
                      Trial ends {new Date(usage.trial_ends_at).toLocaleDateString()}
                    </p>
                  )}
                  {usage.subscription_ends_at && (
                    <p className="text-sm mt-2">
                      Subscription ends {new Date(usage.subscription_ends_at).toLocaleDateString()}
                    </p>
                  )}
                </div>
                <Badge aria-label="Current subscription plan">{usage.plan_label}</Badge>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  {[
                    [
                      "Questions, last 30 days",
                      usage.questions_used_30d,
                      usage.questions_limit_30d,
                    ],
                    ["Documents", usage.documents_used, usage.documents_limit],
                    ["Knowledge chunks", usage.chunks_used, usage.chunks_limit],
                  ].map(([label, used, limit]) => (
                    <div key={String(label)}>
                      <div className="flex flex-wrap justify-between gap-2 text-sm">
                        <span>{label}</span>
                        <span>
                          {Number(used).toLocaleString()} / {Number(limit).toLocaleString()}
                        </span>
                      </div>
                      <Progress
                        value={Math.min(100, (Number(used) / Math.max(1, Number(limit))) * 100)}
                        className="mt-2 h-2"
                      />
                    </div>
                  ))}
                </div>
                <p className="mt-6 text-sm">
                  Maximum upload: {usage.max_upload_bytes / 1024 / 1024} MB
                </p>
                <p className="mt-2 text-sm text-muted-foreground">{usage.manual_upgrade_label}</p>
              </CardContent>
            </Card>
            <div className="grid gap-5 lg:grid-cols-3">
              {subscriptionPlans.map((plan) => (
                <Card
                  key={plan.name}
                  className={
                    usage.plan_label === plan.name
                      ? "ring-2 ring-primary shadow-[var(--shadow-elegant)]"
                      : ""
                  }
                >
                  <CardHeader>
                    <CardTitle>{plan.name}</CardTitle>
                    <p className="pt-2 text-2xl font-semibold">{plan.price}</p>
                    <p className="text-sm text-muted-foreground">{plan.desc}</p>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-3 text-sm">
                      {plan.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2">
                          <Check size={16} className="mt-0.5 shrink-0 text-success" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                    {usage.plan_label === plan.name && (
                      <Badge variant="outline" className="mt-5">
                        Current plan
                      </Badge>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Subscription management</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Your subscription is managed by the SupportDeflect administrator. Contact them to
                change your plan or extend your subscription period.
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
