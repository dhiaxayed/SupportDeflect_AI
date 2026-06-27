import { createFileRoute, Link } from "@tanstack/react-router";
import {
  MessageSquare,
  TrendingUp,
  FileText,
  Gauge,
  AlertCircle,
  ArrowRight,
  Upload,
  Code2,
} from "lucide-react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { DashboardHeader } from "@/components/dashboard-header";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { WidgetPreview } from "@/components/widget-preview";
import { useAnalytics, useDocuments } from "@/hooks/use-data";
import { formatDate, mapDocStatus, timeAgo, type AnalyticsQuestion } from "@/lib/api";

export const Route = createFileRoute("/dashboard/")({
  head: () => ({ meta: [{ title: "Overview — SupportDeflect AI" }] }),
  component: Overview,
});

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

function Overview() {
  const { data: analytics } = useAnalytics();
  const { data: documents } = useDocuments();

  const totalConversations = analytics?.total_questions ?? 0;
  const deflectionRate = Math.round((analytics?.resolution_rate ?? 0) * 100);
  const indexedDocuments = (documents ?? []).filter((d) => d.status === "indexed").length;
  const avgConfidence = Math.round((analytics?.average_confidence ?? 0) * 100);
  const unresolved = analytics?.unresolved_questions ?? 0;
  const recentQuestions = analytics?.latest_questions ?? [];
  const conversationsByDay = buildConversationsByDay(recentQuestions);
  const recentDocs = (documents ?? []).slice(0, 5);

  return (
    <>
      <DashboardHeader
        title="Overview"
        description="A summary of your assistant's performance this week."
      />
      <div className="space-y-6 p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <MetricCard
            title="Conversations"
            value={totalConversations.toLocaleString()}
            icon={MessageSquare}
            description="all time"
          />
          <MetricCard
            title="Deflection rate"
            value={`${deflectionRate}%`}
            icon={TrendingUp}
            description="resolved"
          />
          <MetricCard
            title="Indexed docs"
            value={String(indexedDocuments)}
            icon={FileText}
            description="ready"
          />
          <MetricCard
            title="Avg confidence"
            value={`${avgConfidence}%`}
            icon={Gauge}
            description="all answers"
          />
          <MetricCard
            title="Unresolved"
            value={String(unresolved)}
            icon={AlertCircle}
            description="needs review"
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Conversations</CardTitle>
                <p className="text-sm text-muted-foreground">Last 7 days</p>
              </div>
              <Badge variant="outline">Live</Badge>
            </CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={conversationsByDay}>
                    <defs>
                      <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
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
                    <Area
                      type="monotone"
                      dataKey="conversations"
                      stroke="var(--color-chart-1)"
                      strokeWidth={2}
                      fill="url(#g1)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quick actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button asChild variant="outline" className="w-full justify-between">
                <Link to="/dashboard/upload">
                  <span className="flex items-center gap-2">
                    <Upload className="h-4 w-4" /> Upload documents
                  </span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="w-full justify-between">
                <Link to="/dashboard/playground">
                  <span className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" /> Test assistant
                  </span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="w-full justify-between">
                <Link to="/dashboard/widget">
                  <span className="flex items-center gap-2">
                    <Code2 className="h-4 w-4" /> Embed widget
                  </span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="w-full justify-between">
                <Link to="/dashboard/analytics">
                  <span className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" /> View analytics
                  </span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Recent questions</CardTitle>
                <p className="text-sm text-muted-foreground">Last conversations from your widget</p>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link to="/dashboard/analytics">View all</Link>
              </Button>
            </CardHeader>
            <CardContent className="space-y-1">
              {recentQuestions.length === 0 && (
                <p className="px-2 py-6 text-sm text-muted-foreground">
                  No conversations yet. Try the assistant in the Playground.
                </p>
              )}
              {recentQuestions.slice(0, 6).map((q) => (
                <div
                  key={q.id}
                  className="flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-muted/40"
                >
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm font-medium">{q.question}</div>
                    <div className="text-xs text-muted-foreground">
                      {q.channel} · {timeAgo(q.created_at)}
                    </div>
                  </div>
                  <Badge variant="outline" className="hidden sm:inline-flex">
                    {Math.round(q.confidence_score * 100)}%
                  </Badge>
                  <StatusBadge status={q.status === "resolved" ? "Resolved" : "Unresolved"} />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Widget preview</CardTitle>
            </CardHeader>
            <CardContent>
              <WidgetPreview />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Recently added documents</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link to="/dashboard/documents">View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-1">
            {recentDocs.length === 0 && (
              <p className="px-2 py-6 text-sm text-muted-foreground">
                No documents yet. Upload your first source to get started.
              </p>
            )}
            {recentDocs.map((d) => (
              <div
                key={d.id}
                className="flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-muted/40"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <FileText className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-medium">{d.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {d.chunk_count} chunks · {formatDate(d.created_at)}
                  </div>
                </div>
                <StatusBadge status={mapDocStatus(d.status)} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
