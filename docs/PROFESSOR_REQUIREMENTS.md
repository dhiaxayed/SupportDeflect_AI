# Professor Requirement -> Implementation -> Files -> Test / Proof

The latest phase-1/documentation review is the [16 October 2026 presentation](../README_SUIVI_PHASE_1.md)
and [test ledger](TESTING.md). The [13 October engineering review](QUALITY_REPORT_2026-10-13.md)
records the preceding behavioral fixes. Earlier dated results below remain
historical snapshots. The latest local checks do not close the VM, PostgreSQL/Docker runtime
or hosted-CI acceptance gates.

Sources reviewed: Local-Infrastructure-Project-Roadmap-EN-FR.docx and the supplied
Local-Infrastructure-Project-Roadmap-EN-FR (1).docx (English and French sections).
The existing project records Groq as its sole runtime cloud exception to the roadmap's self-hosting rule.
This is an explicit deviation from literal zero-cloud compliance; teacher acceptance of that
exception remains a scope decision, not a result proved by application tests.
All other core services remain local. Provisioning decision: manual Ubuntu Server VM.
"Implemented" below is not a claim that an unavailable infrastructure test has run.

## Gate Status Snapshot: 16 October 2026

| Phase | Current status | Remaining acceptance condition |
|---|---|---|
| 1 - Application | Locally demonstrated; executable API, browser, SMTP, build and real AI evidence recorded | Keep the suite passing for the approved source revision |
| 2 - Infrastructure | Implementation and executable checks prepared; NOT accepted yet | User confirmed no VM yet: provision Linux, run the actual images/proxy and prove restart, reboot and restoration |
| 3 - Operations | Configuration, safety checks, CI and runbooks prepared; NOT accepted yet | Publish a reviewed revision, observe passing hosted CI, complete clean-room VM installation/manual release |

The 3-4 October architecture refactor retained the root layout, public contracts, database schema
and approved design. Revalidation passed 63 backend tests, 23 frontend tests, 10 operator tests,
four mailer tests and all eight browser scenarios in one run, plus lint/types/build/production smoke.
Real local retrieval/Groq passed on 4 October; the updated native stack was restarted and its
public/protected/health entry points verified on 5 October.
See TESTING.md for the dated commands and qualifications; these do not close phases 2 and 3.

The 6 October AI repair adds migration 0006, multilingual local embeddings, hybrid retrieval,
bounded history and server-verified citations. At that checkpoint, the complete backend suite passed 101 tests;
the Playground and independent-widget browser journeys also pass. See the dated RAG section
in TESTING.md; infrastructure gates remain open until their actual environment is available.
Final 8 October verification confirms real Groq answers about the existing CV, pronoun-based
skills follow-up, company clarification and honest abstention for an absent fact. Frontend
tests, lint/types and operator tests were rerun after the interruption.

`scripts/verify_stack.py` now collects real runtime evidence and fails when Docker is absent.
`scripts/tests/test_operations.py` tests its safety/validation logic; passing those unit tests does
not simulate a successful deployment. CI now starts the complete stack and rehearses backup/restore
on disposable volumes. This hosted scenario is implemented, not yet observed executing.

## Phase 1: Application, Weeks 1-4

| Professor requirement | Implementation | Files | Test / proof |
|---|---|---|---|
| Requirements and architecture | Actors, scope, diagrams, ownership, business rules | README.md; docs/ARCHITECTURE.md | Manual repository review; actor/API authorization tests |
| Real frontend | React/TanStack authenticated tenant and platform workspaces | frontend/src/routes/; frontend/src/components/ | Type checking, unit tests, production build, desktop/mobile browser tests |
| Real backend/API | FastAPI routes and business services | backend/app/main.py; backend/app/routers/; backend/app/services/ | Executable HTTP/API tests |
| Database schema | SQLAlchemy models; Alembic 0001-0007; PostgreSQL pgvector; persisted SQLite development DB | backend/app/models.py; backend/alembic/ | Migration tests; real local persistence/retrieval check; PostgreSQL CI job prepared |
| Authentication | BCrypt, signed JWT, live DB roles, revocation, invitation expiry/reset | backend/app/security.py; app/deps.py; app/routers/auth.py | Login, wrong-role/foreign-tenant denial, password reset browser/API tests |
| Passing test suite | Backend, frontend, mailer, real browser/SMTP and separate PostgreSQL tests | backend/tests/; backend/integration/; frontend/src/test/; frontend/e2e/; mailer/templates.test.mjs | Commands/results in TESTING.md; failures must block release |
| Core use cases end to end | Knowledge -> widget -> answer/fallback -> Inbox -> human reply; administration and mail | app/services/rag.py; app/static/widget.js; frontend/e2e/ | Independent hostile-CSS HTML client, saved logo/design, real SMTP invitation; test LLM explicitly isolated |
| Hard application checkpoint | Actual runtime, not compilation alone | docs/TESTING.md; docs/AUDIT.md | Local checks recorded; real Groq widget answer also verified (HTTP 200, one source) |

## Phase 2: Infrastructure, Weeks 5-8

| Professor requirement | Implementation | Files | Test / proof |
|---|---|---|---|
| Linux/server fundamentals | SSH, host addressing, service inspection, disk/log/security procedure | docs/VM_SETUP.md; docs/RUNBOOK.md | Instructions reviewed; Linux execution NOT claimed |
| Provision actual VM | Manual Ubuntu Server 24.04 LTS, hypervisor/bridged or NAT network | docs/VM_SETUP.md | NOT EXECUTED: no configured Linux VM or WSL distribution in this environment |
| Dockerfile per application service | Multi-stage Python backend reused by worker/migration; Node frontend; Node mailer | backend/Dockerfile; frontend/Dockerfile; mailer/Dockerfile | Static checks; image-build CI defined; local builds NOT EXECUTED (no Engine) |
| Infrastructure service packaging | Pinned upstream PostgreSQL/pgvector, Traefik, Mailpit images | docker-compose.yml | Compose configuration validated; upstream images do not need empty wrapper Dockerfiles |
| Docker Compose orchestration | Dependency health, one-shot migration, restarts, log rotation | docker-compose.yml | Official standalone Compose config validation; API tests verify topology contract |
| Container networking | edge_net/data_net; service DNS; only proxy host exposure | docker-compose.yml; scripts/verify_stack.py | Static topology contract; runtime probe checks actual attachments and routed requests; execution pending Engine |
| Persistent volumes | Database, local logos, mailbox and model cache | docker-compose.yml | Declared volumes checked; actual down/up persistence still requires VM |
| Mandatory reverse proxy | Sole published ingress; frontend/API/mail routes; no Docker socket | infra/traefik/routes.yml | Compose/static route review; runtime ingress proof pending Engine |
| Single compose up starts stack | Environment generator, migrations before services | scripts/configure.py; docker-compose.yml; README.md | Config validation; clean-room VM startup pending |
| Data survives restart | Named volumes; exact identity/design/logo/mail comparisons; safe full restore with ownership | scripts/verify_stack.py; scripts/backup_stack.sh; scripts/restore_stack.sh; scripts/restore_archive.py | Operator safety tests passed; actual CI/VM down/up, reboot and restore NOT claimed |
| Decide provisioning early | Explicit manual VM installation, not an undecided Vagrant/Multipass alternative | docs/VM_SETUP.md | Decision documented |
| Hard infrastructure checkpoint | Running VM/ingress/persistence required for acceptance | docs/RUNBOOK.md | OPEN: written configuration alone does not meet the teacher's definition of done |

## Phase 3: Operations, Weeks 9-12

| Professor requirement | Implementation | Files | Test / proof |
|---|---|---|---|
| Git repository and real branching model | Feature branch -> review -> CI -> merge; no discarded user changes | .git; README.md | Local feature branch exists; no commit/push/merge performed on user's behalf |
| Environment outside code | Central settings validation; env examples; generator; ignored private files | backend/app/core/config.py; .env.example; .gitignore; scripts/configure.py | Invalid production/test-provider configurations rejected by tests |
| No committed secrets | Secret placeholders only in examples; test-only credentials scoped to disposable data | .gitignore; CI/E2E fixtures | Working-tree review; historical Git-secret attestation is not implied |
| Build/test every push | Backend, operator scripts, PostgreSQL, frontend, mailer, browser/SMTP; image startup, persistence and fresh-volume restore | .github/workflows/ci.yml | Local suites executed; hosted execution pending an authorized push |
| No automatic deployment | No deploy job, no SSH deployment action | .github/workflows/ci.yml; docs/RUNBOOK.md | Automated no-deploy contract and manual workflow review |
| Complete README | Stack and native setup, roles, model/mail behavior and links | README.md | Updated against actual paths/commands; clean-room VM clone/run remains pending |
| Deployment/operations runbook | Install, health, update, secrets, TLS, backup/restore, demonstration | docs/VM_SETUP.md; docs/RUNBOOK.md | Procedures supplied; unrun VM commands clearly identified |
| New contributor clone/run | Approved revision + generated env + explicit key + compose up | README.md; docs/VM_SETUP.md | Cannot certify full VM reproducibility without actually running the VM gate |
| Hard operations checkpoint | Hosted passing pipeline and documented manual release | docs/AUDIT.md | OPEN until reviewed revision is published and CI is observed passing |

## Acceptance Rule

Do not mark the entire professor project complete merely because local tests pass.
The missing external proofs are concrete: actual VM/Engine deployment and persistence/restore,
and an observed hosted CI run. The real Groq request has now passed.
All commands needed to collect them are documented; none are fabricated.
