/**
 * @file Cross-organization business/usage views driven by getBusiness and controlled reporting
 * filters. Charts use server-aggregated series, retain currency separation and distinguish
 * contracted recurring revenue from recorded receipts. Shared chart components are also
 * embedded in the platform billing screen.
 */

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Download, Info, RefreshCw } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { QueryState } from "@/components/query-state";
import { AdminHeader, EmptyState, Metric, PeriodControls, StatusTag } from "@/components/admin-ui";
import {
  currencyScale,
  date,
  downloadLedger,
  getBusiness,
  money,
  number,
  type BusinessDashboard,
  type Currency,
} from "@/lib/admin-api";

const COLORS: Record<string, string> = {
  trial: "var(--muted-foreground)",
  starter: "var(--chart-1)",
  pro: "var(--chart-3)",
  enterprise: "var(--chart-5)",
};
const riskLabels: Record<string, string> = {
  past_due: "Payment follow-up",
  expired: "Period has expired",
  expiring: "Ends within 7 days",
  no_documents: "No knowledge base",
  no_widget_domain: "Widget not connected",
  inactive: "No activity this period",
};
const tick = { fill: "var(--muted-foreground)", fontSize: 10 };
const tooltipStyle = {
  borderRadius: 8,
  fontSize: 12,
  border: "1px solid var(--border)",
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  boxShadow: "var(--shadow-card)",
};
/**
 * Format a UTC reporting bucket for chart axes without shifting it into the viewer's local
 * calendar day.
 */
const formatDay = (value: string) =>
  new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });

/**
 * Plot backend daily questions/resolutions using the supplied reporting dataset; no demo
 * points or inferred support-cost savings are added.
 */
export function ActivityChart({ data }: { data: BusinessDashboard }) {
  return (
    <>
      <div
        className="admin-chart"
        role="img"
        aria-label="Daily questions and automatic resolutions"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data.series}
            barGap={2}
            margin={{ top: 10, right: 10, left: -24, bottom: 0 }}
          >
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="date"
              tickFormatter={formatDay}
              tick={tick}
              axisLine={false}
              tickLine={false}
              minTickGap={35}
            />
            <YAxis tick={tick} allowDecimals={false} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => date(String(v))} />
            <Bar
              dataKey="questions"
              name="Questions"
              fill="var(--chart-1)"
              maxBarSize={18}
              isAnimationActive={false}
            />
            <Bar
              dataKey="resolved"
              name="AI resolved"
              fill="var(--chart-3)"
              maxBarSize={18}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="admin-chart-legend">
        <span>
          <i style={{ background: "var(--chart-1)" }} />
          Questions
        </span>
        <span>
          <i style={{ background: "var(--chart-3)" }} />
          AI resolved
        </span>
      </div>
    </>
  );
}

/**
 * Plot recorded net receipt series for the response's selected currency; this is distinct from
 * contracted MRR/ARR.
 */
export function RevenueChart({ data }: { data: BusinessDashboard }) {
  return (
    <>
      <div className="admin-chart" role="img" aria-label={"Daily net receipts in " + data.currency}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data.series} margin={{ top: 10, right: 10, left: -12, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="date"
              tickFormatter={formatDay}
              tick={tick}
              axisLine={false}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              tick={tick}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => number(v / currencyScale(data.currency))}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(v) => date(String(v))}
              formatter={(v) => [money(Number(v), data.currency), "Net receipts"]}
            />
            <Area
              type="linear"
              dataKey="revenue_minor"
              stroke="var(--chart-1)"
              strokeWidth={2}
              fill="var(--chart-1)"
              fillOpacity={0.12}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="admin-chart-legend">
        <span>
          <i style={{ background: "var(--chart-1)" }} />
          Net receipts ({data.currency})
        </span>
        <span>Payments less recorded refunds</span>
      </div>
    </>
  );
}

/**
 * Render the business or product-usage dashboard with filters, comparisons, charts and
 * risk/top-organization details from one backend response.
 */
export function PlatformOverview({ usage = false }: { usage?: boolean }) {
  const [days, setDays] = useState(30);
  const [currency, setCurrency] = useState<Currency>("EUR");
  const [channel, setChannel] = useState("widget");
  const query = useQuery({
    queryKey: ["platform", "business", days, currency, channel],
    /**
     * Fetch BI for the exact selected duration, currency and channel represented by the query
     * key, preserving comparable reporting slices.
     */
    queryFn: () => getBusiness(days, currency, channel),
    refetchInterval: 60000,
  });
  const data = query.data;
  return (
    <div className="admin-page">
      <AdminHeader
        title={usage ? "Product analytics" : "Business overview"}
        detail={
          usage
            ? "Adoption, support outcomes and account activity."
            : "Revenue, customer growth and operational performance."
        }
      >
        <Link className="admin-button secondary compact" to="/platform/organizations">
          Manage organizations <ArrowRight size={16} />
        </Link>
      </AdminHeader>
      <div className="admin-toolbar">
        <PeriodControls days={days} setDays={setDays} currency={currency} setCurrency={setCurrency}>
          {usage && (
            <select
              aria-label="Conversation channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
            >
              <option value="widget">Customer widget</option>
              <option value="admin">Playground</option>
              <option value="all">All channels</option>
            </select>
          )}
          <button
            className="admin-icon-button"
            title="Refresh dashboard"
            aria-label="Refresh dashboard"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw size={16} />
          </button>
          {!usage && (
            <button
              className="admin-icon-button"
              title="Export payment ledger"
              aria-label="Export payment ledger"
              onClick={() =>
                void downloadLedger(days, currency).catch((e) => toast.error(e.message))
              }
            >
              <Download size={16} />
            </button>
          )}
        </PeriodControls>
        {data && (
          <span className="admin-update-label">
            <i />
            Updated{" "}
            {new Date(data.generated_at).toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}
      </div>
      <QueryState pending={query.isPending} error={query.error} />
      {data && (
        <>
          <div className="admin-metrics">
            <Metric
              label={usage ? "Questions" : "Net receipts"}
              value={
                usage
                  ? number(data.metrics.questions.value)
                  : money(data.metrics.revenue_minor.value, currency)
              }
              metric={usage ? data.metrics.questions : data.metrics.revenue_minor}
            />
            <Metric
              label={usage ? "Open support cases" : "Monthly recurring revenue"}
              value={usage ? number(data.open_cases) : money(data.mrr_minor, currency)}
              detail={
                usage
                  ? "Awaiting a human response"
                  : money(data.arr_minor, currency) + " annualized"
              }
            >
              <Info size={13} aria-label="Contracted run rate, not collected revenue">
                <title>Active paid contracts in the selected currency</title>
              </Info>
            </Metric>
            <Metric
              label={usage ? "Knowledge documents" : "Organizations"}
              value={number(usage ? data.documents_total : data.organizations_total)}
              detail={
                usage
                  ? "Active indexed and pending documents"
                  : data.metrics.new_organizations.value + " new this period"
              }
            />
            <Metric
              label="AI resolution rate"
              value={data.metrics.resolution_rate.value.toFixed(1) + "%"}
              metric={data.metrics.resolution_rate}
            />
          </div>
          {!usage && data.unpriced_organizations > 0 && (
            <div className="admin-note">
              <Info size={16} />
              {data.unpriced_organizations} active paid account(s) have no contracted fee. Their
              recurring revenue is currently zero.
            </div>
          )}
          <div className="admin-chart-grid">
            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div>
                  <h2>{usage ? "Support activity" : "Revenue over time"}</h2>
                  <p>
                    {date(data.start)} to {date(data.end)} · UTC
                  </p>
                </div>
                <span className="admin-tag">{days} days</span>
              </div>
              {usage ? <ActivityChart data={data} /> : <RevenueChart data={data} />}
            </section>
            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div>
                  <h2>Customer portfolio</h2>
                  <p>Current organizations by plan</p>
                </div>
              </div>
              {data.organizations_total ? (
                <>
                  <div className="admin-plan-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={data.plan_distribution}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={65}
                          outerRadius={87}
                          paddingAngle={2}
                          stroke="none"
                          isAnimationActive={false}
                        >
                          {data.plan_distribution.map((p) => (
                            <Cell key={p.name} fill={COLORS[p.name] || "var(--muted-foreground)"} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="admin-donut-label">
                      <strong>{number(data.organizations_total)}</strong>
                      <span>organizations</span>
                    </div>
                  </div>
                  <div className="admin-plan-legend">
                    {data.plan_distribution.map((p) => (
                      <div key={p.name}>
                        <span>
                          <i style={{ background: COLORS[p.name] }} />
                          {p.name.charAt(0).toUpperCase() + p.name.slice(1)}
                        </span>
                        <strong>
                          {p.value}{" "}
                          <span className="inline text-muted-foreground font-normal">
                            {" "}
                            / {Math.round((p.value / data.organizations_total) * 100)}%
                          </span>
                        </strong>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <EmptyState title="No organizations yet" />
              )}
            </section>
          </div>
          <div className="admin-chart-grid">
            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div>
                  <h2>{usage ? "New organizations" : "Support activity"}</h2>
                  <p>
                    {usage
                      ? "Accounts created during the selected period"
                      : "Customer widget conversations and automatic resolutions"}
                  </p>
                </div>
                <Link to={usage ? "/platform/organizations" : "/platform/usage"}>
                  Explore <ArrowRight size={14} />
                </Link>
              </div>
              {usage ? (
                <div className="admin-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.series}>
                      <CartesianGrid vertical={false} stroke="var(--border)" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={formatDay}
                        tick={tick}
                        axisLine={false}
                        tickLine={false}
                        minTickGap={40}
                      />
                      <YAxis allowDecimals={false} tick={tick} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar
                        dataKey="new_organizations"
                        name="New organizations"
                        fill="var(--chart-3)"
                        maxBarSize={20}
                        isAnimationActive={false}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <ActivityChart data={data} />
              )}
            </section>
            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div>
                  <h2>Attention required</h2>
                  <p>Subscription and activation signals</p>
                </div>
                <span className="admin-tag tag-expiring">{data.risks_total}</span>
              </div>
              <div className="admin-alert-list">
                {data.risks.length === 0 ? (
                  <EmptyState title="No account alerts" />
                ) : (
                  data.risks.map((org) => (
                    <div key={org.id} className="admin-alert-row">
                      <div>
                        <Link to="/platform/organizations/$id" params={{ id: org.id }}>
                          {org.name}
                        </Link>
                        <p>
                          {riskLabels[org.reason]}
                          {org.ends_at && " · " + date(org.ends_at)}
                        </p>
                      </div>
                      <StatusTag
                        status={
                          ["expired", "expiring", "past_due"].includes(org.reason)
                            ? org.reason
                            : org.plan
                        }
                      />
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
          <section className="admin-section">
            <div className="admin-section-heading">
              <div>
                <h2>Most active organizations</h2>
                <p>
                  Selected period · {channel === "widget" ? "customer widget" : channel}{" "}
                  conversations
                </p>
              </div>
              <Link className="admin-inline-link" to="/platform/organizations">
                View all <ArrowRight size={14} />
              </Link>
            </div>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Organization</th>
                    <th>Plan</th>
                    <th className="numeric">Questions</th>
                    <th>AI resolution</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_organizations.map((org) => (
                    <tr key={org.id}>
                      <td>
                        <Link to="/platform/organizations/$id" params={{ id: org.id }}>
                          {org.name}
                        </Link>
                      </td>
                      <td>
                        <StatusTag status={org.plan} />
                      </td>
                      <td className="numeric">{number(org.questions)}</td>
                      <td>
                        {org.resolution_rate}%
                        <div className="admin-progress">
                          <span style={{ width: org.resolution_rate + "%" }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.top_organizations.length && (
              <EmptyState title="No conversations in this period" />
            )}
          </section>
          <details className="admin-section p-5 text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              Daily data · {data.series.length} rows
            </summary>
            <div className="admin-table-wrap mt-4 max-h-80">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Date (UTC)</th>
                    <th>Net receipts ({currency})</th>
                    <th>Questions</th>
                    <th>AI resolved</th>
                    <th>New organizations</th>
                  </tr>
                </thead>
                <tbody>
                  {data.series.map((row) => (
                    <tr key={row.date}>
                      <td>{row.date}</td>
                      <td>{money(row.revenue_minor, currency)}</td>
                      <td>{row.questions}</td>
                      <td>{row.resolved}</td>
                      <td>{row.new_organizations}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
