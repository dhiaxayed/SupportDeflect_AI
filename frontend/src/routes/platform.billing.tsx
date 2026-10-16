/**
 * @file Super-admin revenue and manual ledger workflow. Display recorded receipts/refunds
 * separately from contracted MRR/ARR, keep currencies separate, and require a concrete
 * received-payment/refund form before submitting. Browser amounts become integer minor units;
 * one UUID is retained per form for safe retries.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Download, Plus, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import {
  AdminHeader,
  AdminModal,
  EmptyState,
  Metric,
  Pagination,
  PeriodControls,
  StatusTag,
} from "@/components/admin-ui";
import { RevenueChart } from "@/components/platform-overview";
import { QueryState } from "@/components/query-state";
import { OrganizationPicker } from "@/components/organization-picker";
import { createRequestId } from "@/lib/request-id";
import {
  currencyScale,
  date,
  downloadLedger,
  getBusiness,
  getPayments,
  money,
  recordPayment,
  recordRefund,
  type Currency,
  type Payment,
} from "@/lib/admin-api";

export const Route = createFileRoute("/platform/billing")({ component: Billing });
/**
 * Compose currency/period-filtered BI and ledger pages with controlled payment/refund dialogs;
 * accepted writes refresh platform reporting rather than adjusting totals optimistically.
 */
function Billing() {
  const [days, setDays] = useState(30);
  const [currency, setCurrency] = useState<Currency>("EUR");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [refund, setRefund] = useState<Payment | null>(null);
  const business = useQuery({
    queryKey: ["platform", "business", days, currency, "widget"],
    /**
     * Read business aggregates for the selected duration and currency to keep receipt charts
     * and recurring-contract metrics in one reporting slice.
     */
    queryFn: () => getBusiness(days, currency),
  });
  const ledger = useQuery({
    queryKey: ["platform", "payments", days, currency, page],
    /**
     * Read one ledger page for the same selected duration/currency and current page, including
     * backend-computed refunded balances.
     */
    queryFn: () => getPayments(days, currency, page),
  });
  return (
    <div className="admin-page">
      <AdminHeader
        title="Revenue & payments"
        detail="Recorded receipts, refunds and contracted recurring revenue."
      >
        <button className="admin-button" onClick={() => setCreating(true)}>
          Record payment <Plus size={17} />
        </button>
      </AdminHeader>
      <div className="admin-toolbar">
        <PeriodControls
          days={days}
          setDays={(n) => {
            setDays(n);
            setPage(1);
          }}
          currency={currency}
          setCurrency={(c) => {
            setCurrency(c);
            setPage(1);
          }}
        />
        <button
          className="admin-button secondary compact"
          onClick={() => void downloadLedger(days, currency).catch((e) => toast.error(e.message))}
        >
          Export ledger <Download size={15} />
        </button>
      </div>
      <QueryState pending={business.isPending} error={business.error} />
      {business.data && (
        <>
          <div className="admin-metrics">
            <Metric
              label="Net receipts"
              value={money(business.data.metrics.revenue_minor.value, currency)}
              metric={business.data.metrics.revenue_minor}
            />
            <Metric
              label="Monthly recurring revenue"
              value={money(business.data.mrr_minor, currency)}
              detail="Active contracts, selected currency"
            />
            <Metric
              label="Annualized recurring revenue"
              value={money(business.data.arr_minor, currency)}
              detail="Current monthly run rate x 12"
            />
            <Metric
              label="Paid-plan organizations"
              value={business.data.paying_organizations}
              detail="Active, unexpired accounts across currencies"
            />
          </div>
          <section className="admin-section admin-panel">
            <div className="admin-panel-heading">
              <div>
                <h2>Net receipts over time</h2>
                <p>
                  {date(business.data.start)} to {date(business.data.end)} · {currency}
                </p>
              </div>
            </div>
            <RevenueChart data={business.data} />
          </section>
        </>
      )}
      <section className="admin-section">
        <div className="admin-section-heading">
          <div>
            <h2>Payment ledger</h2>
            <p>Manual entries · Original records are preserved when a refund is recorded.</p>
          </div>
        </div>
        <QueryState pending={ledger.isPending} error={ledger.error} />
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Organization</th>
                <th>Date</th>
                <th>Type</th>
                <th>Reference</th>
                <th className="numeric">Amount</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {ledger.data?.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link to="/platform/organizations/$id" params={{ id: item.org_id }}>
                      {item.organization_name}
                    </Link>
                    {item.note && <small className="admin-break">{item.note}</small>}
                  </td>
                  <td className="nowrap">{date(item.occurred_at)}</td>
                  <td>
                    <StatusTag status={item.kind} />
                  </td>
                  <td>{item.reference || "-"}</td>
                  <td className="numeric nowrap">
                    {item.kind === "refund" ? "-" : ""}
                    {money(item.amount_minor, item.currency)}
                    {item.refunded_minor > 0 && (
                      <small>{money(item.refunded_minor, item.currency)} refunded</small>
                    )}
                  </td>
                  <td>
                    {item.kind === "payment" && item.refunded_minor < item.amount_minor && (
                      <button
                        className="admin-icon-button"
                        title="Record a refund"
                        aria-label={"Refund payment for " + item.organization_name}
                        onClick={() => setRefund(item)}
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
        {ledger.data?.total === 0 && (
          <EmptyState title="No payments recorded in this period">
            Recorded payments will appear in your revenue reports.
          </EmptyState>
        )}
        <Pagination page={page} total={ledger.data?.total || 0} pageSize={25} onChange={setPage} />
      </section>
      <AdminModal
        title="Record a received payment"
        description="Record a payment that has already been received. This does not charge the organization."
        open={creating}
        onOpenChange={setCreating}
      >
        {creating && <PaymentForm currency={currency} onClose={() => setCreating(false)} />}
      </AdminModal>
      <AdminModal
        title="Record a refund"
        description="Record money already returned to the customer. The original payment is retained."
        open={!!refund}
        onOpenChange={(open) => {
          if (!open) setRefund(null);
        }}
      >
        {refund && <RefundForm payment={refund} onClose={() => setRefund(null)} />}
      </AdminModal>
    </div>
  );
}

/**
 * Collect the organization, currency, received amount and UTC receipt date with optional
 * reference/note. Hold one idempotency key across retries and explain that submission records
 * money already received.
 */
function PaymentForm({
  currency: defaultCurrency,
  onClose,
}: {
  currency: Currency;
  onClose: () => void;
}) {
  const [org, setOrg] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [amount, setAmount] = useState("");
  const [when, setWhen] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [key] = useState(createRequestId);
  const cache = useQueryClient();
  const mutation = useMutation({
    /**
     * Convert the displayed payment amount to the selected currency's integer minor units and
     * submit a UTC receipt timestamp with the form's stable idempotency key.
     */
    mutationFn: () =>
      recordPayment({
        org_id: org,
        amount_minor: Math.round(Number(amount) * currencyScale(currency)),
        currency,
        occurred_at: when + "T00:00:00Z",
        reference,
        note,
        idempotency_key: key,
      }),
    /**
     * Invalidate ledger/BI/account summaries, confirm the recorded receipt and close the form
     * only after the backend accepts it.
     */
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["platform"] });
      toast.success("Payment recorded");
      onClose();
    },
    /**
     * Display payment validation/idempotency errors while keeping entered receipt details and
     * their retry key.
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
        <OrganizationPicker value={org} onChange={setOrg} />
        <label className="admin-field">
          Currency
          <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
            {["EUR", "TND", "USD"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          Amount received
          <input
            required
            type="number"
            min={1 / currencyScale(currency)}
            step={1 / currencyScale(currency)}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="admin-field">
          Receipt date (UTC)
          <input
            required
            type="date"
            value={when}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setWhen(e.target.value)}
          />
        </label>
        <label className="admin-field">
          Payment reference
          <input maxLength={160} value={reference} onChange={(e) => setReference(e.target.value)} />
        </label>
        <label className="admin-field wide">
          Internal note
          <textarea value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <div className="admin-form-actions">
        <button type="button" className="admin-button secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="admin-button" disabled={!org || mutation.isPending}>
          Record payment <Save size={16} />
        </button>
      </div>
    </form>
  );
}
/**
 * Collect a linked refund up to the displayed remaining balance with a reason and stable key;
 * the backend rechecks the ceiling under concurrency.
 */
function RefundForm({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const remaining = payment.amount_minor - payment.refunded_minor;
  const [amount, setAmount] = useState(String(remaining / currencyScale(payment.currency)));
  const [note, setNote] = useState("");
  const [key] = useState(createRequestId);
  const cache = useQueryClient();
  const mutation = useMutation({
    /**
     * Submit the refund against its original payment in that payment's own currency,
     * preserving the original receipt and retry key.
     */
    mutationFn: () =>
      recordRefund(payment.id, {
        amount_minor: Math.round(Number(amount) * currencyScale(payment.currency)),
        note,
        idempotency_key: key,
      }),
    /**
     * Refresh ledger/refundable balances and BI, confirm the recorded refund and close the
     * dialog after backend acceptance.
     */
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["platform"] });
      toast.success("Refund recorded");
      onClose();
    },
    /**
     * Display refund/remaining-balance rejection while preserving the draft and its
     * idempotency key for a deliberate correction or retry.
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
      <p className="text-sm mb-5">
        {payment.organization_name} · Remaining: {money(remaining, payment.currency)}
      </p>
      <div className="admin-form-grid">
        <label className="admin-field wide">
          Refund amount ({payment.currency})
          <input
            type="number"
            required
            min={1 / currencyScale(payment.currency)}
            step={1 / currencyScale(payment.currency)}
            max={remaining / currencyScale(payment.currency)}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="admin-field wide">
          Reason
          <textarea
            required
            minLength={3}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>
      <div className="admin-form-actions">
        <button className="admin-button danger" disabled={mutation.isPending}>
          Record refund <RotateCcw size={16} />
        </button>
      </div>
    </form>
  );
}
