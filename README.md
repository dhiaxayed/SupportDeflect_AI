# SupportDeflect AI

[![Build and Test](https://github.com/dhiaxayed/SupportDeflect_AI/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/dhiaxayed/SupportDeflect_AI/actions/workflows/ci.yml?query=branch%3Amain)

Self-hosted, multi-tenant customer support: local knowledge retrieval, Groq-generated answers,
a configurable embeddable widget, human follow-up and an operational administration console.
There is no payment gateway, cloud database, cloud storage or external email service in the default stack.

French phase-1 presentation and requirements tracking:
[README de suivi — phase 1](README_SUIVI_PHASE_1.md), including authors, problem,
roles, architecture, data model, diagrams, local demonstration and acceptance evidence.
For code comprehension, use the [per-file French guide](docs/FILE_GUIDE_FR.md) and
[documentation review](docs/DOCUMENTATION_REVIEW_2026-10-16.md).

## Repository

| Directory | Responsibility |
|---|---|
| frontend/ | React 19 / TanStack Start UI, shared widget preview bridge, unit/browser tests |
| backend/app/ | FastAPI, authorization, business services, local RAG, widget renderer |
| backend/alembic/ | Versioned relational schema and PostgreSQL pgvector migration |
| backend/tests/, backend/integration/ | API/security/unit tests and real PostgreSQL integration |
| mailer/ | Nodemailer delivery worker and branded email templates |
| widget/ | Independent HTML integration example and email brand asset |
| infra/ | Traefik routing and optional locally managed TLS |
| scripts/ | Configuration, certificates, backup and restore operations |
| docs/ | Architecture, product flows, audit, teacher checklist and operations |
| .github/workflows/ | Build/test CI only; no deployment automation |

## Start the Full Stack

Prerequisites: a Linux VM with Docker Engine and Compose plugin, Git, Python 3 for configuration,
a Groq API key and a model available to that account. The chosen VM provisioning approach is
**manual Ubuntu Server installation**, documented in [VM setup](docs/VM_SETUP.md).

From the repository root:

```bash
python3 scripts/configure.py --url http://YOUR_VM_IP
# Edit .env: set GROQ_API_KEY and verify GROQ_MODEL.
docker compose config --quiet
docker compose up -d --build
docker compose ps --all
docker compose exec backend python scripts/create_super_admin.py
```

The configuration script refuses to overwrite an existing .env. It creates independent random
secrets without printing them. The bootstrap command securely prompts for administrator
credentials; it never promotes an existing tenant or resets an existing administrator.

Open PUBLIC_URL for the public landing page, then choose Log in or Start building.
The account role selects /platform (Super Admin) or /dashboard
(tenant staff). Registering creates a Tenant Admin, never a Super Admin. The local mailbox
is PUBLIC_URL/mail/ with username admin and MAILPIT_PASSWORD from .env.
Emails are **captured locally**, not delivered to Gmail or customer inboxes.

Only Traefik publishes a host port. The migrate service must exit successfully before
backend/worker start. The initial MiniLM download is stored locally in hf_cache; no embedding
API is used. Initial image/dependency/model downloads need Internet access. At runtime,
Groq is the sole cloud service; explicitly imported public knowledge URLs are fetched on demand.
See [AI configuration](docs/AI.md) for the current model choice and outbound-data boundary.

HTTP is for an isolated lab only. For secure embedding on an HTTPS customer website,
use the [local TLS procedure](docs/RUNBOOK.md#tls).

## Native Development

On an already configured Windows checkout, double-click **demarrer-supportdeflect.bat** in the
repository root. It detects Node 24+ and local Mailpit, applies migrations, starts API, ingestion,
frontend and mailer, reindexes stale embeddings from saved text and warms the AI model,
then opens the browser when the services are ready. Keep the terminal open;
Ctrl+C stops the services. Clicking again while the stack is healthy opens the existing application.
`demarrer-supportdeflect.bat --check` checks prerequisites without starting services. Optional
`SUPPORTDEFLECT_NODE` / `SUPPORTDEFLECT_MAILPIT` variables select custom executable paths.

Native SQLite is a real development database, not a substitute for the VM/PostgreSQL acceptance test.
Use Python 3.11+ and Node 24. Run commands from the indicated directories.
`backend/requirements-dev.txt` includes the runtime requirements plus test/lint tools;
the backend Docker image installs only `backend/requirements.txt`.

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install --index-url https://download.pytorch.org/whl/cpu torch==2.14.0+cpu
pip install -r backend/requirements-dev.txt
cp backend/.env.example backend/.env
# Set a random SECRET_KEY, GROQ_API_KEY and GROQ_MODEL in backend/.env.
cd backend
alembic upgrade head
python scripts/reindex_vectors.py --all
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

In separate terminals with the same virtual environment: run
`python scripts/run_ingestion_worker.py` from backend; run `npm ci`, then
`npm run dev -- --host 127.0.0.1 --port 5173` from frontend.
Windows activation is `.venv\Scripts\Activate.ps1`.
Vite proxies /api/v1 to DEV_API_URL (default http://127.0.0.1:8000).
Alternatively, run python scripts/run_native.py --mailpit PATH_TO_MAILPIT from the root virtual environment
to start API/worker/frontend/mailer/local mailbox together. It requires Node 24 (override with --node),
a strong MAILER_SERVICE_TOKEN in backend/.env and free loopback ports 8000/5173/1025/8025.
When no native Groq key is set, it inherits GROQ_API_KEY and GROQ_MODEL together from the root .env;
native database/settings remain separate. Explicit process Groq variables take precedence.
Restart the launcher after changing these variables: a running backend keeps its startup configuration.
Use --offline-embeddings after caching MiniLM. Ctrl+C stops its managed processes. Native mailbox is
loopback-only; the authenticated Compose mailbox is required for shared-network use.
The Compose route remains the canonical reproducible full-stack procedure.

RAG uses multilingual local embeddings, hybrid lexical/vector retrieval and server-verified
source passages. Existing CVs do not need re-uploading after the model upgrade.
See [AI operations](docs/AI.md) for reindexing, generation budgets and Groq rate limits.

## Main Workflows

1. Register an organization, upload a TXT/MD/PDF or import a public documentation URL.
2. Wait for indexed status; test a documented question in Playground.
3. Open Widget Design Studio; set allowed customer hostname(s), appearance and local logo.
4. Save, copy the generated snippet and insert it into an independent HTTP(S) page.
5. Ask a documented question, then an unsupported one; the second creates an Inbox case.
6. An agent resolves the case; the open visitor widget checks for the human reply every 15 seconds.
7. Super Admin manages organizations, periods, subscriptions, receipts/refunds and communication.

[Architecture and actor/flow guide](docs/ARCHITECTURE.md) explains permissions, data ownership,
metric definitions, lifecycle rules and the shared preview/production renderer.
Its Code Boundaries section maps HTTP adapters, administrative transactions, knowledge services,
shared API transport and dependency ownership to their actual source files.

French presentation guide: [Acteurs, fonctionnalites, logique et schemas](docs/GUIDE_FONCTIONNEL_FR.md).

## Verification and Acceptance

Phase 1 has local execution evidence. Phases 2 and 3 are implemented/prepared but remain open
until an actual Linux VM deployment/reboot/restore and a passing hosted CI run are observed.
The user confirmed on 2 October 2026 that the VM has not been created yet.

On the running Compose host, `python3 scripts/verify_stack.py` produces a sanitized runtime
report and a nonzero exit code if checks fail. See the [acceptance procedure](docs/RUNBOOK.md#executable-acceptance)
for explicit synthetic-data, down/up persistence and post-reboot checks. This is not a Groq test.

- [Commands and actual results](docs/TESTING.md)
- [16 October 2026 phase-1 presentation](README_SUIVI_PHASE_1.md)
- [13 October 2026 engineering review](docs/QUALITY_REPORT_2026-10-13.md)
- [Professor requirement -> implementation -> files -> proof](docs/PROFESSOR_REQUIREMENTS.md)
- [Audit findings and remaining acceptance gates](docs/AUDIT.md)
- [Installation, operation, backup, restore and presentation runbook](docs/RUNBOOK.md)
- [API](docs/API.md), [security](docs/SECURITY.md), [Super Admin](docs/SUPER_ADMIN.md)
- [Frontend visual reference and theme boundaries](docs/FRONTEND_DESIGN.md)

Tests use a fresh, isolated fixture database with explicit test-only LLM/embedding doubles.
The normal application rejects these doubles. Browser screenshots contain synthetic test
organizations, never claimed as real business activity. Real MiniLM has a separate executable check.
A passing simulated-LLM test does not prove a real Groq answer.

## Git Workflow and CI

Use a feature branch, review `git diff`, run the checks, commit a focused change, push and open
a pull request. Merge only after build/test CI passes. Never commit .env, databases, logs,
certificates or captured email. GitHub Actions runs backend, PostgreSQL, frontend, mailer,
browser/SMTP and image-build jobs on every push and pull request.
Deployment is a deliberate operator action in the runbook. No push, merge or remote CI execution
is implied by a local audit alone. The reviewed root layout was published on
`feature/supportdeflect-v2` on 16 October 2026, then integrated into `main` after the
six-job pipeline passed on `dc600a1`. The badge follows the principal branch's actual results.
Target-VM acceptance remains separate in the professor checklist.

The documentation presence gate runs from the repository root after frontend dependencies
are installed: `python scripts/check_documentation.py`. It checks Python docstrings, named
JS/TS contracts, supported file headers and per-file explanations; human review still checks accuracy.
