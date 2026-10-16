/**
 * @file Super-admin mail workspace separating campaign composition/review, durable delivery
 * history and future-event automations. Recipient review obtains a backend audience
 * fingerprint before queueing; queued/SMTP-accepted state is not an inbox-delivery guarantee.
 * Optimistic automation switches cancel stale fetches, retain rollback data and settle against
 * the server.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertCircle, ArrowRight, Mail, RotateCcw, Send } from "lucide-react";
import { toast } from "sonner";
import logo from "@/assets/official-logo.png";
import {
  AdminHeader,
  AdminModal,
  EmptyState,
  Metric,
  Pagination,
  StatusTag,
} from "@/components/admin-ui";
import { OrganizationPicker } from "@/components/organization-picker";
import { QueryState } from "@/components/query-state";
import { createRequestId } from "@/lib/request-id";
import {
  date,
  getMailMessages,
  getMailStatus,
  previewMail,
  retryMail,
  sendMail,
  toggleAutomation,
  type Campaign,
  type MailPreview,
} from "@/lib/admin-api";

export const Route = createFileRoute("/platform/communications")({ component: Communications });
const automationLabels: Record<string, string> = {
  welcome: "New organization welcome",
  subscription_updated: "Subscription and period changes",
  subscription_expiring: "Subscription ending in 3 days",
  subscription_expired: "Subscription period expired",
  payment_received: "Payment receipt confirmation",
  password_changed: "Password change confirmation",
};
/**
 * Manage communications tabs, delivery filtering/pagination and automation mutation state;
 * poll observed queue/worker data and require explicit review for uncertain delivery retries.
 */
function Communications() {
  const [tab, setTab] = useState("Compose");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [pendingAutomation, setPendingAutomation] = useState<{
    event: string;
    enabled: boolean;
  } | null>(null);
  const cache = useQueryClient();
  /**
   * Invalidate only platform mail queries so delivery mutations refresh log/status without
   * unnecessarily replacing unrelated business data.
   */
  const refresh = () => void cache.invalidateQueries({ queryKey: ["platform", "mail"] });
  const query = useQuery({
    queryKey: ["platform", "mail", "status"],
    queryFn: getMailStatus,
    refetchInterval: 15000,
  });
  const deliveries = useQuery({
    queryKey: ["platform", "mail", "messages", page, status],
    /**
     * Load the delivery-log page and lifecycle filter represented by its cache key, keeping
     * queued, failed and accepted messages distinct.
     */
    queryFn: () => getMailMessages(page, status),
    enabled: tab === "Delivery log",
    refetchInterval: 15000,
  });
  const toggle = useMutation({
    /**
     * Persist the selected future-event automation flag through the platform API.
     */
    mutationFn: ({ event, enabled }: { event: string; enabled: boolean }) =>
      toggleAutomation(event, enabled),
    /**
     * Cancel stale status fetches, snapshot the previous cache and optimistically change only
     * the selected automation; return rollback context for failure recovery.
     */
    onMutate: async ({ event, enabled }) => {
      const key = ["platform", "mail", "status"];
      await cache.cancelQueries({ queryKey: key });
      const previous = cache.getQueryData<Awaited<ReturnType<typeof getMailStatus>>>(key);
      if (previous)
        cache.setQueryData(key, {
          ...previous,
          automations: previous.automations.map((a) => (a.event === event ? { ...a, enabled } : a)),
        });
      return { previous };
    },
    /**
     * Restore the pre-switch cache snapshot when automation persistence fails and show the
     * actionable API error.
     */
    onError: (e: Error, _variables, context) => {
      if (context?.previous) cache.setQueryData(["platform", "mail", "status"], context.previous);
      toast.error(e.message);
    },
    /**
     * Refetch authoritative automation settings after either outcome and always release the
     * temporary pending-switch state.
     */
    onSettled: async () => {
      try {
        await cache.invalidateQueries({ queryKey: ["platform", "mail", "status"] });
      } finally {
        setPendingAutomation(null);
      }
    },
  });
  const retry = useMutation({
    mutationFn: retryMail,
    /**
     * Refresh delivery status/log after the backend requeues a failed item and report another
     * attempt rather than successful delivery.
     */
    onSuccess: () => {
      refresh();
      toast.success("Email queued for another attempt");
    },
    /**
     * Show a failed delivery-retry request without changing the persisted outbox status
     * locally.
     */
    onError: (e: Error) => toast.error(e.message),
  });
  const counts = query.data?.counts || {};
  return (
    <div className="admin-page">
      <AdminHeader
        title="Communications"
        detail="Customer messages, account notifications and delivery tracking."
      >
        <StatusTag status={query.data?.smtp_ready ? "active" : "not_connected"} />
      </AdminHeader>
      <QueryState pending={query.isPending} error={query.error} />
      <div className="admin-metrics">
        <Metric label="Sent" value={counts.sent || 0} detail="Accepted by the email provider" />
        <Metric label="Queued" value={counts.queued || 0} detail="Waiting for delivery" />
        <Metric label="Failed" value={counts.failed || 0} detail="Require review or retry" />
        <Metric
          label="Automations enabled"
          value={query.data?.automations.filter((a) => a.enabled).length || 0}
          detail="Plus mandatory account invitations"
        />
      </div>
      {query.data && !query.data.smtp_ready && (
        <div className="admin-note warning">
          <AlertCircle size={17} />
          <span>
            Email delivery is not connected ({query.data.detail.replaceAll("_", " ")}). Messages
            remain queued until the SMTP service is connected.
          </span>
        </div>
      )}
      {query.data?.detail === "local_capture" && (
        <div className="admin-note">
          <Mail size={17} />
          <span>
            Local mailbox: messages are captured in Mailpit, not sent to external inboxes.
          </span>
        </div>
      )}
      <div className="admin-detail-tabs" role="tablist" aria-label="Communications sections">
        {["Compose", "Delivery log", "Automations"].map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {tab === "Compose" && (
        <Compose
          from={query.data?.from_address || "dhiaayed03@gmail.com"}
          onQueued={() => {
            refresh();
            setTab("Delivery log");
          }}
        />
      )}
      {tab === "Delivery log" && (
        <section className="admin-section">
          <div className="admin-section-heading">
            <h2>Delivery log</h2>
            <select
              aria-label="Delivery status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              {["queued", "sending", "sent", "failed", "canceled"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <QueryState pending={deliveries.isPending} error={deliveries.error} />
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Recipient & subject</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>Created</th>
                  <th>
                    <span className="sr-only">Retry</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {deliveries.data?.items.map((item) => (
                  <tr key={item.id}>
                    <td className="admin-break">
                      {item.subject}
                      <small>{item.recipient}</small>
                    </td>
                    <td>{item.template.replaceAll("_", " ")}</td>
                    <td>
                      <StatusTag status={item.status} />
                      {item.error_code && <small>{item.error_code.replaceAll("_", " ")}</small>}
                    </td>
                    <td>{item.attempts}</td>
                    <td className="nowrap">{date(item.created_at)}</td>
                    <td>
                      {item.status === "failed" && (
                        <button
                          className="admin-icon-button"
                          title="Retry delivery"
                          aria-label={"Retry " + item.subject}
                          disabled={retry.isPending}
                          onClick={() => {
                            if (
                              item.error_code !== "delivery_unknown" ||
                              window.confirm(
                                "The previous delivery outcome is unknown. Retrying may send a duplicate. Continue?",
                              )
                            )
                              retry.mutate(item.id);
                          }}
                        >
                          <RotateCcw size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {deliveries.data?.total === 0 && <EmptyState title="No emails in this view" />}
          <Pagination
            page={page}
            total={deliveries.data?.total || 0}
            pageSize={25}
            onChange={setPage}
          />
        </section>
      )}
      {tab === "Automations" && (
        <div className="admin-detail-grid">
          <section className="admin-panel">
            <div className="admin-panel-heading">
              <div>
                <h2>Automatic notifications</h2>
                <p>Changes apply to future events. Existing queued emails are retained.</p>
              </div>
            </div>
            {query.data?.automations.map((a) => (
              <div className="admin-toggle-row" key={a.event}>
                <label htmlFor={"automation-" + a.event}>
                  {automationLabels[a.event] || a.label}
                </label>
                <input
                  id={"automation-" + a.event}
                  type="checkbox"
                  role="switch"
                  checked={
                    pendingAutomation?.event === a.event ? pendingAutomation.enabled : a.enabled
                  }
                  disabled={pendingAutomation !== null}
                  onChange={(e) => {
                    const change = { event: a.event, enabled: e.target.checked };
                    // Keep the control responsive while asynchronous cache cancellation settles.
                    setPendingAutomation(change);
                    toggle.mutate(change);
                  }}
                />
              </div>
            ))}
            <div className="admin-toggle-row">
              <label>Account invitations</label>
              <span className="admin-tag tag-active">Always enabled</span>
            </div>
          </section>
          <section className="admin-panel">
            <div className="admin-panel-heading">
              <h2>Sender identity</h2>
              <Mail size={18} />
            </div>
            <dl className="admin-key-values">
              <div>
                <dt>Display name</dt>
                <dd>SupportDeflect AI</dd>
              </div>
              <div>
                <dt>From</dt>
                <dd>{query.data?.from_address}</dd>
              </div>
              <div>
                <dt>Provider</dt>
                <dd>SMTP / Nodemailer</dd>
              </div>
              <div>
                <dt>Connection</dt>
                <dd>
                  <StatusTag status={query.data?.smtp_ready ? "active" : "not_connected"} />
                </dd>
              </div>
            </dl>
          </section>
        </div>
      )}
    </div>
  );
}

/**
 * Own campaign audience/content drafts and the reviewed snapshot. Lock the draft once reviewed
 * so queued content and recipients match what the operator confirmed.
 */
function Compose({ from, onQueued }: { from: string; onQueued: () => void }) {
  const [all, setAll] = useState(false);
  const [org, setOrg] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [review, setReview] = useState<MailPreview | null>(null);
  const [key, setKey] = useState("");
  const payload: Campaign = {
    all_organizations: all,
    ...(all ? {} : { org_id: org }),
    subject,
    message,
  };
  const preview = useMutation({
    /**
     * Resolve the draft campaign's current recipients and SMTP readiness before opening the
     * confirmation dialog.
     */
    mutationFn: () => previewMail(payload),
    /**
     * Create one review-scoped idempotency key and retain the exact audience preview for
     * explicit confirmation.
     */
    onSuccess: (result) => {
      setKey(createRequestId());
      setReview(result);
    },
    /**
     * Keep the campaign draft editable and show why audience review failed.
     */
    onError: (e: Error) => toast.error(e.message),
  });
  const send = useMutation({
    /**
     * Queue the reviewed campaign with its audience fingerprint and stable review key; the
     * backend rejects audience drift or conflicting retries.
     */
    mutationFn: () =>
      sendMail({ ...payload, audience_token: review!.audience_token, idempotency_key: key }),
    /**
     * Report the number queued, dismiss the review and let the parent switch to the delivery
     * log for monitoring.
     */
    onSuccess: (result) => {
      toast.success(result.queued + " email(s) queued");
      setReview(null);
      onQueued();
    },
    /**
     * Keep the reviewed campaign available and explain queueing failure instead of implying
     * email was sent.
     */
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <>
      <div className="admin-detail-grid">
        <section className="admin-panel">
          <div className="admin-panel-heading">
            <h2>New customer message</h2>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              preview.mutate();
            }}
          >
            <fieldset disabled={preview.isPending || !!review}>
              <div className="admin-form-grid">
                <label className="admin-field wide">
                  Audience
                  <select
                    value={all ? "all" : "single"}
                    onChange={(e) => setAll(e.target.value === "all")}
                  >
                    <option value="single">One organization</option>
                    <option value="all">All current organizations</option>
                  </select>
                </label>
                {!all && <OrganizationPicker value={org} onChange={setOrg} />}
                <label className="admin-field wide">
                  Subject
                  <input
                    required
                    minLength={3}
                    maxLength={180}
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="A clear, useful subject"
                  />
                </label>
                <label className="admin-field wide">
                  Message
                  <textarea
                    required
                    minLength={10}
                    maxLength={10000}
                    rows={8}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                </label>
              </div>
              <div className="admin-form-actions">
                <button className="admin-button" disabled={(!all && !org) || preview.isPending}>
                  Review recipients <ArrowRight size={16} />
                </button>
              </div>
            </fieldset>
          </form>
        </section>
        <section className="admin-panel">
          <div className="admin-panel-heading">
            <div>
              <h2>Email preview</h2>
              <p>From SupportDeflect AI · {from}</p>
            </div>
          </div>
          <div className="admin-mail-preview">
            <div className="admin-mail-paper">
              <img src={logo} alt="SupportDeflect AI" />
              <h3>{subject || "Your message subject"}</h3>
              <p>Bonjour,</p>
              <p className="mt-4">{message || "Your message will appear here."}</p>
              <span className="admin-button mt-6">
                Acceder a mon espace <ArrowRight size={14} />
              </span>
              <p className="mt-6">L'equipe SupportDeflect AI</p>
              <footer>SupportDeflect AI · Service client</footer>
            </div>
          </div>
        </section>
      </div>
      <AdminModal
        open={!!review}
        onOpenChange={(v) => {
          if (!v && !send.isPending) setReview(null);
        }}
        title="Review email delivery"
        description="Each recipient receives a separate branded message. Other recipients are never disclosed."
      >
        {review && (
          <>
            <div className="admin-kpi-inline">
              <span>
                <strong>{review.recipient_count}</strong>recipients
              </span>
              <span>
                <strong>{review.organizations_count}</strong>organizations
              </span>
            </div>
            <p className="text-sm font-medium">{review.subject}</p>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap max-h-40 overflow-auto">
              {review.message}
            </p>
            <div className="text-xs space-y-2 max-h-32 overflow-auto">
              {review.sample.map((r) => (
                <p key={r.organization + r.email}>
                  {r.organization} · {r.email}
                </p>
              ))}
              {review.recipient_count > review.sample.length && (
                <p>And {review.recipient_count - review.sample.length} more recipients.</p>
              )}
            </div>
            {!review.smtp_ready && (
              <div className="admin-note warning">
                SMTP is not connected. This campaign will remain queued.
              </div>
            )}
            <div className="admin-form-actions">
              <button
                className="admin-button secondary"
                disabled={send.isPending}
                onClick={() => setReview(null)}
              >
                Back
              </button>
              <button
                className="admin-button"
                disabled={!review.recipient_count || send.isPending}
                onClick={() => send.mutate()}
              >
                Queue {review.recipient_count} email(s) <Send size={16} />
              </button>
            </div>
          </>
        )}
      </AdminModal>
    </>
  );
}
