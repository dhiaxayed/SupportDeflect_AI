/**
 * @file Presentation primitives shared by platform administration views. They accept
 * backend-derived values and controlled callbacks rather than issuing requests or owning
 * business state. Dialogs delegate focus/accessibility behavior to the common Radix wrapper,
 * while metrics preserve the difference between no baseline and zero change.
 */

import type { ReactNode } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Minus,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { BusinessMetric, Currency } from "@/lib/admin-api";

/**
 * Render a platform page title, optional operational context and caller-owned action controls
 * in the shared administration layout.
 */
export function AdminHeader({
  title,
  eyebrow = "Platform administration",
  children,
  detail,
}: {
  title: string;
  eyebrow?: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <header className="admin-page-heading">
      <div>
        <p className="admin-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {detail && <p className="admin-subtitle">{detail}</p>}
      </div>
      <div className="admin-heading-actions">{children}</div>
    </header>
  );
}
/**
 * Map a persisted status to the matching CSS tag and a readable underscore-free label;
 * interpretation of the status stays with its caller.
 */
export function StatusTag({ status }: { status: string }) {
  return <span className={`admin-tag tag-${status}`}>{status.replaceAll("_", " ")}</span>;
}
/**
 * Explain an empty administrative result with an optional next-step message; absence of
 * records must not be represented as a loading error.
 */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="admin-empty">
      <Inbox size={28} strokeWidth={1.4} />
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}
/**
 * Display a supplied metric and comparison, keeping a null previous-period baseline distinct
 * from an actual zero-percent change.
 */
export function Metric({
  label,
  value,
  metric,
  detail,
  children,
}: {
  label: string;
  value: string | number;
  metric?: BusinessMetric;
  detail?: string;
  children?: ReactNode;
}) {
  const visibleDelta = metric?.delta_percent === 0 ? 0 : (metric?.delta ?? 0);
  const Trend = !visibleDelta ? Minus : visibleDelta > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="admin-metric">
      <span className="admin-metric-label">
        <span>{label}</span>
        {children}
      </span>
      <strong className="admin-metric-value">{value}</strong>
      {metric ? (
        <span
          className={`admin-metric-detail ${visibleDelta > 0 ? "trend-up" : visibleDelta < 0 ? "trend-down" : ""}`}
        >
          <Trend size={14} />
          {metric.delta_percent === null
            ? "No prior baseline"
            : `${metric.delta_percent > 0 ? "+" : ""}${metric.delta_percent}% vs previous period`}
        </span>
      ) : (
        <span className="admin-metric-detail">{detail || "Current total"}</span>
      )}
    </div>
  );
}
/**
 * Expose controlled reporting-period and optional currency choices; callers own cache keys and
 * reset pagination when filters change.
 */
export function PeriodControls({
  days,
  setDays,
  currency,
  setCurrency,
  children,
}: {
  days: number;
  setDays: (n: number) => void;
  currency?: Currency;
  setCurrency?: (c: Currency) => void;
  children?: ReactNode;
}) {
  return (
    <div className="admin-period-controls">
      <div className="admin-segmented" aria-label="Reporting period">
        {[7, 30, 90, 365].map((n) => (
          <button key={n} type="button" aria-pressed={n === days} onClick={() => setDays(n)}>
            {n === 365 ? "1 year" : `${n} days`}
          </button>
        ))}
      </div>
      {currency && setCurrency && (
        <select
          aria-label="Reporting currency"
          value={currency}
          onChange={(e) => setCurrency(e.target.value as Currency)}
        >
          {["EUR", "TND", "USD"].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      )}
      {children}
    </div>
  );
}
/**
 * Calculate the visible page count from server totals and disable boundary navigation;
 * onChange requests a new page without mutating data locally.
 */
export function Pagination({
  page,
  total,
  pageSize = 20,
  onChange,
}: {
  page: number;
  total: number;
  pageSize?: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="admin-pagination">
      <span>{total.toLocaleString()} results</span>
      <div>
        <span>
          Page {page} of {Math.max(1, Math.ceil(total / pageSize))}
        </span>
        <button
          className="admin-icon-button"
          aria-label="Previous page"
          title="Previous page"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft size={18} />
        </button>
        <button
          className="admin-icon-button"
          aria-label="Next page"
          title="Next page"
          disabled={page * pageSize >= total}
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
/**
 * Compose the shared accessible dialog with a required title/description and caller-controlled
 * open state for reviewable administrative actions.
 */
export function AdminModal({
  title,
  description,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  description: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="admin-modal">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  );
}
