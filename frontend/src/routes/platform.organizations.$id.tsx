/**
 * @file Super-admin organization detail/edit workflow for account metadata, contracted terms,
 * periods, reversible archival and administrator invitation renewal. The route reloads
 * server-normalized data after mutations and remounts the controlled editor when its response
 * changes; activity remains an organization-filtered read-only audit view.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Archive, ArrowLeft, CalendarPlus, Mail, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import {
  apiRequest,
  getPlatformOrg,
  updatePlatformOrg,
  type AuditEvent,
  type PlatformOrg,
} from "@/lib/api";
import {
  adjustPeriod,
  archiveOrganization,
  currencyScale,
  date,
  money,
  plans,
  restoreOrganization,
  statuses,
} from "@/lib/admin-api";
import { AdminHeader, AdminModal, EmptyState, Metric, StatusTag } from "@/components/admin-ui";
import { QueryState } from "@/components/query-state";

export const Route = createFileRoute("/platform/organizations/$id")({ component: Organization });
/**
 * Read the organization ID from the file route, show query state and mount the editor from the
 * authoritative platform response.
 */
function Organization() {
  const { id } = Route.useParams();
  const query = useQuery({
    queryKey: ["platform", "organization", id],
    /**
     * Load the selected internal organization ID under its own cache key so navigation between
     * customers cannot reuse the wrong record.
     */
    queryFn: () => getPlatformOrg(id),
  });
  return (
    <div className="admin-page">
      <Link className="admin-back" to="/platform/organizations">
        <ArrowLeft size={14} />
        Organizations
      </Link>
      <QueryState pending={query.isPending} error={query.error} />
      {query.data && <OrganizationDetail key={JSON.stringify(query.data)} org={query.data} />}
    </div>
  );
}
/**
 * Render controlled account/subscription fields and explicit archive/period/invitation
 * actions. Separate trial expiry from paid-subscription expiry and convert monthly fees to
 * minor units before persistence.
 */
export function OrganizationDetail({ org }: { org: PlatformOrg }) {
  const [tab, setTab] = useState("Account");
  const [name, setName] = useState(org.name);
  const [email, setEmail] = useState(org.billing_email || "");
  const [notes, setNotes] = useState(org.admin_notes || "");
  const [plan, setPlan] = useState(org.subscription_plan);
  const [status, setStatus] = useState(org.subscription_status);
  const [currency, setCurrency] = useState(org.billing_currency || "EUR");
  const [fee, setFee] = useState(String((org.monthly_fee_minor || 0) / currencyScale(currency)));
  const [end, setEnd] = useState(
    (org.subscription_plan === "trial" ? org.trial_ends_at : org.subscription_ends_at)?.slice(
      0,
      10,
    ) || "",
  );
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [periodOpen, setPeriodOpen] = useState(false);
  const [days, setDays] = useState("30");
  const [direction, setDirection] = useState(1);
  const [reason, setReason] = useState("");
  const cache = useQueryClient();
  /**
   * Refresh all platform summaries/detail data and confirm an accepted organization mutation;
   * the parent remount adopts backend-normalized values.
   */
  const onSuccess = () => {
    void cache.invalidateQueries({ queryKey: ["platform"] });
    toast.success("Organization updated");
  };
  const mutation = useMutation({
    /**
     * Patch only the active editor section: identity/contact/notes for Account, or
     * plan/status/currency/minor-unit fee and the correct trial/subscription end field for
     * Subscription.
     */
    mutationFn: () =>
      updatePlatformOrg(
        org.id,
        tab === "Account"
          ? { name, billing_email: email || null, admin_notes: notes || null }
          : {
              subscription_plan: plan,
              subscription_status: status,
              billing_currency: currency,
              monthly_fee_minor:
                plan === "trial" ? 0 : Math.round(Number(fee) * currencyScale(currency)),
              ...(plan === "trial"
                ? { trial_ends_at: end ? end + "T23:59:59Z" : null }
                : { subscription_ends_at: end ? end + "T23:59:59Z" : null }),
            },
      ),
    onSuccess,
    /**
     * Show account/commercial validation failure while retaining the unsaved editor values.
     */
    onError: (e: Error) => toast.error(e.message),
  });
  const archive = useMutation({
    /**
     * Request logical archival with the operator's exact-name confirmation while retaining
     * financial/audit history.
     */
    mutationFn: () => archiveOrganization(org.id, confirmation),
    /**
     * Dismiss the archive confirmation only after success, then refresh account/lifecycle
     * reporting.
     */
    onSuccess: () => {
      setArchiveOpen(false);
      onSuccess();
    },
    /**
     * Keep archive confirmation open and show why the lifecycle change was rejected.
     */
    onError: (e: Error) => toast.error(e.message),
  });
  const restore = useMutation({
    /**
     * Restore the archived organization through its dedicated lifecycle endpoint.
     */
    mutationFn: () => restoreOrganization(org.id),
    onSuccess,
    /**
     * Show a failed restore without implying workspace access has changed.
     */
    onError: (e: Error) => toast.error(e.message),
  });
  const period = useMutation({
    /**
     * Apply signed day adjustment and the required reason so period changes remain explicit
     * and audited.
     */
    mutationFn: () => adjustPeriod(org.id, Number(days) * direction, reason),
    /**
     * Close period adjustment only after backend acceptance and refresh the resulting
     * dates/audit data.
     */
    onSuccess: () => {
      setPeriodOpen(false);
      onSuccess();
    },
    /**
     * Retain the period/reason draft and show the rejected adjustment.
     */
    onError: (e: Error) => toast.error(e.message),
  });
  const invite = useMutation({
    /**
     * Renew the selected organization administrator's invitation through the platform-scoped
     * endpoint, keeping credential rotation server-side.
     */
    mutationFn: (id: string) =>
      apiRequest("/platform/organizations/" + org.id + "/administrators/" + id + "/invite", {
        method: "POST",
      }),
    /**
     * Report that a new administrator invitation was queued; do not expose credentials or
     * claim SMTP delivery.
     */
    onSuccess: () => toast.success("A new invitation was queued"),
    /**
     * Show invitation-renewal failure without displaying or reusing temporary credentials.
     */
    onError: (e: Error) => toast.error(e.message),
  });
  const audit = useQuery({
    queryKey: ["platform", "audit", org.id],
    /**
     * Read organization-scoped audit events only while Activity is selected; no tenant
     * document bodies are requested.
     */
    queryFn: () => apiRequest<AuditEvent[]>("/platform/audit-events?org_id=" + org.id),
    enabled: tab === "Activity",
  });
  return (
    <>
      <AdminHeader
        title={org.name}
        eyebrow="Organization account"
        detail={org.public_id + " · Created " + date(org.created_at)}
      >
        <StatusTag status={org.archived_at ? "archived" : org.subscription_status} />
        {org.archived_at ? (
          <button
            className="admin-button"
            onClick={() => restore.mutate()}
            disabled={restore.isPending}
          >
            Restore organization <RotateCcw size={16} />
          </button>
        ) : (
          <button
            className="admin-icon-button"
            title="Archive organization"
            aria-label="Archive organization"
            onClick={() => setArchiveOpen(true)}
          >
            <Archive size={18} />
          </button>
        )}
      </AdminHeader>
      {org.archived_at && (
        <div className="admin-note warning">
          Archived on {date(org.archived_at)}. Workspace access and the public widget are disabled.
        </div>
      )}
      <div className="admin-metrics">
        <Metric label="Users" value={org.users_count || 0} />
        <Metric label="Documents" value={org.documents_count || 0} />
        <Metric label="Questions / 30 days" value={org.questions_30d || 0} />
        <Metric
          label="Monthly contract"
          value={money(org.monthly_fee_minor || 0, org.billing_currency || "EUR")}
          detail={org.subscription_plan}
        />
      </div>
      <div className="admin-detail-tabs" role="tablist" aria-label="Organization sections">
        {["Account", "Subscription", "Activity"].map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {tab !== "Activity" ? (
        <div className="admin-detail-grid">
          <section className="admin-panel">
            <div className="admin-panel-heading">
              <div>
                <h2>{tab === "Account" ? "Organization details" : "Contract & subscription"}</h2>
              </div>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                mutation.mutate();
              }}
            >
              <fieldset disabled={!!org.archived_at || mutation.isPending}>
                <div className="admin-form-grid">
                  {tab === "Account" ? (
                    <>
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
                      <label className="admin-field wide">
                        Billing contact email
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="Uses the account administrators when empty"
                        />
                      </label>
                      <label className="admin-field wide">
                        Internal account notes
                        <textarea
                          rows={5}
                          maxLength={10000}
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <label className="admin-field">
                        Plan
                        <select
                          value={plan}
                          onChange={(e) => {
                            setPlan(e.target.value);
                            setEnd(
                              (e.target.value === "trial"
                                ? org.trial_ends_at
                                : org.subscription_ends_at
                              )?.slice(0, 10) || "",
                            );
                          }}
                        >
                          {plans.map((p) => (
                            <option key={p}>{p}</option>
                          ))}
                        </select>
                      </label>
                      <label className="admin-field">
                        Status
                        <select value={status} onChange={(e) => setStatus(e.target.value)}>
                          {statuses.map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      </label>
                      <label className="admin-field">
                        Billing currency
                        <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                          {["EUR", "TND", "USD"].map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                      </label>
                      <label className="admin-field">
                        Monthly fee
                        <input
                          type="number"
                          min={0}
                          step={1 / currencyScale(currency)}
                          required
                          disabled={plan === "trial"}
                          value={plan === "trial" ? "0" : fee}
                          onChange={(e) => setFee(e.target.value)}
                        />
                      </label>
                      <label className="admin-field wide">
                        {plan === "trial" ? "Trial end date (UTC)" : "Subscription end date (UTC)"}
                        <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
                      </label>
                      <div className="admin-note wide col-span-full">
                        <span>
                          {plan === "trial"
                            ? "Trials have no contracted recurring revenue. An empty trial end date starts a new 14-day period."
                            : "An empty end date gives this account an open-ended subscription. Canceled, suspended and past-due accounts cannot use the assistant."}
                        </span>
                      </div>
                    </>
                  )}
                </div>
                <div className="admin-form-actions">
                  <button
                    className="admin-button"
                    disabled={mutation.isPending || !!org.archived_at}
                  >
                    Save changes <Save size={16} />
                  </button>
                </div>
              </fieldset>
            </form>
          </section>
          <div>
            {tab === "Subscription" ? (
              <section className="admin-panel mb-6">
                <div className="admin-panel-heading">
                  <div>
                    <h2>Period management</h2>
                    <p>Current end date</p>
                  </div>
                  <CalendarPlus size={20} className="text-primary shrink-0" />
                </div>
                <p className="text-2xl font-normal mb-5">
                  {date(
                    org.subscription_plan === "trial"
                      ? org.trial_ends_at
                      : org.subscription_ends_at,
                  )}
                </p>
                <button
                  className="admin-button secondary"
                  disabled={!!org.archived_at}
                  onClick={() => setPeriodOpen(true)}
                >
                  Adjust period <CalendarPlus size={16} />
                </button>
              </section>
            ) : (
              <section className="admin-panel mb-6">
                <div className="admin-panel-heading">
                  <h2>Account administrators</h2>
                </div>
                {org.administrators?.map((user) => (
                  <div className="py-3 border-b border-border" key={user.id}>
                    <p className="text-sm">{user.full_name || user.email}</p>
                    <p className="text-xs text-muted-foreground break-all mt-1">{user.email}</p>
                    <div className="flex gap-2 items-center mt-3">
                      <StatusTag
                        status={
                          !user.is_active
                            ? "inactive"
                            : user.must_change_password
                              ? "invited"
                              : "active"
                        }
                      />
                      {user.must_change_password && user.is_active && !org.archived_at && (
                        <button
                          className="admin-icon-button"
                          aria-label={"Resend invitation to " + user.email}
                          title="Resend invitation"
                          disabled={invite.isPending}
                          onClick={() => invite.mutate(user.id)}
                        >
                          <Mail size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </section>
            )}
            <section className="admin-panel">
              <div className="admin-panel-heading">
                <h2>Workspace usage</h2>
              </div>
              <dl className="admin-key-values">
                {[
                  ["Vector chunks", org.chunks_count || 0],
                  ["Support cases", org.support_cases_count || 0],
                  ["Pending ingestion", org.pending_ingestion_jobs || 0],
                  ["Failed ingestion", org.failed_ingestion_jobs || 0],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        </div>
      ) : (
        <section className="admin-section">
          <QueryState pending={audit.isPending} error={audit.error} />
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Action</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {audit.data?.map((event) => (
                  <tr key={event.id}>
                    <td className="nowrap">{date(event.created_at)}</td>
                    <td>{event.action}</td>
                    <td className="admin-break">{JSON.stringify(event.metadata)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {audit.data?.length === 0 && <EmptyState title="No account activity" />}
        </section>
      )}
      <AdminModal
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Archive organization"
        description="Access will be blocked. Documents, conversations and the financial history will be retained. You can restore the organization later."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            archive.mutate();
          }}
        >
          <label className="admin-field">
            Type {org.name} to confirm
            <input
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="off"
            />
          </label>
          <div className="admin-form-actions">
            <button
              type="button"
              className="admin-button secondary"
              onClick={() => setArchiveOpen(false)}
            >
              Cancel
            </button>
            <button
              className="admin-button danger"
              disabled={confirmation !== org.name || archive.isPending}
            >
              Archive <Archive size={16} />
            </button>
          </div>
        </form>
      </AdminModal>
      <AdminModal
        open={periodOpen}
        onOpenChange={setPeriodOpen}
        title="Adjust subscription period"
        description="An extension starts from the current expiry, or from today when the period has already expired. Account status remains separately controlled."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            period.mutate();
          }}
        >
          <div className="admin-form-grid">
            <label className="admin-field">
              Adjustment
              <select value={direction} onChange={(e) => setDirection(Number(e.target.value))}>
                <option value={1}>Add time</option>
                <option value={-1}>Remove time</option>
              </select>
            </label>
            <label className="admin-field">
              Number of days
              <input
                type="number"
                min={1}
                max={3650}
                required
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            </label>
            <label className="admin-field wide">
              Reason
              <textarea
                required
                minLength={3}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          </div>
          <div className="admin-form-actions">
            <button className="admin-button" disabled={period.isPending}>
              Apply adjustment <CalendarPlus size={16} />
            </button>
          </div>
        </form>
      </AdminModal>
    </>
  );
}
