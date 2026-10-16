# REST API V2

Base path: /api/v1. Bodies and responses are JSON unless stated otherwise.
Authenticated calls use Authorization: Bearer TOKEN. Login is JSON, not an OAuth form.
All tenant ownership comes from the authenticated database user.
OpenAPI /openapi.json and /docs are available only when DOCS_ENABLED=true; production disables them.

## Errors

400: invalid operation/input; 401: missing/expired/invalid token or inactive account;
402: quota/subscription restriction; 403: role/origin/suspended-tenant denial;
404: absent or foreign resource; 409: duplicate email; 413: upload byte limit;
422: schema validation; 429: rate limit.
Most errors use {"detail":"message"}. Quota errors use
{"detail":{"code":"quota_or_subscription_required","message":"...","upgrade":"..."}}.
Validation errors contain a detail array. Callers must handle both forms.

## Authentication

| Method / Path | Access | Body / Response |
|---|---|---|
| POST /auth/register | Public, rate limited | organization_name, admin_email, password, optional admin_full_name; 201 TokenResponse |
| POST /auth/login | Public, rate limited | email, password; TokenResponse |
| GET /auth/me | Any active user | UserOut |
| POST /auth/change-password | Any active user | current_password, new_password; 204 |

TokenResponse contains access_token, token_type=bearer and user.
UserOut contains id, email, full_name, role, is_active, created_at and organization.
Organization is null for a Super Admin. Tenant organization contains public_id, widget fields,
allowed_domains, subscription_plan/status, trial_ends_at and timestamps.
Registration always creates tenant_admin with a 14-day trial, never a platform user.
Passwords require at least 8 characters (12 for bootstrap), maximum 72 UTF-8 bytes.

## Knowledge Base and Playground

All these routes require Tenant Admin:

| Method / Path | Body / Response |
|---|---|
| GET /documents | Array of active DocumentOut |
| POST /documents/upload | multipart/form-data field file; PDF/TXT/MD; 201 DocumentOut |
| POST /documents/url | {"url":"https://example.com/help","title":"Optional title"}; 201 DocumentOut |
| DELETE /documents/{document_id} | Soft delete and vector removal; 204 |
| POST /chat | {"question":"How long are exports available?"}; ChatResponse |

DocumentOut includes id, title, source_type, source, mime_type, status, chunk_count,
error_message, is_active, created_at, indexed_at. Queued ingestion initially returns pending;
poll GET /documents for processing/indexed/failed. Submission is not proof of indexing success.

ChatResponse example:

```json
{
  "answer": "Exports remain available for thirty days.",
  "sources": [{"document_id":"id","title":"Guide","source":"guide.txt","chunk_index":0,"score":0.88,"snippet":"..."}],
  "confidence_score": 0.85,
  "status": "resolved",
  "needs_human": false
}
```

Sources include a numbered `reference` resolving to server-verified verbatim passages.
Both Playground and widget chat accept optional `history`: at most eight objects with
`role` user/assistant and `content` of 1-3000 characters. The server imposes an additional
total history budget. History helps resolve references and is never factual evidence.
`status` can be resolved, needs_human or clarification_needed. `reason` distinguishes
documented_answer, greeting, clarification_needed, insufficient_knowledge, llm_unavailable
and retrieval_unavailable. Operational failures include a safe `error_code`; Groq 429 may
include `retry_after_seconds`. Neither outages nor clarification create widget support cases.

The legacy confidence field is a retrieval similarity heuristic, not a probability or gate.
Playground logs conversations and
consumes question quota but does not open cases.

## Public Widget

| Method / Path | Policy |
|---|---|
| GET /widget/script.js | Public JavaScript; no admin credentials |
| GET /widget/settings/{company_id} | Required approved Origin |
| OPTIONS /widget/{company_id}/chat | Tenant origin policy from URL company ID |
| POST /widget/{company_id}/chat | Required approved Origin, quotas and rate limits |
| POST /widget/chat?company_id=... | Deprecated; matching company_id also required in body |

Canonical chat body:

```json
{"visitor_id":"visitor_stable_id","question":"How long are exports available?"}
```

Visitor ID: 4-128 characters; question: 2-2000 characters.
Response is ChatResponse. A genuine knowledge/risk escalation creates a unique support case;
provider/retrieval outages and clarification requests do not.
Escalations return support_case_id and case_access_token. POST /widget/{company_id}/cases/{case_id}
with {"token":"capability"} retrieves only status and the final human answer. The token binds tenant/case,
expires after seven days and is not a user session. The widget polls visible pending cases every 15 seconds.
There is no public case-history or internal-note endpoint.

Public settings return company_id, brand_name, primary_color, greeting_message, support_email,
strict_mode and the complete design object. An empty allowed-domain list denies access. Approved origins match configured
hostnames or their subdomains. No Referer fallback or unrestricted wildcard CORS is used.
Use a non-null HTTP(S) Origin for REST clients of the public widget too.

The script derives its API location from its own URL; the generated snippet needs only the company ID:

```html
<script src="https://support.example.com/api/v1/widget/script.js"
        data-company="company_PUBLIC_ID"></script>
```

## Tenant Settings and Analytics

Tenant Admin only:

| Method / Path | Result |
|---|---|
| GET /settings/widget | Current WidgetSettingsUpdate |
| PUT /settings/widget | Update branding, origin policy and strictness |
| GET /settings/subscription | Actual plan, status, limits and current usage |
| GET /analytics/summary | Totals, AI resolution rate/confidence, questions, top sources |
| GET /analytics/unresolved | Unresolved AI conversation list |

Widget settings body:

```json
{
  "brand_name": "Acme",
  "primary_color": "#23634f",
  "greeting_message": "How can we help?",
  "support_email": "support@example.com",
  "strict_mode": true,
  "allowed_domains": ["customer.example"]
}
```

Subscription response includes plan/plan_label/status/trial_ends_at,
documents_used/limit, chunks_used/limit, questions_used_30d/questions_limit_30d,
max_upload_bytes, advanced_analytics, manual_upgrade_label.
Human case resolution does not rewrite the original AI conversation or inflate deflection metrics.

## Team

| Method / Path | Access | Body |
|---|---|---|---|
| GET /team/users | Tenant Admin or Support Agent | None |
| GET /team/mail-status | Tenant Admin | Safe worker/transport availability, no mailbox access |
| POST /team/users | Tenant Admin | email, optional initial password/full_name, role (default support_agent) |
| PATCH /team/users/{user_id} | Tenant Admin | Optional full_name, role, is_active |
| POST /team/users/{user_id}/deactivate | Tenant Admin | None |
| POST /team/users/{user_id}/invite | Tenant Admin | Renew an active, unaccepted invitation |

List returns TeamUserOut[]; mutations return TeamUserOut (create: 201).
Fields: id, email, full_name, role, is_active, created_at, must_change_password,
temporary_password_expires_at, invitation_state (pending/expired/accepted/inactive).
The list adds invitation_delivery: latest invitation ID, status, attempts, error_code,
created_at, sent_at and mode (local_capture/smtp/unknown). Mutations may return no delivery
metadata; refetch the list. Passwords, encrypted credentials and claim tokens are never returned.
Allowed roles are tenant_admin and support_agent only.
Foreign IDs return 404. Self-deactivation/self-demotion return 400.
Deactivated accounts cannot log in or use a previously issued token.
Invitation credentials expire after seven days, including already-issued first-login sessions.
Renewal changes credentials and invalidates prior sessions; while SMTP holds a live sending claim,
renewal and pending-role changes return 409. Pending-role changes otherwise queue a new invitation.
Reactivating an unaccepted account also issues fresh credentials; reactivating an accepted account
keeps its personal password. Accepted accounts cannot receive a replacement first-login invitation.
Successful password replacement revokes the initial session; log in again with the new password.

## Support Cases

Tenant Admin and Support Agent, own organization only:

| Method / Path | Body |
|---|---|
| GET /support-cases?status=open | Optional status filter: open, in_review, resolved, closed |
| GET /support-cases/{case_id} | None |
| PATCH /support-cases/{case_id}/assign | {"assigned_to_user_id":"same-org-active-user"}; omit/null to assign self |
| PATCH /support-cases/{case_id}/note | {"internal_note":"Investigation summary"} |
| PATCH /support-cases/{case_id}/status | {"status":"in_review"} |
| PATCH /support-cases/{case_id}/resolve | {"human_answer":"Documented human resolution"} |

Responses are SupportCaseOut or its array. It includes id/org_id/conversation_id/status,
assignee/assigned_to_user_id, internal_note, human_answer, reason, created_at/updated_at/resolved_at,
visitor_id/channel/question/ai_answer/confidence_score/sources.
The note operation replaces the current note; it is not an append-only conversation.
Assignment moves an open case into in_review. Resolve requires nonempty human_answer and records
the actor as assignee when unassigned. A resolved status without a human answer is rejected.
Closed/resolved cases can be reopened. There is no unassign endpoint in this version.

## Platform

All routes require Super Admin:

| Method / Path | Result / Parameters |
|---|---|
| GET /platform/overview | Real organization/user/document/chunk/question/case/job counts |
| GET /platform/organizations | search, status, plan, page (default 1), page_size (default 20, max 100) |
| GET /platform/organizations/{org_id} | Organization metadata and usage/job counts |
| PATCH /platform/organizations/{org_id} | Optional subscription_plan and subscription_status |
| GET /platform/audit-events | page (default 1), page_size (default 50, max 100); array |
| GET /platform/health | Overall status plus database/pgvector/ingestion/llm checks |

Organization list response: {"items":[...],"total":0,"page":1,"page_size":20}.
Plans: trial, starter, pro, enterprise. Statuses: trialing, active, suspended, past_due, canceled.
Updates are audited with actor, organization and old/new values.
Platform detail does not expose private document content.

Audit events contain id, org_id, actor_user_id, scope, action, target_type, target_id, metadata,
created_at. Important actions include bootstrap, organization updates, team mutations,
widget settings and support-case mutations. Passwords/tokens are not recorded.

Health status is healthy/degraded/unhealthy, with per-check detail. A mock provider or SQLite
is degraded; provider unavailability is not API liveness failure. Health HTTP 200 carries the
status object; internal DB/schema readiness uses 503 on failure.

## Internal Health

Backend /healthz is liveness. /healthz/db checks DB connectivity and the current Alembic head
(0007). API startup warms the local embedding model before serving either route.
These are container/internal paths, not routed publicly by Traefik's /api/ rule.
There is no unauthenticated tenant data or public Super Admin bootstrap endpoint.

## Widget Design and Local Assets

GET/PUT /settings/widget includes design, validated by app/widget_design.py. It contains version,
width/height, launcher_size, position, offset_x/offset_y, radius, theme, background_color/text_color,
placeholder, subtitle, identity, logo_path/logo_size, open_behavior/open_delay_seconds.
The existing brand_name/primary_color/greeting_message fields remain the canonical title/accent/welcome.
PUT validates custom-logo ownership; omitting design preserves the stored design for older callers.
POST /settings/widget/logo accepts multipart file, returns logo_path (201), then the caller saves that
path in design. GET /widget/assets/{filename}, /widget/brand.png and /widget/preview serve local assets
and the exact shared renderer; assets contain no tenant-private document content.

## Administration Extensions

| Route under /platform | Behavior |
|---|---|
| GET /business | Period/currency BI aggregates and comparison |
| POST /organizations | Create organization/admin and queue invitation |
| PATCH /organizations/{id} | Metadata, plan/status, fees/currency/billing contact/notes |
| POST /organizations/{id}/period | Signed day adjustment with reason |
| DELETE /organizations/{id} | Confirmed archive; retains ledger/history |
| POST /organizations/{id}/restore | Restore archived organization |
| POST /organizations/{id}/administrators/{user_id}/invite | Renew pending initial access |
| GET/POST /billing/payments | List/record manual receipts with idempotency |
| POST /billing/payments/{id}/refund | Linked, capped refund |
| GET /billing/export | CSV with spreadsheet-formula escaping |
| GET /mail/status; GET /mail/messages | Worker/SMTP state, preferences, paged delivery log |
| POST /mail/preview; POST /mail/send | Audience fingerprint and idempotent campaign queue |
| PATCH /mail/automations/{event} | Enable/disable a supported event |
| POST /mail/messages/{id}/retry | Retry eligible failed delivery |
| GET /ingestion/failed; POST /ingestion/{id}/retry | Inspect/retry failed indexing |

Canonical request schemas are app/admin_schemas.py and app/schemas.py. Internal mail claim/result
routes require X-Mailer-Token and are not user-facing administration APIs. Team invitations can
be renewed via POST /team/users/{id}/invite. Temporary users may call /auth/me and change-password,
but must finish password replacement before other protected operations. JWT versions revoke old sessions.
