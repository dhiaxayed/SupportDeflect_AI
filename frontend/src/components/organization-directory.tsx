/**
 * @file Shared organization/subscription directory for platform administrators. Backend
 * filters and pagination form the query key; lifecycle tabs choose current versus archived
 * organizations. New organization creation uses the existing audited API and navigates to its
 * detail page rather than fabricating client-side rows.
 */

import { useDeferredValue, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { getPlatformOrgs } from "@/lib/api";
import { createOrganization, currencyScale, date, money, plans, statuses } from "@/lib/admin-api";
import { AdminHeader, AdminModal, EmptyState, Pagination, StatusTag } from "@/components/admin-ui";
import { QueryState } from "@/components/query-state";

/**
 * Render controlled search, lifecycle/commercial filters and server-paged organization rows;
 * subscriptions mode reuses the same data with commercial columns.
 */
export function OrganizationDirectory({ subscriptions = false }: { subscriptions?: boolean }) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [status, setStatus] = useState("");
  const [plan, setPlan] = useState("");
  const [due, setDue] = useState("");
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const params = new URLSearchParams({
    search: deferredSearch,
    page: String(page),
    page_size: "20",
    archived: String(archived),
  });
  if (status) params.set("status", status);
  if (plan) params.set("plan", plan);
  if (due) params.set("due", due);
  const query = useQuery({
    queryKey: ["platform", "organizations", params.toString()],
    /**
     * Fetch exactly the directory page described by the serialized filter parameters so cached
     * results cannot be reused for a different audience.
     */
    queryFn: () => getPlatformOrgs(params.toString()),
  });
  return (
    <div className="admin-page">
      <AdminHeader
        title={subscriptions ? "Subscriptions" : "Organizations"}
        detail={
          subscriptions
            ? "Plans, contracted fees and subscription periods."
            : "Customer workspaces, account ownership and adoption."
        }
      >
        <button className="admin-button" onClick={() => setCreating(true)}>
          New organization <Plus size={17} />
        </button>
      </AdminHeader>
      {!subscriptions && (
        <div className="admin-detail-tabs" role="tablist" aria-label="Organization lifecycle">
          <button
            role="tab"
            aria-selected={!archived}
            onClick={() => {
              setArchived(false);
              setPage(1);
            }}
          >
            Current organizations
          </button>
          <button
            role="tab"
            aria-selected={archived}
            onClick={() => {
              setArchived(true);
              setPage(1);
            }}
          >
            Archived
          </button>
        </div>
      )}
      <section className="admin-section">
        <div className="admin-filter-row">
          <input
            aria-label="Search organizations"
            placeholder="Search organizations..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <select
            aria-label="Status filter"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {statuses.map((v) => (
              <option key={v} value={v}>
                {v.replaceAll("_", " ")}
              </option>
            ))}
          </select>
          <select
            aria-label="Plan filter"
            value={plan}
            onChange={(e) => {
              setPlan(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All plans</option>
            {plans.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
          {subscriptions && (
            <select
              aria-label="End date filter"
              value={due}
              onChange={(e) => {
                setDue(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All end dates</option>
              <option value="7d">Ending within 7 days</option>
              <option value="expired">Expired periods</option>
            </select>
          )}
        </div>
        <QueryState pending={query.isPending} error={query.error} />
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Organization</th>
                <th>Plan</th>
                <th>Status</th>
                <th>{subscriptions ? "Monthly fee" : "Users"}</th>
                <th>{subscriptions ? "Period end" : "Documents"}</th>
                <th>{subscriptions ? "Billing contact" : "Questions / 30d"}</th>
                <th>
                  <span className="sr-only">Details</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {query.data?.items.map((org) => {
                const end =
                  org.subscription_plan === "trial" ? org.trial_ends_at : org.subscription_ends_at;
                return (
                  <tr key={org.id}>
                    <td>
                      <Link to="/platform/organizations/$id" params={{ id: org.id }}>
                        {org.name}
                      </Link>
                      <small>{org.public_id}</small>
                    </td>
                    <td>
                      <StatusTag status={org.subscription_plan} />
                    </td>
                    <td>
                      <StatusTag status={org.archived_at ? "archived" : org.subscription_status} />
                    </td>
                    <td>
                      {subscriptions
                        ? money(org.monthly_fee_minor || 0, org.billing_currency || "EUR")
                        : org.users_count}
                    </td>
                    <td>
                      {subscriptions ? (
                        <>
                          <span>{date(end)}</span>
                          {end && new Date(end) < new Date() && (
                            <small className="text-red-700">Period expired</small>
                          )}
                        </>
                      ) : (
                        org.documents_count
                      )}
                    </td>
                    <td className="admin-break">
                      {subscriptions
                        ? org.billing_email || "Account administrators"
                        : org.questions_30d.toLocaleString()}
                    </td>
                    <td>
                      <Link
                        to="/platform/organizations/$id"
                        params={{ id: org.id }}
                        className="admin-icon-button"
                        title={"Open " + org.name}
                        aria-label={"Open " + org.name}
                      >
                        <ArrowRight size={16} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {query.data?.total === 0 && <EmptyState title="No matching organizations" />}
        <Pagination page={page} total={query.data?.total || 0} onChange={setPage} />
      </section>
      <AdminModal
        title="Create an organization"
        description="The account administrator will receive an invitation with a temporary password."
        open={creating}
        onOpenChange={setCreating}
      >
        {creating && <CreateOrganization onClose={() => setCreating(false)} />}
      </AdminModal>
    </div>
  );
}

/**
 * Collect workspace/administrator identity and commercial terms in the creation dialog;
 * convert displayed fees to integer minor units before submission.
 */
function CreateOrganization({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [admin, setAdmin] = useState("");
  const [email, setEmail] = useState("");
  const [plan, setPlan] = useState("trial");
  const [currency, setCurrency] = useState("EUR");
  const [fee, setFee] = useState("0");
  const cache = useQueryClient();
  const navigate = useNavigate();
  const mutation = useMutation({
    /**
     * Submit the selected plan/currency and minor-unit fee with the initial administrator
     * details; server creation owns invitations, trial defaults and audit.
     */
    mutationFn: () =>
      createOrganization({
        name,
        admin_name: admin,
        admin_email: email,
        subscription_plan: plan,
        billing_currency: currency,
        monthly_fee_minor: Math.round(Number(fee) * currencyScale(currency)),
      }),
    /**
     * Refresh platform summaries and directory caches, close the creation modal and navigate
     * to the newly created organization detail.
     */
    onSuccess: (org) => {
      void cache.invalidateQueries({ queryKey: ["platform"] });
      toast.success("Organization created. Invitation queued.");
      onClose();
      void navigate({ to: "/platform/organizations/$id", params: { id: org.id } });
    },
    /**
     * Keep the creation form available and display the API validation or service failure
     * instead of implying the workspace was created.
     */
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <div className="admin-form-grid">
        <label className="admin-field wide">
          Organization name
          <input
            required
            minLength={2}
            maxLength={160}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="admin-field">
          Administrator name
          <input required value={admin} onChange={(e) => setAdmin(e.target.value)} />
        </label>
        <label className="admin-field">
          Administrator email
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="admin-field">
          Plan
          <select value={plan} onChange={(e) => setPlan(e.target.value)}>
            {plans.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          Currency
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {["EUR", "TND", "USD"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        {plan !== "trial" && (
          <label className="admin-field wide">
            Contracted monthly fee
            <input
              required
              type="number"
              min={0}
              step={1 / currencyScale(currency)}
              value={fee}
              onChange={(e) => setFee(e.target.value)}
            />
          </label>
        )}
      </div>
      <div className="admin-form-actions">
        <button type="button" className="admin-button secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="admin-button" disabled={mutation.isPending}>
          Create organization <Plus size={16} />
        </button>
      </div>
    </form>
  );
}
