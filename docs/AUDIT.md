# Final Repository Audit

The latest application/documentation execution is the [16 October phase-1 review](../README_SUIVI_PHASE_1.md)
and [verification ledger](TESTING.md). The [13 October engineering review](QUALITY_REPORT_2026-10-13.md) adds concurrency,
session/logging privacy, restore/redirect and HTTP compatibility corrections, with 165 backend
tests, 44 frontend unit tests and 12 browser scenarios passing. The dated history below remains
useful prior evidence. Target-VM acceptance stays open; hosted PostgreSQL/backend/frontend/mailer
and twelve browser journeys have now passed. The real containers job also passed startup,
sole ingress, SMTP, down/up persistence, fresh-volume restoration and subsequent writes.

## Scope and Verdict

Reviewed application routes, API contracts, authorization, tenant ownership, data models/migrations,
RAG/providers, knowledge ingestion, widget Studio/renderer, business administration, invitations/
SMTP, Compose/proxy/storage, CI, operational scripts and repository documentation.

The application has executable and executed local functional evidence, including a real Groq
answer and real SMTP capture. The teacher's complete infrastructure/operations acceptance
is **not yet certifiable**: the target Linux VM has not been exercised here. The reviewed
branch has been pushed and all six jobs of its first hosted CI run passed on 16 October.
A hosted Linux runner is separate from target-VM provisioning/reboot acceptance.

## Findings and Corrections

| Finding | Correction / evidence |
|---|---|
| Nested legacy frontend/backend trees obscured ownership and broke references | Simple root frontend/backend/mailer/infra/docs/scripts/widget layout; Docker/CI/tests/docs paths corrected |
| Preview and embed could diverge | One Shadow DOM renderer used by the real snippet and iframe Studio |
| Widget options were not all persisted/applied | Strict design schema, migration 0005, full save/load/render path and browser assertions |
| Missing safe local branding workflow | Validated raster upload, ratio-preserving PNG, ownership checks, local persistent volume, default/robot/custom identities |
| Snippet display alone did not prove integration | Independent framework-free HTTP client with deliberately hostile CSS; actual saved design/chat/human reply tested |
| Escalated case resolution did not reach visitor | Scoped expiring reply capability, visible-widget polling, no notes/staff identity leakage |
| Charts used incomplete recent-question samples | UTC SQL aggregates over all matching data; real unresolved frequencies and source usage |
| BI concepts could confuse contracted fees with cash | Explicit MRR/ARR versus payments/refunds, separate currencies and period comparisons |
| Administration was too limited | Organization lifecycle, subscription/period changes, notes, receipt/refund ledger, campaign preview, automation controls, job retry and audit filters |
| Organization listing repeated count queries for each row | Page-scoped grouped aggregates keep query count stable as the page grows |
| Automation switches could miss a click while cache updates settled | Immediate local pending state, disabled duplicate submission and rollback on API error; final browser suite passed |
| Password invitations were insufficiently connected | Encrypted durable outbox, Nodemailer MIME template/logo, initial expiry, forced change, token-version revocation; real SMTP test |
| External mail conflicted with local-only constraint | Mailpit local baseline and visibly honest local-capture status; no external recipient delivery in tests |
| Normal runtime could use fake providers | Fake embeddings/mock LLM/memory vectors restricted to ENVIRONMENT=test |
| Old local LLM and unused vector-provider branches contradicted current brief | Groq-only normal provider, local MiniLM/database vectors; obsolete provider code/config/docs removed |
| Root Groq key was disconnected from native configuration | Explicit native-runner key inheritance without mixing databases or exposing the secret |
| Originally configured Llama unavailable to the actual account | Live models endpoint checked; configurable available gpt-oss-20b selected and real sourced answer verified |
| URL import had a DNS-rebinding window/unbounded response | Validated IP connection with original Host/TLS SNI, per-redirect checks, streamed byte bounds, no env proxy/compression |
| Deleted/nonindexed knowledge could remain searchable | Active/indexed document filtering for both SQL backends; post-embedding active check |
| Document creation could commit without its queued job | Document/job enqueue transaction made atomic |
| Invalid chunk overlap could prevent progress | Central bounds and overlap/dimension/provider validation |
| Dependency audit found 12 known findings | Updated sentence-transformers/transformers/setuptools, reran actual MiniLM and audits |
| Re-embedding utility imported removed schema helper | Uses canonical Alembic migrations and strict vector-length/count validation |
| Proxy needed host Docker socket | Static Traefik file provider, no socket exposure |
| Logos/mail missing from data-protection story | Named volumes, stack backup/validated restore scripts and orphan-logo maintenance |
| CI built images without exercising the complete runtime | Containers job starts Compose, checks proxy/API/auth/SMTP, compares data across down/up, restores onto fresh volumes and checks new writes; actual hosted execution is tracked in Actions |
| Mail backup/restore assumed the default volume name | Resolve the actual mailbox volume through Compose, including the operator's project selection |
| Restored assets/mail lost service ownership | Preserve archived UID/GID and ordinary mode bits; reject unsafe/conflicting/empty archives before deleting data; regression tests added |
| TLS flags on startup did not propagate to backup/restore scripts | Runbook now exports COMPOSE_FILE for all operator commands and uses a trusted CA for verification |
| Environment generator accepted malformed public origins | Reject query/fragment, credentials, invalid host/port and whitespace/environment-line injection; existing secrets remain untouched |
| Extended widget browser journey exhausted its global budget at the final capture | Match other long E2E journeys with a 180-second budget and disable screenshot animations; complete isolated rerun passed on 3 October, retaining every assertion |
| Stale documentation claimed old architecture/unrun checks | Teacher matrix, current architecture/AI/API/runbook and honest result ledger replaced stale material |

## Verification Basis

### Architecture Refactor: 3-4 October 2026

The existing root layout and approved design were retained. This pass found route-to-route
dependencies in administration, repeated invitation/UTC logic, per-row ledger queries, dormant
frontend scaffold and unsafe ingestion exception exposure. It did not redesign the product.

| Finding | Correction / regression evidence |
|---|---|
| Billing imported platform routes; platform imported authentication routes | Organization and ledger operations moved to cohesive services; existing HTTP routes/contracts retained |
| Ledger performed organization/refund queries for every row | Page-scoped aggregate with a three-query regression test for both small and full pages |
| Invitation credential changes were duplicated | Shared invitation operation retains expiry, forced password change, revocation and encrypted outbox behavior |
| General timestamp logic depended on mailing | Typed UTC normalization in core; SQLite/offset/None regression test |
| Provider/SQL exception values reached document/job errors and tracebacks | Explicit public ingestion errors; safe log formatter preserves types/locations, not exception values |
| Inline URL failure left a pending document; retries retained stale errors | Persist failed URL state and clear completed job errors; API/worker regression tests |
| Missing invitation expiry could crash manual retry | Reject expired or malformed invitation state with an explicit conflict response |
| 33 UI scaffold files were unreachable | Removed after TypeScript import-graph analysis and repository-wide dynamic/config/test/documentation reference checks |
| Dependencies remained for removed scaffold and unused build adapters | Removed 31 direct frontend dependencies, regenerated lockfile and reinstalled; retained used Radix primitives and the actual charts |
| Backend production requirements installed lint/test tools | Separate requirements-dev.txt; CI cache/install and documented development commands updated |
| CSV downloads bypassed shared session/error handling | Shared response transport now handles both JSON and downloads; expiry and raw-body tests |
| SSR kept a global last-error cache and matched JSON text fragments | Removed unused browser-style global capture; request-local structured parsing with five SSR regressions |
| Hydration helpers and unused exports duplicated responsibilities | One hydration hook, no unused component-style exports; unused-variable lint enabled |
| Four named route exports prevented automatic component code splitting | Removed two unused exports; team/subscription views and their test imports now use the existing components directory |

Removed 34 frontend source files in total: 33 unreachable scaffold files and the obsolete SSR
capture module. No database migration, public endpoint change, CSS/theme rewrite or framework
upgrade was required. Existing user data, secrets and unrelated working-tree changes were preserved.
Simple route-local reads and the existing HTTPException convention were deliberately retained;
adding generic repositories or an extra exception-mapping layer would not simplify this system.

The updated, dated execution ledger is in TESTING.md. Infrastructure and hosted-CI proof gates
below remain open; a source refactor cannot substitute for those executions.
Real MiniLM ingestion, persistence, tenant isolation and a sourced Groq widget response were
rerun successfully on 4 October after the refactor, separately from test-only provider doubles.

See TESTING.md for commands and actual results; PROFESSOR_REQUIREMENTS.md maps each teacher
requirement to implementation, files and proof status. Eight browser scenarios, 63 API/unit tests
and ten standard-library operator tests supplement 23 frontend tests, mailer tests and production builds.
Real-model verification is separate from deterministic E2E fixtures.
Visual evidence identifies test fixtures and does not misrepresent them as actual business activity.

## Deliberate Product Boundaries

- Payments/refunds are a manual bookkeeping ledger, not bank/card operations.
- Archive is reversible, preserving history; it is not irreversible customer-data erasure.
- Human replies are asynchronous polling, not live agent presence/chat.
- Domain allowlists are browser policy, not authenticated visitor identity.
- AI resolution/confidence are operational heuristics, not guaranteed correctness or proven cost savings.
- SMTP is local capture; the sender alias does not mean Gmail delivered anything.
- Knowledge URLs and initial package/model downloads need network access; storage and inference
  embeddings remain local, and Groq is the sole runtime cloud provider.

## Residual Engineering Risks

No software audit establishes perfection. Known boundaries are documented rather than concealed:
browser JWT storage relies on XSS prevention; MFA/per-device logout are not implemented;
malicious PDF resource isolation needs further hardening before hostile public multi-tenant
operation; backups/customer-data retention require operator policy. The 13 October review
corrected concurrent quota admission, refund and worker lease races with real SQLite regressions.
The PostgreSQL concurrency path has SQL-contract coverage and a prepared integration suite, but
still needs execution on the actual target runtime. SMTP uncertainty can require manual review.

## External Acceptance Gates

1. Provision Linux VM/Docker Engine; build images; verify proxy/container DNS/volumes, restart,
   reboot persistence and a complete disposable restore. This environment has no Engine/VM.
2. Publish the reviewed branch through the authorized Git workflow and observe hosted CI.
   No commit/push/merge/deployment was performed on the user's behalf.

The 2 October 2026 local acceptance probe correctly returned failure with zero claimed runtime
checks because Docker is absent. The user confirmed no VM has been created. The new prepared CI
runtime scenario must not be represented as already executed or as a deployment to the target VM.

Groq is no longer a missing-key limitation: an actual authenticated models lookup and grounded
widget API request succeeded on 27 September 2026. Llama 3.3 availability remains account-specific.
