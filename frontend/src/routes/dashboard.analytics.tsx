/**
 * @file Tenant analytics route visualizing backend conversation aggregates and source usage.
 * Show retrieval similarity as a heuristic and AI resolution independently from later human
 * replies. Daily charts and recent questions come from the same shared analytics query rather
 * than client-generated sample data.
 */

import { createFileRoute } from "@tanstack/react-router";
import { ChartNoAxesCombined } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DashboardHeader } from "@/components/dashboard-header";
import { QueryState } from "@/components/query-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/metric-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { TrendingUp, Gauge, MessageSquare, AlertCircle } from "lucide-react";
import { useAnalytics } from "@/hooks/use-data";
import { timeAgo } from "@/lib/api";

export const Route = createFileRoute("/dashboard/analytics")({
  /**
   * Set the tenant analytics document title.
   */
  head: () => ({ meta: [{ title: "Analytics — SupportDeflect AI" }] }),
  component: Analytics,
});

const COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

/**
 * Handle query states, derive display-only summaries and render reporting charts/tables from
 * server totals, recent outcomes and evidence references.
 */
function Analytics() {
  const query = useAnalytics();
  const { data } = query;
  if (query.isPending || query.isError)
    return (
      <>
        <DashboardHeader
          title="Analytics"
          description="Deep dive into your assistant's performance."
        />
        <div className="p-6">
          <QueryState pending={query.isPending} error={query.error} />
        </div>
      </>
    );

  const totalConversations = data?.total_questions ?? 0;
  const answerRate = Math.round((data?.answer_rate ?? 0) * 100);
  const avgRetrievalScore = (data?.average_confidence ?? 0).toFixed(2);
  const unresolved = data?.unresolved_questions ?? 0;
  const latest = data?.latest_questions ?? [];
  const conversationsByDay = (data?.daily ?? [])
    .slice(-7)
    .map((row) => ({ ...row, day: row.date.slice(5) }));
  const topDocuments = data?.top_documents ?? [];
  const unresolvedList = data?.frequent_unresolved ?? [];

  const insights: string[] = [];
  if (answerRate > 0)
    insights.push(
      `AI answered ${answerRate}% of visitor questions. Customer resolution is not confirmed.`,
    );
  if (topDocuments[0]) insights.push(`"${topDocuments[0].title}" is your most referenced source.`);
  if (unresolved > 0)
    insights.push(
      `${unresolved} question(s) were escalated. Check the Inbox for their current status.`,
    );
  if (insights.length === 0)
    insights.push("Visitor questions from your installed widget will appear here.");

  return (
    <>
      <DashboardHeader
        title="Analytics"
        description="Deep dive into your assistant's performance."
      />
      <div className="space-y-6 p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Visitor questions"
            value={totalConversations.toLocaleString()}
            icon={MessageSquare}
          />
          <MetricCard title="AI answer rate" value={`${answerRate}%`} icon={TrendingUp} />
          <MetricCard title="Avg retrieval score" value={avgRetrievalScore} icon={Gauge} />
          <MetricCard title="Escalated questions" value={String(unresolved)} icon={AlertCircle} />
        </div>
        <p className="text-sm text-muted-foreground">
          Widget questions only; greetings and Playground tests are excluded. The AI answer rate
          counts documented answers without human escalation. AI answers do not confirm issue
          resolution or support deflection. {data?.clarification_questions ?? 0} clarifications,{" "}
          {data?.provider_failures ?? 0} service failures, {data?.human_resolved_cases ?? 0}{" "}
          human-resolved cases. {data?.legacy_interactions ?? 0} historical interactions have no
          recorded outcome and are excluded.
        </p>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>AI answers vs visitor questions</CardTitle>
              <p className="text-sm text-muted-foreground">Last 7 days</p>
            </CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={conversationsByDay}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--color-border)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="day"
                      stroke="var(--color-muted-foreground)"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      stroke="var(--color-muted-foreground)"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar
                      isAnimationActive={false}
                      dataKey="resolved"
                      name="AI answered"
                      fill="var(--color-chart-3)"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      isAnimationActive={false}
                      dataKey="conversations"
                      name="Visitor questions"
                      fill="var(--color-chart-1)"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Top sources</CardTitle>
              <p className="text-sm text-muted-foreground">Most referenced documents</p>
            </CardHeader>
            <CardContent>
              <div className="h-72">
                {topDocuments.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    No source usage yet
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        isAnimationActive={false}
                        data={topDocuments}
                        dataKey="count"
                        nameKey="title"
                        innerRadius={50}
                        outerRadius={90}
                        paddingAngle={2}
                      >
                        {topDocuments.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          background: "var(--color-card)",
                          border: "1px solid var(--color-border)",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>Most escalated questions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {unresolvedList.length === 0 && (
                <p className="px-2 py-6 text-sm text-muted-foreground">
                  No escalated questions recorded.
                </p>
              )}
              {unresolvedList.map((q) => (
                <div
                  key={q.question}
                  className="flex items-center justify-between gap-3 rounded-md px-2 py-2.5 hover:bg-muted/40"
                >
                  <div className="min-w-0 break-words text-sm font-medium">{q.question}</div>
                  <Badge variant="outline" className="shrink-0 whitespace-nowrap">
                    {q.count}× asked
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ChartNoAxesCombined className="h-4 w-4 text-primary" /> AI insights
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {insights.map((i) => (
                <div
                  key={i}
                  className="rounded-lg border-l-2 border-primary bg-primary/5 px-3 py-2 text-sm"
                >
                  {i}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Recent conversations</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Question</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Retrieval score</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {latest.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    No conversations yet.
                  </TableCell>
                </TableRow>
              )}
              {latest.map((q) => (
                <TableRow key={q.id}>
                  <TableCell className="font-medium max-w-md truncate">{q.question}</TableCell>
                  <TableCell className="text-muted-foreground">{q.channel}</TableCell>
                  <TableCell className="tabular-nums">{q.confidence_score.toFixed(2)}</TableCell>
                  <TableCell>
                    <StatusBadge
                      status={
                        q.status === "resolved"
                          ? "Answered"
                          : q.status === "clarification_needed"
                            ? "Clarification"
                            : q.outcome === "provider_failure"
                              ? "Service unavailable"
                              : "Escalated"
                      }
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{timeAgo(q.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    </>
  );
}
