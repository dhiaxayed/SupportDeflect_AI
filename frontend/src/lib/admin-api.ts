/**
 * @file Super-admin request contracts and presentation helpers built on the shared
 * session-aware API client. Billing stays in integer minor units and separate currencies;
 * payment/refund actions record external transactions rather than moving money. Campaigns
 * require a reviewed audience token and an idempotency key before the backend queues
 * deliveries.
 */

import { apiRequest, apiBlob, type PlatformOrg } from "./api";

/**
 * Currencies supported by ledger/reporting endpoints; amounts in different currencies must be
 * reported separately.
 */
export type Currency = "EUR" | "USD" | "TND";
/**
 * Return the minor-unit scale for supported currencies: TND has three decimal places, while
 * EUR and USD have two.
 */
export const currencyScale = (currency: string) => (currency === "TND" ? 1000 : 100);
/**
 * Format integer minor units in their own currency; do not aggregate or convert amounts across
 * currencies.
 */
export const money = (minor: number, currency = "EUR") =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "TND" ? 3 : 2,
  }).format(minor / currencyScale(currency));
/**
 * Apply the platform's consistent en-GB grouping to a numeric metric without changing its
 * underlying value.
 */
export const number = (value: number) => new Intl.NumberFormat("en-GB").format(value);
/**
 * Display subscription/ledger dates in UTC to match backend reporting; absent dates represent
 * an open-ended period.
 */
export const date = (value?: string | null) =>
  value
    ? new Date(value).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : "No end date";
export const plans = ["trial", "starter", "pro", "enterprise"];
export const statuses = ["trialing", "active", "suspended", "past_due", "canceled"];
/**
 * Current and previous equal-length period values with absolute/percentage deltas; null
 * percent means no comparable baseline.
 */
export interface BusinessMetric {
  value: number;
  previous: number;
  delta: number;
  delta_percent: number | null;
}
/**
 * Cross-tenant BI response with one currency, one channel, time series, contracted revenue and
 * actionable organization risks.
 */
export interface BusinessDashboard {
  days: number;
  currency: Currency;
  channel: string;
  generated_at: string;
  start: string;
  end: string;
  metrics: Record<
    "questions" | "resolved" | "resolution_rate" | "revenue_minor" | "new_organizations",
    BusinessMetric
  >;
  series: {
    date: string;
    questions: number;
    resolved: number;
    revenue_minor: number;
    new_organizations: number;
  }[];
  mrr_minor: number;
  arr_minor: number;
  organizations_total: number;
  paying_organizations: number;
  unpriced_organizations: number;
  documents_total: number;
  open_cases: number;
  failed_ingestion: number;
  plan_distribution: { name: string; value: number }[];
  status_distribution: { name: string; value: number }[];
  risks_total: number;
  risks: {
    id: string;
    name: string;
    reason: string;
    plan: string;
    ends_at: string | null;
    status: string;
  }[];
  top_organizations: {
    id: string;
    name: string;
    plan: string;
    questions: number;
    resolution_rate: number;
  }[];
}
/**
 * Read comparable reporting periods for a selected duration, currency and conversation
 * channel; the backend performs aggregation.
 */
export const getBusiness = (days: number, currency: Currency, channel = "widget") =>
  apiRequest<BusinessDashboard>(
    `/platform/business?days=${days}&currency=${currency}&channel=${channel}`,
  );
/**
 * Create a customer workspace with its initial administrator and explicit commercial terms
 * through the audited platform workflow.
 */
export const createOrganization = (payload: {
  name: string;
  admin_name: string;
  admin_email: string;
  subscription_plan: string;
  billing_currency: string;
  monthly_fee_minor: number;
}) =>
  apiRequest<PlatformOrg>("/platform/organizations", {
    method: "POST",
    body: JSON.stringify(payload),
  });
/**
 * Extend or shorten one subscription by signed days with an operator reason; the backend
 * normalizes dates and records the adjustment.
 */
export const adjustPeriod = (id: string, days: number, reason: string) =>
  apiRequest<PlatformOrg>(`/platform/organizations/${id}/period`, {
    method: "POST",
    body: JSON.stringify({ days, reason }),
  });
/**
 * Request reversible archival only after the exact organization name is confirmed; ledger and
 * audit history remain retained.
 */
export const archiveOrganization = (id: string, confirm_name: string) =>
  apiRequest<PlatformOrg>(`/platform/organizations/${id}`, {
    method: "DELETE",
    body: JSON.stringify({ confirm_name }),
  });
/**
 * Restore access eligibility for a logically archived organization without deleting its
 * retained history.
 */
export const restoreOrganization = (id: string) =>
  apiRequest<PlatformOrg>(`/platform/organizations/${id}/restore`, { method: "POST" });
/**
 * Append-only payment/refund ledger row; refunded_minor summarizes linked refunds and
 * refund_of_id identifies the original receipt.
 */
export interface Payment {
  id: string;
  org_id: string;
  organization_name: string;
  amount_minor: number;
  currency: Currency;
  kind: "payment" | "refund";
  reference: string | null;
  note: string | null;
  occurred_at: string;
  created_at: string;
  refunded_minor: number;
  refund_of_id: string | null;
}
/**
 * Backend pagination envelope; page_size is server-defined and total counts all matching
 * records.
 */
export interface Page<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
}
/**
 * Read one 25-row ledger page for the chosen currency and period, including remaining
 * refundable balances.
 */
export const getPayments = (days: number, currency: Currency, page: number) =>
  apiRequest<Page<Payment>>(
    `/platform/billing/payments?days=${days}&currency=${currency}&page=${page}`,
  );
/**
 * Record a received external payment in integer minor units with a caller-stable idempotency
 * key; no customer is charged by this API.
 */
export const recordPayment = (payload: {
  org_id: string;
  amount_minor: number;
  currency: Currency;
  occurred_at: string;
  reference?: string;
  note?: string;
  idempotency_key: string;
}) =>
  apiRequest<Payment>("/platform/billing/payments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
/**
 * Record a linked external refund using minor units and a stable key; the backend rejects
 * amounts above the unrefunded balance.
 */
export const recordRefund = (
  id: string,
  payload: { amount_minor: number; note: string; idempotency_key: string },
) =>
  apiRequest<Payment>(`/platform/billing/payments/${id}/refund`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
/**
 * Download a session-checked CSV blob and release its object URL after the browser has had
 * time to start the download.
 */
export async function downloadLedger(days: number, currency: Currency) {
  const body = await apiBlob(`/platform/billing/export?days=${days}&currency=${currency}`);
  const url = URL.createObjectURL(body);
  const link = document.createElement("a");
  link.href = url;
  link.download = `supportdeflect-payments-${currency}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/**
 * Observed delivery-worker readiness, queue counts and configurable future-event automations.
 */
export interface MailStatus {
  connected: boolean;
  smtp_ready: boolean;
  detail: string;
  from_address: string;
  last_seen_at: string | null;
  counts: Record<string, number>;
  automations: { event: string; label: string; enabled: boolean }[];
}
/**
 * Safe delivery-log fields describing queueing/SMTP attempts without exposing encrypted
 * invitation credentials.
 */
export interface MailItem {
  id: string;
  org_id: string | null;
  recipient: string;
  subject: string;
  template: string;
  status: string;
  attempts: number;
  error_code: string | null;
  created_at: string;
  sent_at: string | null;
}
/**
 * Draft campaign content and either one organization or all current organizations; recipients
 * are resolved server-side.
 */
export interface Campaign {
  org_id?: string;
  all_organizations: boolean;
  subject: string;
  message: string;
}
/**
 * Reviewed audience snapshot with a confirmation fingerprint, sender, bounded recipient sample
 * and current SMTP readiness.
 */
export interface MailPreview {
  recipient_count: number;
  organizations_count: number;
  audience_token: string;
  smtp_ready: boolean;
  sample: { organization: string; email: string }[];
  from_address: string;
  subject: string;
  message: string;
}
/**
 * Read SMTP/worker availability, queue counts and automation settings for platform
 * administration.
 */
export const getMailStatus = () => apiRequest<MailStatus>("/platform/mail/status");
/**
 * Read a paginated delivery log filtered by its persisted lifecycle state, separate from
 * account invitation state.
 */
export const getMailMessages = (page: number, status: string) =>
  apiRequest<Page<MailItem>>(`/platform/mail/messages?page=${page}&status=${status}`);
/**
 * Resolve the current campaign audience before queueing. The returned audience token binds
 * later confirmation to the reviewed recipients.
 */
export const previewMail = (payload: Campaign) =>
  apiRequest<MailPreview>("/platform/mail/preview", {
    method: "POST",
    body: JSON.stringify(payload),
  });
/**
 * Queue a reviewed campaign with its unchanged audience token and idempotency key; success
 * reports queueing rather than inbox delivery.
 */
export const sendMail = (payload: Campaign & { audience_token: string; idempotency_key: string }) =>
  apiRequest<{ queued: number }>("/platform/mail/send", {
    method: "POST",
    body: JSON.stringify(payload),
  });
/**
 * Persist one event automation preference; the communications view handles optimistic cache
 * updates and rollback.
 */
export const toggleAutomation = (event: string, enabled: boolean) =>
  apiRequest(`/platform/mail/automations/${event}`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
/**
 * Ask the backend to requeue a failed delivery; the UI separately confirms uncertain SMTP
 * outcomes before calling this helper.
 */
export const retryMail = (id: string) =>
  apiRequest(`/platform/mail/messages/${id}/retry`, { method: "POST" });
