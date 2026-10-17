/**
 * @file Tenant overview route combining real analytics and document-query results. Display
 * conversation/ingestion indicators, recent outcomes and useful empty states from shared
 * hooks, so imports and Playground activity become visible through the same invalidated
 * caches.
 */

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
import { QueryState } from "@/components/query-state";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { useAnalytics, useDocuments } from "@/hooks/use-data";
import { formatDate, mapDocStatus, timeAgo } from "@/lib/api";

export const Route = createFileRoute("/dashboard/")({
  /**
   * Set the tenant overview document title for navigation and SSR.
   */
  head: () => ({ meta: [{ title: "Overview — SupportDeflect AI" }] }),
  component: Overview,
});

/**
 * Compose tenant metrics, source status and recent questions from shared queries; distinguish
 * loading/error/empty results instead of populating demonstration data.
 */
function Overview() {
  const analyticsQuery = useAnalytics();
  const documentsQuery = useDocuments();
  const { data: analytics } = analyticsQuery;
  const { data: documents } = documentsQuery;
  if (
    analyticsQuery.isPending ||
    analyticsQuery.isError ||
    documentsQuery.isPending ||
    documentsQuery.isError
  )
    return (
      <>
        <DashboardHeader
          title="Overview"
          description="All-time activity and the last seven days (UTC)."
        />
        <div className="p-6">
          <QueryState
            pending={analyticsQuery.isPending || documentsQuery.isPending}
            error={analyticsQuery.error || documentsQuery.error}
          />
        </div>
      </>
    );

  const totalConversations = analytics?.total_questions ?? 0;
  const answerRate = Math.round((analytics?.answer_rate ?? 0) * 100);
  const indexedDocuments = (documents ?? []).filter((d) => d.status === "indexed").length;
  const avgRetrievalScore = (analytics?.average_confidence ?? 0).toFixed(2);
  const unresolved = analytics?.unresolved_questions ?? 0;
  const recentQuestions = analytics?.latest_questions ?? [];
  const conversationsByDay = (analytics?.daily ?? [])
    .slice(-7)
    .map((row) => ({ ...row, day: row.date.slice(5) }));
  const recentDocs = (documents ?? []).slice(0, 5);

  return (
    <>
      <DashboardHeader
        title="Overview"
        description="All-time activity and the last seven days (UTC)."
      />
      <div className="space-y-6 p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            title="Visitor questions"
            value={totalConversations.toLocaleString()}
            icon={MessageSquare}
            description="all time"
          />
          <MetricCard
            title="AI answer rate"
            value={`${answerRate}%`}
            icon={TrendingUp}
            description="resolution unconfirmed"
          />
          <MetricCard
            title="Indexed docs"
            value={String(indexedDocuments)}
            icon={FileText}
            description="ready"
          />
          <MetricCard
            title="Avg retrieval score"
            value={avgRetrievalScore}
            icon={Gauge}
            description="AI-only answers"
          />
          <MetricCard
            title="Escalated questions"
            value={String(unresolved)}
            icon={AlertCircle}
            description="ever escalated"
          />
        </div>

        <p className="text-sm text-muted-foreground">
          Visitor questions only; greetings and Playground tests are excluded. The AI answer rate
          counts documented answers without human escalation. AI answers do not confirm issue
          resolution. {analytics?.legacy_interactions ?? 0} historical interactions have no recorded
          outcome and are excluded.
        </p>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
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
                      isAnimationActive={false}
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

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Recent questions</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Latest visitor questions from the widget
                </p>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link to="/dashboard/analytics">View all</Link>
              </Button>
            </CardHeader>
            <CardContent className="space-y-1">
              {recentQuestions.length === 0 && (
                <p className="px-2 py-6 text-sm text-muted-foreground">
                  No visitor questions yet. Install the widget to receive questions.
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
                    {q.confidence_score.toFixed(2)}
                  </Badge>
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
                </div>
              ))}
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
