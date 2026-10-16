# Engineering Quality Review — 13 October 2026

Finalized after resumption on **15 October 2026**. The resumed source/documentation check found
no new semantic application change; 53 focused RAG/provider/API tests and backend Ruff passed.
The complete-suite, browser and live-provider results below retain their actual 13 October date.

## A. Executive Summary

The existing SupportDeflect application already had a coherent multi-tenant architecture,
migrations, durable workers and substantial test coverage. Discovery covered the current root
layout rather than reverting the pre-existing, uncommitted repository reorganization. Baseline
backend tests passed (141); operations tests passed (10); mailer tests passed (6); frontend lint,
TypeScript and client/SSR build passed. Frontend baseline execution also exposed host-load
timeouts, which were investigated rather than counted as passing tests.

This review implemented incremental corrections to concurrency, tenant session synchronization,
logging privacy, browser compatibility, imports, backup safety, mail transport and CI startup.
Compatible transitive dependency updates removed the current frontend audit findings. Existing
roles, features, branding, API payloads and schema were preserved. Invalid uploaded content is
now parsed before quota locking, so invalid PDF validation precedes a document quota error.

The final verification ledger is in [TESTING.md](TESTING.md). Local execution verifies the
application within the recorded scope. PostgreSQL/pgvector runtime, Linux container restoration,
VM restart/reboot and hosted CI acceptance remain separate external gates. Local passing tests
are not a claim that these deployment gates have passed.

Final results: **165 backend tests, 44 frontend unit tests, 12 browser scenarios, 8 mailer tests
and 12 operator tests passed**. Lint, TypeScript, client/SSR build, production server smoke and
current dependency audits passed. Real cached MiniLM persistence/tenant isolation and real Groq
greeting/sourced widget generation also passed on the disposable synthetic policy.

## B. Architecture Assessment

React 19/TanStack Start renders public, tenant and platform routes. One API transport and React
Query own request/session/cache state. FastAPI/Pydantic enforce authenticated database-backed
roles, tenant ownership and contracts. SQLAlchemy services own business transactions and Alembic
migrations 0001–0007 own the schema. PostgreSQL/pgvector is the deployment database; native SQLite
persists JSON vectors for development. Local multilingual MiniLM and hybrid retrieval prepare
grounded context; Groq generates answers. The shared Shadow DOM widget supports visitor chat and
capability-protected human follow-up. Separate ingestion and Nodemailer processes consume durable
database jobs/outboxes. Traefik is the sole published Compose ingress; Mailpit captures local mail.

No framework migration or general repository/container abstraction was needed. Small helpers
centralize specific invariants: account email conflict recovery, secure browser request IDs,
tenant quota reservations and document lifecycle locks. Slow downloads/inference stay outside
short write transactions. [ARCHITECTURE.md](ARCHITECTURE.md) retains the complete real data-flow
diagrams, ownership map and actor permissions.

PostgreSQL quota admission uses `FOR NO KEY UPDATE`: it serializes writers while permitting
foreign-key references during document-first retry/audit transactions. The deadlock concern is
an inference from the code and documented lock compatibility, with local emitted-SQL coverage;
live PostgreSQL concurrency was not executed. See [PostgreSQL locking](https://www.postgresql.org/docs/current/explicit-locking.html)
and [SQLAlchemy locking](https://docs.sqlalchemy.org/en/20/core/selectable.html#sqlalchemy.sql.expression.Select.with_for_update).

## C. Problems Identified and Resolved

| Severity | Component | Problem | Root cause | Resolution | Verification |
|---|---|---|---|---|---|
| Critical/high advisory | Frontend dependencies | Installed Seroval and source-map-js versions had current advisories | Locked transitive versions 1.5.4 / 1.2.1 | Update only Seroval to 1.6.9 and source-map-js to 1.2.2 | npm audit now reports zero; build/unit/browser checks |
| High | Logging | Uncaught ASGI errors and sensitive access URLs bypassed redaction | Uvicorn owns handlers outside the root logger | Apply safe formatter/filter to existing server handlers | Two actual-handler regressions failed before correction, then passed |
| High | Ingestion | Native workers claimed one pending job twice | SQLite ignores SELECT FOR UPDATE | Conditional atomic claim with retry for losing workers | Real concurrent SQLite sessions |
| High | Ingestion lifecycle | Stale recovery/cancellation or obsolete workers overwrote successor leases | Unreserved native reads and attempt numbers reused by manual retry | Short document writer reservation; attempt plus UTC timestamp fencing | Red/green concurrent recovery, terminal update and embedding-time retry cases |
| High | Quotas | Concurrent native document/question admission exceeded limits | Read/check/write lacked a SQLite writer reservation | Serialize admission; retain expiring in-flight question slots | Concurrent document/question quota regressions |
| High | Billing | Concurrent native refunds exceeded the paid amount | SQLite ignored the payment row lock | Reserve writer before reading remaining refund balance | Real two-session refund regression |
| Medium | Billing/accounts | Duplicate payment keys or email creates returned database errors | Prechecks raced with unique insert | Roll back and replay valid ledger winner or return existing email HTTP 409; preserve other constraint errors | Three ledger concurrency cases and concurrent registration/team/platform cases |
| High | Browser transport | Old-session successful responses could refill a new account's cache | Mutations outlived cache clearing | Reject responses after session change, including JSON/CSV body decoding | Three deferred-response API regressions |
| High | HTTP lab compatibility | Billing dialogs, campaigns and widget preview failed without randomUUID | Secure-context-only API used unconditionally | Cryptographic UUID fallback; per-frame preview correlation IDs | Unit UUID checks and browser journeys with randomUUID removed |
| Medium | Widget Studio | Upload/save completion discarded newer draft edits | Stale closures and editable pending-save fields | Merge latest draft; disable save-time edits/discard during upload | Deferred upload/save component regressions |
| Medium | Imports | PDF/URL/logo work blocked the ASGI event loop | Synchronous work inside async endpoints | FastAPI worker-thread routes; parsing before quota lock | Three actual ASGI responsiveness regressions |
| Medium | URL imports | Queued website titles were lost during refresh | Unsaved title discarded before indexing | Apply title after locked refresh; preserve explicit and legacy custom titles | Four worker/API title cases |
| High | Restore | Corrupt/truncated gzip archive could replace good volume data | TAR EOF prevented complete gzip trailer validation | Validate complete gzip CRC/EOF before replacement, using same open descriptor | Four corrupt/truncated preservation subcases and descriptor regression |
| High | Mailer | Service-token requests followed redirects | Fetch default redirect behavior | Reject internal API redirects | Actual two-origin HTTP tests for 302/307/308 |
| High | CI startup | Fresh containers could not load their embedding model | Offline setting with empty cache volume | Permit initial model download | Workflow/config regression and Compose parsing; live job pending |
| Medium/low | Chat/uploads/config | IME Enter submitted early; unnamed controls/short questions; same file could not be reselected; stale example port/model | Composition state, validation and input/config inconsistencies | Respect composition, name controls, trim/enforce API bounds, reset file input, align examples | Component/browser regressions, lint and configuration review |

Dependency severity is the upstream advisory classification, not proof of an exploit against this
application. Sources: [Seroval callable advisory](https://github.com/advisories/GHSA-p6vx-979v-rg4c),
[Seroval allocation advisory](https://github.com/advisories/GHSA-jp82-f5mq-hwhp), and
[source-map-js advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).
The browser fallback follows the documented difference between
[randomUUID](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID) and
[getRandomValues](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues).

## D. Changes Implemented

| Files | Purpose and impact |
|---|---|
| backend/app/routers/auth.py, team.py; services/organizations.py, new accounts.py | Preserve route-specific duplicate-email HTTP 409 contracts and roll back incomplete creates |
| backend/app/services/billing.py | Unique-key race replay without duplicate audit/mail; serialize native refunds |
| backend/app/services/subscriptions.py | Shared, short organization quota transaction and appropriate PostgreSQL lock mode |
| backend/app/services/ingestion.py, ingestion_jobs.py; routers/platform.py | Atomic claims, fenced completion/recovery/cancellation/retry, consistent document-before-job locks and title persistence |
| backend/app/routers/documents.py, settings.py | Run blocking extraction/logo work in worker threads |
| backend/app/core/logging.py; services/rate_limiter.py | Protect actual Uvicorn logging boundary and correct obsolete limiter documentation |
| backend/app/static/widget.js | IME-aware submission and preview correlation independent of secure-context UUID API |
| frontend/src/lib/api.ts, admin-api.ts, new request-id.ts | Reject stale authenticated JSON/CSV responses and generate secure IDs on supported HTTP lab origins |
| frontend/src/routes/dashboard.widget.tsx, platform.billing.tsx, platform.communications.tsx | Preserve asynchronous drafts and use compatible request IDs; retain route splitting |
| frontend/src/components/chat-playground.tsx, upload-zone.tsx | Align question validation/accessibility and permit file reselection |
| frontend/package-lock.json | Exactly two transitive package version changes; no dependency added |
| backend/tests/test_billing_concurrency.py, test_ingestion_concurrency.py, test_account_creation_concurrency.py, test_logging.py, test_configuration_operations.py, test_product_consistency.py | Meaningful transaction, lifecycle, server-handler, API and configuration regressions |
| frontend/src/test/api.test.ts, chat-playground.test.tsx, product-consistency.test.tsx; new request-id.test.ts, widget-studio.test.tsx; e2e/administration.spec.ts, widget.spec.ts | Deferred response/draft, browser API availability, composition, accessibility and reselection coverage |
| mailer/worker.mjs, templates.test.mjs | Refuse privileged redirects; correct native default API port; exercise HTTP transport |
| scripts/restore_archive.py, scripts/tests/test_operations.py | Reject damaged gzip before any file replacement and verify source-descriptor reuse |
| .github/workflows/ci.yml; backend/.env.production.example | Permit fresh model cache initialization; align multilingual model configuration |
| README.md; docs/ARCHITECTURE.md, API.md, SECURITY.md, RUNBOOK.md, TESTING.md, AUDIT.md, IMPLEMENTATION_STATUS.md, PROFESSOR_REQUIREMENTS.md, this report | Current schema head, data/locking/session boundaries, restore guarantees and actual evidence |

## E. Functional and Integration Validation

Code tracing covered authentication/version revocation/forced password replacement, roles and
tenant queries, knowledge imports/deletion/jobs, retrieval/grounding/fallback, widget preview and
public capabilities, support case assignment/resolution, analytics, subscriptions, ledger writes,
mail invitations/campaigns/acknowledgements, and configuration/backup/restore paths.

API and component tests use fresh disposable SQLite databases and explicit test-only AI providers.
They test real route/session/transaction behavior while provider doubles keep external effects
isolated. Concurrency tests synchronize real database sessions, not mocked row-count results.
PostgreSQL SQL compilation asserts the actual helper's intended lock mode; it is not a running
PostgreSQL test.

Browser scenarios exercise the real isolated API/UI, customer and administrative routes at
multiple viewport widths, registration/login/password replacement, session expiry/cross-tab
logout/recovery, ledger/campaign controls, widget design/logo persistence, exact snippet on an
independent host, composition, grounded fixture chat and human reply polling. SMTP uses a real
local Nodemailer worker and disposable Mailpit capture; it does not claim Gmail delivery.

An additional real worker/Mailpit exercise injected two failed delivery acknowledgements and a
successful third. It observed one SMTP acceptance, three identical acknowledgements and a later
claim without resend. The synthetic harness is local ignored evidence at
logs/verify-mailer-ack-2026-10-13.mjs. Normal user databases/mailboxes were not used for these tests.

The real local MiniLM/Groq verification passed with a disposable synthetic shipping policy:
dimension 384, one persisted chunk after reconnect, foreign-tenant exclusion, actual Groq models
and greeting/generation HTTP 200, and a resolved widget answer with one source stating three
working days. The configured model was openai/gpt-oss-20b. Fixture AI is never counted as real
generation. An initial model run during source editing hit a cached-module/new-import mismatch
and was not counted as a full passing provider check; the stable-source rerun passed.

## F. Test Results

[TESTING.md](TESTING.md#full-project-review-2026-10-13) records exact final commands, results,
tool versions and failure/retry history. Run frontend commands with Node 24.21.0 rather than the
host's default Node 23.8.0. Run backend Ruff from backend so automatic project-root/import
classification matches its configuration. The operator suite uses the same configuration from
the root for scripts alone.

Baseline and newly reproduced failing tests were retained as evidence; passing results are only
claimed for observed reruns. No assertions were disabled, provider guard bypassed or E2E timeouts
increased. New tests exercise actual invariants rather than duplicating implementation syntax.

## G. Code Quality and Documentation

Useful module documentation/comments now explain worker scheduling, quota lock duration, lease
identity, recovery order, error disclosure, legacy title behavior and rollback ownership. Small
helpers avoid repeating these constraints across callers. The architecture guide describes cache
clearing plus stale-response rejection, expiring question slots and SQL lock compatibility.
Operations documentation distinguishes full gzip integrity validation from atomic disk-failure
recovery. Current API/runbook schema references now correctly identify migration 0007; no new
migration or existing user-data migration was performed by this review.

## H. Remaining Risks and Limitations

- Docker Engine and a configured disposable PostgreSQL service were unavailable. pgvector,
  live PostgreSQL concurrency, container/image builds, Linux ownership/restore writes and actual
  empty-cache container startup still require their prepared integration/CI/VM environments.
- Hosted CI, external deployment, VM reboot/persistence and restore drills were not executed.
  No commit, push, merge, deployment or destructive production operation was performed.
- Browser UUID coverage removes the unavailable API on localhost; it does not prove the
  actual VM/IP HTTP deployment. HTTPS remains required for production credentials/embedding.
- LocalStorage session/capability persistence is the established trust boundary. Logout alone
  does not revoke a copied JWT; version-changing account/password operations do. Retention and
  customer-data deletion policy, MFA and hostile-file process isolation remain product/operational
  limits, rather than features silently added in this maintenance pass.
- Imported URLs, including query strings, appear in visitor citations. Use public non-token
  sources. RAG evidence validation reduces grounding failures but does not prove factual accuracy
  for arbitrary documents/prompts. A successful live provider check is point-in-time evidence.
- Restore validates corruption before replacement, but disk failure/interruption during extraction
  can still leave partial files. Keep a protected pre-restore backup and perform the Linux drill.
- Dependency scans report known indexed advisories at the time of execution; they are not binary
  certification, image scanning or a penetration test. One upstream Starlette test-client
  deprecation warning remains. Vite reports informational plugin timing diagnostics.

## I. Final Quality Checklist

VERIFIED means the stated local review/check actually occurred. PARTIALLY VERIFIED identifies
the specific unexecuted environment; it is not counted as passing acceptance.

| Definition of Done | Status | Evidence / limit |
|---|---|---|
| Repository structure analyzed | VERIFIED | Current root modules, manifests/configs and pre-existing Git reorganization inspected |
| Main architecture understood | VERIFIED | Full module/actor/data-flow map and preserved architecture guide |
| Critical business workflows inspected | VERIFIED | API/services/UI/worker paths traced, regressions and browser scenarios |
| Frontend functionality reviewed | VERIFIED | Routes/components/contracts, unit/browser/mobile checks |
| Backend functionality reviewed | VERIFIED | All route/service/core modules and tests inspected |
| API contracts checked | VERIFIED | Typed consumers, real API tests, preview/public widget and mail flows |
| Database integration checked | PARTIALLY VERIFIED | Real SQLite transactions/migrations; PostgreSQL integration explicitly skipped |
| Cross-component synchronization checked | PARTIALLY VERIFIED | Session/draft/job/quota/mail races covered locally; PG runtime gate open |
| Authentication/authorization reviewed | VERIFIED | DB roles/versioning, invitation gates, tenant/visitor boundaries and session tests |
| Relevant security risks addressed | PARTIALLY VERIFIED | Proven privacy/redirect/dependency issues corrected; image/host/penetration checks unexecuted |
| Error handling reviewed | VERIFIED | Provider/ingestion/account/ledger/transport/SMTP/restore/logging paths |
| Asynchronous behavior reviewed | VERIFIED | Real ASGI responsiveness, deferred UI responses and durable worker regressions |
| Important edge cases considered | VERIFIED | Invalid inputs, duplicates, stale/expired state, cancellation and partial failures |
| Critical defects corrected | VERIFIED | Reproduced defects corrected within the locally verified scope |
| Necessary refactoring performed | VERIFIED | Small shared invariants; preserved functionality and architecture |
| Important source documented | VERIFIED | Accurate focused comments/module docs and source/architecture review |
| Architecture documentation updated | VERIFIED | Lock/session/lease/question-reservation boundaries documented |
| Existing tests executed | VERIFIED | Baseline plus final suites in the execution ledger |
| Missing critical tests added | VERIFIED | Concurrent ledger/account/ingestion, server logging and deferred browser state |
| Integration tests executed where available | PARTIALLY VERIFIED | Local API/SQLite/HTTP/SMTP real integrations; PG unavailable |
| End-to-end workflows verified where possible | PARTIALLY VERIFIED | Local browser journeys; VM, hosted CI and external delivery remain outside proof |
| Build/static checks executed | PARTIALLY VERIFIED | Client/SSR build, lint/type/dependency/Compose checks; Docker builds unavailable |
| Regressions investigated/corrected | VERIFIED | Failed runs investigated, targeted red/green tests and final stable-source reruns |
| Remaining limitations documented | VERIFIED | Explicit external gates and product/operational constraints above |
| Final changed-code review completed | VERIFIED | Independent peer review plus integrated final review; no known unresolved high defect in verified scope |

External acceptance gates: **BLOCKED locally** by unavailable PostgreSQL/Docker/VM infrastructure
and unobserved hosted CI. No checklist item uses NOT APPLICABLE because each supplied condition
applies to this application's actual scope.
