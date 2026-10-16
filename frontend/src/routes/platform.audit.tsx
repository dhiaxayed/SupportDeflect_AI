/**
 * @file Read-only super-admin audit history with server-side action filtering and pagination.
 * Show actor/scope/resource metadata in UTC; structured change details remain escaped text and
 * no client control edits the append-only records.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AdminHeader, EmptyState, StatusTag } from "@/components/admin-ui";
import { QueryState } from "@/components/query-state";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { apiRequest, type AuditEvent } from "@/lib/api";

export const Route = createFileRoute("/platform/audit")({ component: Audit });
/**
 * Own the action filter and page, render safe audit-event details and provide boundary-aware
 * page navigation without fabricating a total count.
 */
function Audit() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const query = useQuery({
    queryKey: ["platform", "audit", page, action],
    /**
     * Request one audit page for the encoded action filter; keep page/filter in the query key
     * so cached audit slices cannot be confused.
     */
    queryFn: () =>
      apiRequest<AuditEvent[]>(
        "/platform/audit-events?page=" + page + "&action=" + encodeURIComponent(action),
      ),
  });
  return (
    <div className="admin-page">
      <AdminHeader
        title="Audit trail"
        detail="Administrative decisions and account changes, recorded with their actor and timestamp."
      />
      <section className="admin-section">
        <div className="admin-filter-row">
          <input
            aria-label="Filter audit actions"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
            placeholder="Filter actions: subscription, billing, organization, mail..."
          />
        </div>
        <QueryState pending={query.isPending} error={query.error} />
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Time (UTC)</th>
                <th>Scope</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {query.data?.map((event) => (
                <tr key={event.id}>
                  <td className="nowrap">
                    {new Date(event.created_at).toLocaleString("en-GB", { timeZone: "UTC" })}
                  </td>
                  <td>
                    <StatusTag status={event.scope} />
                  </td>
                  <td>
                    {event.action}
                    <small className="font-mono">{event.target_id}</small>
                  </td>
                  <td className="admin-break">
                    {event.actor_email || event.actor_user_id || "System"}
                  </td>
                  <td>
                    <details>
                      <summary className="cursor-pointer text-primary">View changes</summary>
                      <pre className="text-[11px] whitespace-pre-wrap max-w-xs mt-3 break-words">
                        {JSON.stringify(event.metadata, null, 2)}
                      </pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {query.data?.length === 0 && <EmptyState title="No matching audit events" />}
        <div className="admin-pagination">
          <span>Most recent first</span>
          <div>
            <span>Page {page}</span>
            <button
              className="admin-icon-button"
              title="Previous page"
              aria-label="Previous page"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft size={17} />
            </button>
            <button
              className="admin-icon-button"
              title="Next page"
              aria-label="Next page"
              disabled={(query.data?.length || 0) < 50}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
