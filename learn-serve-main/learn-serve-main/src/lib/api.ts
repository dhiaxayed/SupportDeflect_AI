// API client wired to the SupportDeflect FastAPI backend.
// Configure the base URL with VITE_API_URL (defaults to the local backend).

export const API_BASE_URL = (
  import.meta.env.VITE_API_URL ?? "http://localhost:8000/api/v1"
).replace(/\/$/, "");

const TOKEN_KEY = "supportdeflect_admin_token";

/* ----------------------------- Token storage ----------------------------- */

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
}

export function hasToken(): boolean {
  return Boolean(getToken());
}

/* -------------------------------- Types ---------------------------------- */

// Keep these interfaces aligned with backend/app/schemas.py.
// UI components should import domain types from here instead of mock/demo files.

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

export interface User {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  organization: Organization;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}

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

export interface BackendSource {
  document_id: string;
  title: string;
  source: string;
  chunk_index: number;
  score: number;
  snippet: string;
}

export interface BackendChatResponse {
  answer: string;
  sources: BackendSource[];
  confidence_score: number;
  status: "resolved" | "needs_human";
  needs_human: boolean;
}

export interface AnalyticsQuestion {
  id: string;
  question: string;
  answer: string;
  confidence_score: number;
  status: "resolved" | "needs_human";
  needs_human: boolean;
  channel: string;
  visitor_id: string | null;
  created_at: string;
}

export interface DocumentUsage {
  document_id: string;
  title: string;
  count: number;
}

export interface AnalyticsSummary {
  total_questions: number;
  resolved_questions: number;
  unresolved_questions: number;
  resolution_rate: number;
  average_confidence: number;
  latest_questions: AnalyticsQuestion[];
  unanswered_questions: AnalyticsQuestion[];
  top_documents: DocumentUsage[];
}

export interface WidgetSettings {
  brand_name: string;
  primary_color: string;
  greeting_message: string;
  support_email: string | null;
  strict_mode: boolean;
  allowed_domains: string[];
}

export interface SubscriptionUsage {
  plan: string;
  plan_label: string;
  status: string;
  trial_ends_at: string | null;
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

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

  if (response.status === 401) {
    clearToken();
  }

  if (!response.ok) {
    let message = "Request failed";
    try {
      const data = await response.json();
      if (Array.isArray(data?.detail)) {
        message = data.detail.map((item: { msg?: string }) => item.msg ?? item).join(", ");
      } else {
        message = data?.detail ?? message;
      }
    } catch {
      message = response.statusText || message;
    }
    throw new Error(message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/* -------------------------------- Auth ----------------------------------- */

export async function login(email: string, password: string): Promise<AuthResponse> {
  const data = await apiRequest<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setToken(data.access_token);
  return data;
}

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

export function me(): Promise<User> {
  return apiRequest<User>("/auth/me");
}

export function logout(): void {
  clearToken();
}

/* ------------------------------ Documents -------------------------------- */

export function getDocuments(): Promise<BackendDocument[]> {
  return apiRequest<BackendDocument[]>("/documents");
}

export function uploadDocument(file: File): Promise<BackendDocument> {
  const form = new FormData();
  form.append("file", file);
  return apiRequest<BackendDocument>("/documents/upload", { method: "POST", body: form });
}

export function indexUrl(url: string, title?: string): Promise<BackendDocument> {
  return apiRequest<BackendDocument>("/documents/url", {
    method: "POST",
    body: JSON.stringify({ url, title }),
  });
}

export function deleteDocument(documentId: string): Promise<void> {
  return apiRequest<void>(`/documents/${documentId}`, { method: "DELETE" });
}

/* -------------------------------- Chat ----------------------------------- */

export interface PlaygroundAnswer {
  answer: string;
  confidence: number; // 0..1
  resolved: boolean;
  sources: { title: string; chunk: string }[];
}

export async function askPlayground(question: string): Promise<PlaygroundAnswer> {
  const res = await apiRequest<BackendChatResponse>("/chat", {
    method: "POST",
    body: JSON.stringify({ question }),
  });
  return {
    answer: res.answer,
    confidence: res.confidence_score,
    resolved: res.status === "resolved" && !res.needs_human,
    sources: res.sources.map((s) => ({
      title: s.title,
      chunk: s.snippet || `Chunk #${s.chunk_index + 1}`,
    })),
  };
}

/* ------------------------------ Analytics -------------------------------- */

export function getAnalyticsSummary(): Promise<AnalyticsSummary> {
  return apiRequest<AnalyticsSummary>("/analytics/summary");
}

export function getUnresolvedQuestions(): Promise<AnalyticsQuestion[]> {
  return apiRequest<AnalyticsQuestion[]>("/analytics/unresolved");
}

/* ------------------------------- Settings -------------------------------- */

export function getWidgetSettings(): Promise<WidgetSettings> {
  return apiRequest<WidgetSettings>("/settings/widget");
}

export function updateWidgetSettings(payload: WidgetSettings): Promise<WidgetSettings> {
  return apiRequest<WidgetSettings>("/settings/widget", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function getSubscriptionUsage(): Promise<SubscriptionUsage> {
  return apiRequest<SubscriptionUsage>("/settings/subscription");
}

/* -------------------------------- Helpers -------------------------------- */

export type UiDocStatus = "Indexed" | "Processing" | "Failed" | "Draft";

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

export function mapDocType(doc: BackendDocument): "PDF" | "TXT" | "MD" | "URL" {
  if (doc.source_type === "url") return "URL";
  const name = (doc.title || doc.source || "").toLowerCase();
  if (name.endsWith(".pdf") || doc.mime_type === "application/pdf") return "PDF";
  if (name.endsWith(".md") || name.endsWith(".markdown")) return "MD";
  return "TXT";
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

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
