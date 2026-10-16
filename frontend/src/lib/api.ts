/**
 * @file Browser contract and transport boundary for the FastAPI /api/v1 API. Components and
 * query hooks import these DTOs and request helpers rather than implementing authentication or
 * response parsing themselves. Token events coordinate tabs; stale authenticated results are
 * rejected before they can enter a different account's cache. API errors remain rejected
 * promises for the calling view to present.
 */

// API client wired to the SupportDeflect FastAPI backend.
import type { WidgetDesign } from "./widget-design";
// VITE_API_URL defaults to the same-origin /api/v1 path served by Vite or Traefik.

export const API_BASE_URL = (import.meta.env.VITE_API_URL ?? "/api/v1").replace(/\/$/, "");

const TOKEN_KEY = "supportdeflect_admin_token";
const SESSION_EVENT = "supportdeflect:session-changed";

/* ----------------------------- Token storage ----------------------------- */

/**
 * Read the current browser token; return null during SSR so a server render never assumes a
 * visitor session.
 */
export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

/**
 * Persist a newly issued bearer token and notify this tab immediately; other tabs receive the
 * browser storage event.
 */
export function setToken(token: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_KEY, token);
  window.dispatchEvent(new window.Event(SESSION_EVENT));
}

/**
 * Remove browser authentication and announce the change so protected layouts and cached tenant
 * data are invalidated.
 */
export function clearToken(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new window.Event(SESSION_EVENT));
}

/**
 * Subscribe to same-tab token events and cross-tab storage changes. Return cleanup for React
 * subscriptions to avoid retained listeners.
 */
export function subscribeSession(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  /**
   * Notify subscribers only when the authentication key or the entire storage area changes;
   * unrelated site storage must not reset the workspace.
   */
  const onStorage = (event: StorageEvent) => {
    if (event.key === TOKEN_KEY || event.key === null) listener();
  };
  window.addEventListener(SESSION_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(SESSION_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Report token presence for client query gates; server-side authorization still validates
 * identity, role and tenant on every request.
 */
export function hasToken(): boolean {
  return Boolean(getToken());
}

/* -------------------------------- Types ---------------------------------- */

// Keep these interfaces aligned with backend/app/schemas.py.
// UI components should import domain types from here instead of mock/demo files.

/**
 * Tenant identity and public widget configuration embedded in authenticated account responses;
 * public_id is suitable for the install snippet, while id is internal.
 */
export interface Organization {
  id: string;
  public_id: string;
  name: string;
  widget_brand_name: string;
  widget_primary_color: string;
  widget_greeting: string;
  support_email: string | null;
  strict_mode: boolean;
  allowed_domains: string[];
}

/**
 * Authoritative account contract: role controls navigation, organization may be null for a
 * super admin, and must_change_password gates invited users.
 */
export interface User {
  id: string;
  email: string;
  full_name: string | null;
  role: "super_admin" | "tenant_admin" | "support_agent";
  organization: Organization | null;
  is_active: boolean;
  must_change_password?: boolean;
}

/**
 * Successful login/registration payload coupling the issued bearer token with the current
 * server-resolved account.
 */
export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}

/**
 * Document metadata and ingestion lifecycle returned by the backend; error_message is
 * sanitized and content bodies are not included.
 */
export interface BackendDocument {
  id: string;
  title: string;
  source_type: string;
  source: string;
  mime_type: string | null;
  status: string;
  chunk_count: number;
  error_message: string | null;
  is_active: boolean;
  created_at: string;
  indexed_at: string | null;
}

/**
 * One retrieved evidence passage with its document/chunk identity, retrieval score, snippet
 * and optional citation number.
 */
export interface BackendSource {
  document_id: string;
  title: string;
  source: string;
  chunk_index: number;
  score: number;
  snippet: string;
  reference?: number | null;
}

/**
 * Bounded user/assistant history sent as conversational context; history never replaces
 * indexed source evidence.
 */
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Grounded answer contract distinguishing resolution, clarification, insufficient knowledge
 * and provider outages; scores are retrieval heuristics.
 */
export interface BackendChatResponse {
  answer: string;
  sources: BackendSource[];
  confidence_score: number;
  status: "resolved" | "needs_human" | "clarification_needed";
  needs_human: boolean;
  reason?:
    | "documented_answer"
    | "greeting"
    | "insufficient_knowledge"
    | "retrieval_unavailable"
    | "llm_unavailable"
    | "clarification_needed";
  // Clarification is a normal next conversational turn, not a human-support case.
  error_code?: string | null;
  retry_after_seconds?: number | null;
}

/**
 * Immutable logged AI result used by tenant reporting; a later human answer does not rewrite
 * its status or confidence.
 */
export interface AnalyticsQuestion {
  id: string;
  question: string;
  answer: string;
  confidence_score: number;
  status: BackendChatResponse["status"];
  needs_human: boolean;
  channel: string;
  visitor_id: string | null;
  created_at: string;
}

/**
 * Document-level reference count for reporting which indexed sources contributed to answers.
 */
export interface DocumentUsage {
  document_id: string;
  title: string;
  count: number;
}

/**
 * Tenant aggregate response containing daily totals, recent/unanswered questions, resolution
 * rate and source-use counts.
 */
export interface AnalyticsSummary {
  daily: { date: string; conversations: number; resolved: number }[];
  frequent_unresolved: { question: string; count: number }[];
  total_questions: number;
  resolved_questions: number;
  unresolved_questions: number;
  resolution_rate: number;
  average_confidence: number;
  latest_questions: AnalyticsQuestion[];
  unanswered_questions: AnalyticsQuestion[];
  top_documents: DocumentUsage[];
}

/**
 * One administrator-editable configuration shared by persistence and the iframe preview; the
 * backend supplies design defaults for older records.
 */
export interface WidgetSettings {
  design?: WidgetDesign;
  brand_name: string;
  primary_color: string;
  greeting_message: string;
  support_email: string | null;
  strict_mode: boolean;
  allowed_domains: string[];
}

/**
 * Server-computed plan limits, rolling usage and effective availability; UI display cannot
 * override quota enforcement.
 */
export interface SubscriptionUsage {
  plan: string;
  plan_label: string;
  status: string;
  trial_ends_at: string | null;
  subscription_ends_at?: string | null;
  effective_status?: string;
  is_active?: boolean;
  documents_used: number;
  documents_limit: number;
  chunks_used: number;
  chunks_limit: number;
  questions_used_30d: number;
  questions_limit_30d: number;
  max_upload_bytes: number;
  advanced_analytics: boolean;
  manual_upgrade_label: string;
}

/* ----------------------------- Core request ------------------------------ */

/**
 * Reject authenticated work that completed after its originating token changed, including
 * mutations that query-cache clearing cannot cancel.
 */
function requireSameSession(token: string | null): void {
  // Cache clearing cancels queries, but mutations can still finish after an account switch.
  // Reject their old data before a caller can put it into the new account's cache or download it.
  if (token && getToken() !== token) throw new Error("Session changed. Please retry.");
}

/**
 * Send a request with the captured bearer token and JSON headers unless its body is FormData.
 * Clear only the matching expired session on 401, turn API validation/quota failures into
 * useful errors, and return the unread successful response for JSON or export consumers.
 */
export async function apiResponse(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers || {});
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

  if (response.status === 401 && token && getToken() === token) {
    // A late failure from an old account must not invalidate a newly established session.
    clearToken();
  }

  if (!response.ok) {
    let message = "Request failed";
    try {
      const data = await response.json();
      if (Array.isArray(data?.detail)) {
        message = data.detail.map((item: { msg?: string }) => item.msg ?? item).join(", ");
      } else {
        message =
          typeof data?.detail === "string" ? data.detail : (data?.detail?.message ?? message);
      }
    } catch {
      message = response.statusText || message;
    }
    throw new Error(message);
  }

  requireSameSession(token);
  return response;
}

/**
 * Decode a successful JSON response under the same session before and after body reading;
 * represent 204 responses as undefined. Reject API or session failures for callers to handle.
 */
export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const response = await apiResponse(path, options);
  if (response.status === 204) return undefined as T;
  const data = (await response.json()) as T;
  requireSameSession(token);
  return data;
}

/**
 * Read an export body with the same authentication checks as JSON, including an account switch
 * while the response is still streaming.
 */
export async function apiBlob(path: string, options: RequestInit = {}): Promise<Blob> {
  const token = getToken();
  const response = await apiResponse(path, options);
  const data = await response.blob();
  requireSameSession(token);
  return data;
}

/* -------------------------------- Auth ----------------------------------- */

/**
 * Exchange email/password credentials for a server-issued session and persist its token before
 * returning the user for role-based navigation.
 */
export async function login(email: string, password: string): Promise<AuthResponse> {
  const data = await apiRequest<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setToken(data.access_token);
  return data;
}

/**
 * Create an organization and its administrator through the public registration API, then
 * establish the returned session. The server owns trial defaults and uniqueness checks.
 */
export async function register(payload: {
  organization_name: string;
  admin_email: string;
  password: string;
  admin_full_name?: string;
}): Promise<AuthResponse> {
  const data = await apiRequest<AuthResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  setToken(data.access_token);
  return data;
}

/**
 * Load the authoritative current account, organization and role; do not infer permissions from
 * the browser token payload.
 */
export function me(): Promise<User> {
  return apiRequest<User>("/auth/me");
}

/**
 * Clear the shared browser session; useLogout additionally clears React Query and navigates to
 * sign-in.
 */
export function logout(): void {
  clearToken();
}

/* ------------------------------ Documents -------------------------------- */

/**
 * Read only the authenticated tenant's document metadata, including asynchronous ingestion
 * status and actionable failures.
 */
export function getDocuments(): Promise<BackendDocument[]> {
  return apiRequest<BackendDocument[]>("/documents");
}

/**
 * Post one file as multipart data. The returned document can already be indexed or remain
 * queued, depending on backend ingestion mode.
 */
export function uploadDocument(file: File): Promise<BackendDocument> {
  const form = new FormData();
  form.append("file", file);
  return apiRequest<BackendDocument>("/documents/upload", { method: "POST", body: form });
}

/**
 * Submit a public URL and optional title for tenant-owned ingestion; server-side fetching and
 * URL restrictions remain authoritative.
 */
export function indexUrl(url: string, title?: string): Promise<BackendDocument> {
  return apiRequest<BackendDocument>("/documents/url", {
    method: "POST",
    body: JSON.stringify({ url, title }),
  });
}

/**
 * Request tenant-scoped removal of one document; callers refresh document, analytics and quota
 * caches after success.
 */
export function deleteDocument(documentId: string): Promise<void> {
  return apiRequest<void>(`/documents/${documentId}`, { method: "DELETE" });
}

/* -------------------------------- Chat ----------------------------------- */

/**
 * Presentation adapter for ChatPlayground: retains evidence and outage reasons while exposing
 * retrieval confidence on a 0..1 scale.
 */
export interface PlaygroundAnswer {
  answer: string;
  confidence: number; // 0..1
  resolved: boolean;
  sources: { title: string; chunk: string }[];
  reason?: BackendChatResponse["reason"];
  errorCode?: string | null;
}

/**
 * Submit an administrator test question with at most eight recent turns, each bounded to the
 * backend history limit. Adapt evidence and diagnostic fields for the playground without
 * treating retrieval similarity as a truth probability.
 */
export async function askPlayground(
  question: string,
  history: ChatTurn[] = [],
): Promise<PlaygroundAnswer> {
  const res = await apiRequest<BackendChatResponse>("/chat", {
    method: "POST",
    body: JSON.stringify({
      question,
      history: history.slice(-8).map((turn) => ({ ...turn, content: turn.content.slice(0, 3000) })),
    }),
  });
  return {
    answer: res.answer,
    reason: res.reason,
    errorCode: res.error_code,
    confidence: res.confidence_score,
    resolved: res.status === "resolved" && !res.needs_human,
    sources: res.sources.map((s) => ({
      title: s.reference ? `[${s.reference}] ${s.title}` : s.title,
      chunk: s.snippet || `Chunk #${s.chunk_index + 1}`,
    })),
  };
}

/* ------------------------------ Analytics -------------------------------- */

/**
 * Fetch tenant conversation aggregates, recent results and document usage for overview and
 * analytics screens.
 */
export function getAnalyticsSummary(): Promise<AnalyticsSummary> {
  return apiRequest<AnalyticsSummary>("/analytics/summary");
}

/**
 * Read tenant questions needing review without modifying their immutable original AI results.
 */
export function getUnresolvedQuestions(): Promise<AnalyticsQuestion[]> {
  return apiRequest<AnalyticsQuestion[]>("/analytics/unresolved");
}

/* ------------------------------- Settings -------------------------------- */

/**
 * Load the tenant administrator's saved widget branding, design and allowed-hostname
 * configuration.
 */
export function getWidgetSettings(): Promise<WidgetSettings> {
  return apiRequest<WidgetSettings>("/settings/widget");
}

/**
 * Replace the validated saved widget configuration. Return the backend-normalized object so
 * the Studio cache and preview share one contract.
 */
export function updateWidgetSettings(payload: WidgetSettings): Promise<WidgetSettings> {
  return apiRequest<WidgetSettings>("/settings/widget", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

/**
 * Read current plan entitlements and rolling usage; the server determines expiry and whether
 * new operations remain allowed.
 */
export function getSubscriptionUsage(): Promise<SubscriptionUsage> {
  return apiRequest<SubscriptionUsage>("/settings/subscription");
}

/* -------------------------------- Helpers -------------------------------- */

/**
 * Display labels intentionally collapse queued and actively processing ingestion into the same
 * visible state.
 */
export type UiDocStatus = "Indexed" | "Processing" | "Failed" | "Draft";

/**
 * Group pending and processing backend states into one UI processing state; unknown statuses
 * remain a neutral draft label.
 */
export function mapDocStatus(status: string): UiDocStatus {
  switch (status) {
    case "indexed":
      return "Indexed";
    case "pending":
    case "processing":
      return "Processing";
    case "failed":
      return "Failed";
    default:
      return "Draft";
  }
}

/**
 * Prefer URL source metadata, then filename/PDF MIME information, when choosing the document
 * badge; unknown uploads display as text.
 */
export function mapDocType(doc: BackendDocument): "PDF" | "TXT" | "MD" | "URL" {
  if (doc.source_type === "url") return "URL";
  const name = (doc.title || doc.source || "").toLowerCase();
  if (name.endsWith(".pdf") || doc.mime_type === "application/pdf") return "PDF";
  if (name.endsWith(".md") || name.endsWith(".markdown")) return "MD";
  return "TXT";
}

/**
 * Render a valid timestamp as a UTC calendar date; preserve an invalid input so malformed
 * metadata is not disguised as a different date.
 */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

/**
 * Format elapsed time in the largest compact unit and clamp future timestamps to zero seconds;
 * invalid values stay visible unchanged.
 */
export function timeAgo(iso: string): string {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return iso;
  const seconds = Math.max(0, Math.floor((Date.now() - d) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Map each server-assigned role to its authorized landing area: platform administration,
 * tenant overview or support Inbox.
 */
export const homeForRole = (role: User["role"]) =>
  role === "super_admin"
    ? "/platform"
    : role === "support_agent"
      ? "/dashboard/inbox"
      : "/dashboard";

/**
 * Resolve the configured API base against the browser origin for installable widget URLs;
 * preserve the configured value during SSR.
 */
export function publicApiUrl() {
  if (typeof window === "undefined") return API_BASE_URL;
  return new URL(API_BASE_URL, window.location.origin).href.replace(/\/$/, "");
}

/**
 * Tenant member contract keeping account activation, invitation expiry and SMTP/local-capture
 * delivery state independent.
 */
export interface TeamUser {
  id: string;
  email: string;
  full_name: string | null;
  role: "tenant_admin" | "support_agent";
  is_active: boolean;
  must_change_password?: boolean;
  temporary_password_expires_at?: string | null;
  invitation_state?: "pending" | "expired" | "accepted" | "inactive";
  invitation_delivery?: {
    id: string;
    status: "queued" | "sending" | "sent" | "failed" | "canceled";
    mode: "local_capture" | "smtp" | "unknown";
    attempts: number;
    error_code: string | null;
    created_at: string;
    sent_at: string | null;
  } | null;
  created_at: string;
}
/**
 * Authenticated Inbox record combining immutable AI evidence with mutable assignment, private
 * notes and human resolution.
 */
export interface SupportCase {
  id: string;
  org_id: string;
  conversation_id: string;
  status: "open" | "in_review" | "resolved" | "closed";
  assigned_to_user_id: string | null;
  assignee: TeamUser | null;
  human_answer: string | null;
  internal_note: string | null;
  reason: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  visitor_id: string | null;
  channel: string;
  question: string;
  ai_answer: string;
  confidence_score: number;
  sources: BackendSource[];
}
/**
 * Super-admin organization metadata, subscription terms and usage counters; optional fields
 * allow summary and detail endpoints to share a type.
 */
export interface PlatformOrg {
  id: string;
  public_id: string;
  name: string;
  created_at: string;
  subscription_plan: string;
  subscription_status: string;
  trial_ends_at: string | null;
  subscription_ends_at?: string | null;
  monthly_fee_minor?: number;
  billing_currency?: string;
  billing_email?: string | null;
  archived_at?: string | null;
  admin_notes?: string | null;
  administrators?: TeamUser[];
  users_count: number;
  documents_count: number;
  chunks_count: number;
  questions_30d: number;
  support_cases_count: number;
  pending_ingestion_jobs?: number;
  processing_ingestion_jobs?: number;
  failed_ingestion_jobs?: number;
}
/**
 * Append-only administrative event with actor/resource identity and bounded non-secret
 * metadata.
 */
export interface AuditEvent {
  id: string;
  org_id: string | null;
  actor_user_id: string | null;
  actor_email?: string | null;
  scope: string;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}
/**
 * Named dependency checks and their safe diagnostic detail, plus the aggregate platform
 * status.
 */
export interface PlatformHealth {
  status: string;
  checks: Record<string, { status: string; detail: string | null }>;
}
/**
 * Read current tenant members for team administration and support-case assignment.
 */
export const getTeam = () => apiRequest<TeamUser[]>("/team/users");
/**
 * Read tenant-safe worker/SMTP readiness without exposing a shared mailbox or service
 * credentials.
 */
export const getTeamMailStatus = () =>
  apiRequest<{
    connected: boolean;
    smtp_ready: boolean;
    detail: string;
  }>("/team/mail-status");
/**
 * Create a tenant member and invitation; the backend controls temporary credentials, expiry
 * and encrypted delivery.
 */
export const createTeamUser = (payload: {
  email: string;
  password?: string;
  full_name: string;
  role: TeamUser["role"];
}) => apiRequest<TeamUser>("/team/users", { method: "POST", body: JSON.stringify(payload) });
/**
 * Patch a member's display name, tenant role or active state; the server enforces self-change
 * restrictions and session revocation.
 */
export const updateTeamUser = (
  id: string,
  payload: Partial<Pick<TeamUser, "full_name" | "role" | "is_active">>,
) => apiRequest<TeamUser>(`/team/users/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
/**
 * Read the tenant Inbox queue for one supported lifecycle state; the selected state also forms
 * the React Query cache key.
 */
export const getCases = (status: SupportCase["status"]) =>
  apiRequest<SupportCase[]>(`/support-cases?status=${status}`);
/**
 * Send one explicit assignment, note, resolution or status action and return the authoritative
 * updated case. Internal notes remain authenticated-only data.
 */
export const updateCase = (
  id: string,
  action: "assign" | "note" | "resolve" | "status",
  payload: Record<string, unknown>,
) =>
  apiRequest<SupportCase>(`/support-cases/${id}/${action}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
/**
 * Read cross-organization operational counts for super-admin screens; this endpoint does not
 * grant tenant membership.
 */
export const getPlatformOverview = () => apiRequest<Record<string, number>>("/platform/overview");
/**
 * Fetch one server-filtered and paginated organization directory page using URLSearchParams
 * prepared by the calling view.
 */
export const getPlatformOrgs = (query: string) =>
  apiRequest<{ items: PlatformOrg[]; total: number; page: number; page_size: number }>(
    `/platform/organizations?${query}`,
  );
/**
 * Load one organization's administrative metadata and usage counters for a super-admin detail
 * screen.
 */
export const getPlatformOrg = (id: string) =>
  apiRequest<PlatformOrg>(`/platform/organizations/${id}`);
/**
 * Patch commercial/account metadata while preserving omitted fields. The API validates plan,
 * monetary and period invariants and records audit events.
 */
export const updatePlatformOrg = (
  id: string,
  payload: Partial<
    Pick<
      PlatformOrg,
      | "name"
      | "billing_email"
      | "admin_notes"
      | "subscription_plan"
      | "subscription_status"
      | "monthly_fee_minor"
      | "billing_currency"
      | "subscription_ends_at"
      | "trial_ends_at"
    >
  >,
) =>
  apiRequest<PlatformOrg>(`/platform/organizations/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
/**
 * Read a page of platform audit events in backend order without modifying the append-only
 * history.
 */
export const getPlatformAudit = (page: number) =>
  apiRequest<AuditEvent[]>(`/platform/audit-events?page=${page}`);
/**
 * Fetch authenticated dependency and worker health summaries; details are service status, not
 * a replacement for deployment acceptance checks.
 */
export const getPlatformHealth = () => apiRequest<PlatformHealth>("/platform/health");
