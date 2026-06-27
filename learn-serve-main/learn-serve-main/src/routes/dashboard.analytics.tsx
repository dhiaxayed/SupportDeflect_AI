import { createFileRoute } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
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
import { timeAgo, type AnalyticsQuestion } from "@/lib/api";

export const Route = createFileRoute("/dashboard/analytics")({
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

function buildConversationsByDay(questions: AnalyticsQuestion[]) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const buckets = Array.from({ length: 7 }, (_, i) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - i));
    return { date, day: days[date.getDay()], conversations: 0, resolved: 0 };
  });
  for (const q of questions) {
    const created = new Date(q.created_at);
    created.setHours(0, 0, 0, 0);
    const bucket = buckets.find((b) => b.date.getTime() === created.getTime());
    if (bucket) {
      bucket.conversations += 1;
      if (q.status === "resolved") bucket.resolved += 1;
    }
  }
  return buckets;
}

function topUnresolved(questions: AnalyticsQuestion[]) {
  const counter = new Map<string, number>();
  for (const q of questions) {
    counter.set(q.question, (counter.get(q.question) ?? 0) + 1);
  }
  return Array.from(counter.entries())
    .map(([question, count]) => ({ question, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}

function Analytics() {
  const { data } = useAnalytics();

  const totalConversations = data?.total_questions ?? 0;
  const deflectionRate = Math.round((data?.resolution_rate ?? 0) * 100);
  const avgConfidence = Math.round((data?.average_confidence ?? 0) * 100);
  const unresolved = data?.unresolved_questions ?? 0;
  const latest = data?.latest_questions ?? [];
  const unanswered = data?.unanswered_questions ?? [];
  const conversationsByDay = buildConversationsByDay(latest);
  const topDocuments = data?.top_documents ?? [];
  const unresolvedList = topUnresolved(unanswered);

  const insights: string[] = [];
  if (deflectionRate > 0)
    insights.push(`Your assistant resolves ${deflectionRate}% of questions automatically.`);
  if (topDocuments[0]) insights.push(`"${topDocuments[0].title}" is your most referenced source.`);
  if (unresolved > 0)
    insights.push(`${unresolved} question(s) need human review — consider adding documentation.`);
  if (insights.length === 0)
    insights.push("Start a few conversations in the Playground to generate insights.");

  return (
    <>
      <DashboardHeader
        title="Analytics"
        description="Deep dive into your assistant's performance."
      />
      <div className="space-y-6 p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Conversations"
            value={totalConversations.toLocaleString()}
            icon={MessageSquare}
          />
          <MetricCard title="Deflection rate" value={`${deflectionRate}%`} icon={TrendingUp} />
          <MetricCard title="Avg confidence" value={`${avgConfidence}%`} icon={Gauge} />
          <MetricCard title="Unresolved" value={String(unresolved)} icon={AlertCircle} />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Resolved vs Total</CardTitle>
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
                    <Bar dataKey="resolved" fill="var(--color-chart-3)" radius={[4, 4, 0, 0]} />
                    <Bar
                      dataKey="conversations"
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

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Top unresolved questions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {unresolvedList.length === 0 && (
                <p className="px-2 py-6 text-sm text-muted-foreground">
                  No unresolved questions — nice work!
                </p>
              )}
              {unresolvedList.map((q) => (
                <div
                  key={q.question}
                  className="flex items-center justify-between rounded-md px-2 py-2.5 hover:bg-muted/40"
                >
                  <div className="text-sm font-medium">{q.question}</div>
                  <Badge variant="outline">{q.count}× asked</Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" /> AI insights
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
                <TableHead>Confidence</TableHead>
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
                  <TableCell className="tabular-nums">
                    {Math.round(q.confidence_score * 100)}%
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={q.status === "resolved" ? "Resolved" : "Unresolved"} />
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
