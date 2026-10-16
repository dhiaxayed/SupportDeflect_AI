/**
 * @file Authenticated platform operations view combining dependency health, ingestion
 * counters, mail readiness and failed jobs. Poll summaries every thirty seconds and expose
 * explicit retry actions for exhausted ingestion; worker/SMTP status is observed state, not
 * proof of external delivery.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Cpu, Database, Layers, Mail, RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { apiRequest, getPlatformHealth, getPlatformOverview } from "@/lib/api";
import { getMailStatus } from "@/lib/admin-api";
import { AdminHeader, EmptyState, Metric, StatusTag } from "@/components/admin-ui";
import { QueryState } from "@/components/query-state";
export const Route = createFileRoute("/platform/health")({ component: Health });
/**
 * Safe failed-job list projection identifying organization/document, attempts and creation
 * time without carrying ingestion content or secret provider errors.
 */
interface FailedJob {
  id: string;
  organization_name: string;
  document_title: string;
  attempts: number;
  created_at: string;
}
/**
 * Render operational checks and bounded failed-job metadata from their own query states;
 * refresh/retry actions invalidate platform data after accepted changes.
 */
function Health() {
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ["platform", "health"],
    queryFn: getPlatformHealth,
    refetchInterval: 30000,
  });
  const overview = useQuery({
    queryKey: ["platform", "overview"],
    queryFn: getPlatformOverview,
    refetchInterval: 30000,
  });
  const mail = useQuery({
    queryKey: ["platform", "mail", "status"],
    queryFn: getMailStatus,
    refetchInterval: 30000,
  });
  const jobs = useQuery({
    queryKey: ["platform", "failed-jobs"],
    /**
     * Read the backend's bounded failed-ingestion list for operational retry rather than
     * exposing stored document bodies.
     */
    queryFn: () => apiRequest<FailedJob[]>("/platform/ingestion/failed"),
    refetchInterval: 30000,
  });
  const retry = useMutation({
    /**
     * Requeue the selected failed job through the audited platform endpoint; retry eligibility
     * and durable state remain server-owned.
     */
    mutationFn: (id: string) =>
      apiRequest("/platform/ingestion/" + id + "/retry", { method: "POST" }),
    /**
     * Refresh platform health/workload queries and report that indexing was queued again, not
     * already completed.
     */
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["platform"] });
      toast.success("Indexing queued for retry");
    },
    /**
     * Show retry rejection or service failure while retaining the visible failed-job row for
     * further inspection.
     */
    onError: (e: Error) => toast.error(e.message),
  });
  const icons: Record<string, typeof Database> = {
    database: Database,
    pgvector: Layers,
    llm: Cpu,
    ingestion: Activity,
  };
  return (
    <div className="admin-page">
      <AdminHeader
        title="System health"
        detail="Live dependency checks, ingestion workload and mail delivery."
      >
        {query.data && <StatusTag status={query.data.status} />}
        <button
          className="admin-icon-button"
          title="Refresh health"
          aria-label="Refresh health"
          disabled={query.isFetching}
          onClick={() => void cache.invalidateQueries({ queryKey: ["platform"] })}
        >
          <RefreshCw size={17} />
        </button>
      </AdminHeader>
      <QueryState pending={query.isPending} error={query.error} />
      <div className="admin-metrics">
        <Metric
          label="Pending ingestion"
          value={overview.data?.pending_ingestion_jobs || 0}
          detail="Waiting for a worker"
        />
        <Metric
          label="Processing"
          value={overview.data?.processing_ingestion_jobs || 0}
          detail="Indexing in progress"
        />
        <Metric
          label="Failed jobs"
          value={overview.data?.failed_ingestion_jobs || 0}
          detail="Retries exhausted"
        />
        <Metric
          label="Vector chunks"
          value={(overview.data?.vector_chunks_total || 0).toLocaleString()}
          detail="Stored knowledge passages"
        />
      </div>
      <section className="admin-section">
        <div className="admin-section-heading">
          <h2>Service availability</h2>
          <span className="text-xs text-muted-foreground">Refreshes every 30 seconds</span>
        </div>
        {Object.entries(query.data?.checks || {}).map(([name, check]) => {
          const Icon = icons[name] || Activity;
          return (
            <div key={name} className="flex gap-4 items-center border-t border-border px-6 py-5">
              <Icon size={21} className="text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-medium capitalize">{name}</h3>
                <p className="text-xs mt-1 text-muted-foreground break-words">{check.detail}</p>
              </div>
              <StatusTag status={check.status} />
            </div>
          );
        })}
        <div className="flex gap-4 items-center border-t border-border px-6 py-5">
          <Mail size={21} className="text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-medium">Email delivery</h3>
            <p className="text-xs mt-1 text-muted-foreground">
              {mail.data?.detail.replaceAll("_", " ") || "Checking"}
            </p>
          </div>
          <StatusTag status={mail.data?.smtp_ready ? "healthy" : "degraded"} />
        </div>
      </section>
      <section className="admin-section">
        <div className="admin-section-heading">
          <div>
            <h2>Failed indexing jobs</h2>
            <p>Most recent 50 failures</p>
          </div>
        </div>
        <QueryState pending={jobs.isPending} error={jobs.error} />
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Organization</th>
                <th>Document</th>
                <th>Attempts</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {jobs.data?.map((job) => (
                <tr key={job.id}>
                  <td>{job.organization_name}</td>
                  <td>{job.document_title}</td>
                  <td>{job.attempts}</td>
                  <td>
                    <button
                      className="admin-icon-button"
                      title="Retry indexing"
                      aria-label={"Retry " + job.document_title}
                      disabled={retry.isPending}
                      onClick={() => retry.mutate(job.id)}
                    >
                      <RotateCcw size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {jobs.data?.length === 0 && <EmptyState title="No failed indexing jobs" />}
      </section>
    </div>
  );
}
