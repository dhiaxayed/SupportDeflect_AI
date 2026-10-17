# Verification Ledger

## Revue de publication du 17 octobre 2026

La revue couvre toutes les modifications en attente : présentation publique, formulaires,
sessions et changement de compte, tableaux de bord, classification des interactions,
confidentialité des URL sources, admission concurrente et maintenance du débit. Les frontières
Super Admin, Tenant Admin, Support Agent et visiteur restent celles de [l'architecture](ARCHITECTURE.md).
La migration **0008** est requise ; le service Compose de migration applique la tête avant
le démarrage de l'API et des workers. Aucune base utilisateur n'a été modifiée par cette revue.

TanStack Start passe à **1.169.3** et Router à **1.170.45**, avec le lockfile associé.
Cela retire les cinq alertes critiques de dépendances liées à
[GHSA-qx66-fv34-fjm8](https://github.com/advisories/GHSA-qx66-fv34-fjm8).
Le type officiel `ErrorComponentProps` accepte désormais une erreur `unknown` ; la frontière
racine utilise ce contrat sans exposer de détails dans son message visible.
La CI contrôle aussi l'égalité du moteur de démo et `npm audit --audit-level=high`.

Vérifications locales exécutées avec Node **24.21.0**, Python **3.13.3** et la `.venv` existante :

| Périmètre | Résultat |
|---|---|
| Backend `pytest -q --tb=short --cov=app --cov-report=term-missing` | **192 PASS**, 152,31 s, **92 %** de couverture mesurée ; rôles, isolation, invitations, quotas, migrations, analytics, confidentialité et concurrence inclus. |
| Ruff depuis `backend/`, puis scripts avec la configuration backend | **PASS** ; exécuter depuis les répertoires documentés pour conserver la classification des imports. |
| ESLint sans avertissement, `tsc --noEmit`, build client/SSR et smoke du serveur de production | **PASS**, livraison du moteur natif de démo et des polices locales incluse. |
| Vitest `--pool=threads --maxWorkers=1` | **65 PASS**, 9 fichiers, 42,36 s. |
| Playwright groupé avec Chrome et Mailpit, sans installation parallèle | **22 PASS**, 9 fichiers, 3,3 min ; public, rôles, deux espaces, SMTP, sessions inter-onglets et widget externe. |
| Mailer `node --test` et opérateur `unittest discover -s scripts/tests -v` | **8 PASS** et **12 PASS**. |
| Documentation des fichiers/contrats | **PASS** : 319 fichiers, 667 déclarations Python, 459 JS/TS, aucune entrée manquante. |
| `sync-marketing-widget.mjs --check` | **PASS** : copie publique identique octet par octet au widget de production inchangé. |
| Audits npm frontend et mailer | **0 vulnérabilité signalée** pour les deux arbres. Installation propre du lockfile vérifiée séparément avec npm 11. |
| `pip-audit` dans la `.venv`, puis `pip check` | Aucune vulnérabilité connue sur les paquets audités ; roue CPU `torch==2.14.0+cpu` absente de PyPI et explicitement **non auditée**. Aucune dépendance cassée. |
| MiniLM/Groq sur base jetable, `HF_HUB_OFFLINE=1 verify_local_knowledge.py --groq` | **PASS réel** : vecteurs 384D persistés, exclusion du locataire étranger, salutation et réponse sourcée HTTP 200 ; uniquement politique de livraison synthétique. |
| Syntaxe Git Bash des cinq scripts `.sh` | **PASS**. |
| PostgreSQL/pgvector local | **1 SKIP** : `TEST_POSTGRES_URL` absent. |
| Docker/Compose local et VM cible | **NON EXÉCUTÉS** : Docker indisponible sur cet hôte ; aucune publication Git n'est une preuve de déploiement. |

La première campagne navigateur groupée a passé 20 parcours et échoué sur les deux attentes
inter-onglets, pendant qu'une installation propre des dépendances tournait en parallèle.
Un diagnostic séparé a ensuite confirmé la réception de l'événement de stockage, le retrait
du contenu privé et la redirection immédiate. La campagne complète relancée seule a passé
**les 22 parcours ensemble en 3,3 minutes**, avec les assertions et délais d'origine ; les deux
parcours inter-onglets passent en 2,1 et 3,6 secondes. Le premier résultat n'est pas présenté
comme un succès et aucune cause d'application non reproduite n'est affirmée.
Les manques de commentaires/inventaire et l'incompatibilité de type détectés au premier
contrôle ont été corrigés avant la validation finale. npm 10 a échoué sur sa résolution
`edgesOut` ; npm 11 a résolu puis installé le même projet avec un audit sans vulnérabilité.

Les traces locales sont dans `logs/release-review/`, ignoré par Git. Les exécutions CI
postérieures doivent être consultées pour le SHA publié ; les succès historiques ci-dessous
ne remplacent jamais le résultat du nouveau commit.

## Instance native persistante du 17 octobre 2026

Le lancement réel a passé **21 contrôles** sur <http://localhost:5173> et l'API 8000,
avec les deux workers et Mailpit 8025 actifs. Une sauvegarde cohérente de la base locale
préexistante a précédé les migrations **0006 → 0008** ; intégrité SQLite `ok`, aucune
violation de clé étrangère, tous les identifiants de lignes préexistantes conservés.

Le scénario synthétique vérifie les connexions plateforme/entreprise et leurs restrictions,
les réglages et la politique Origin, l'import réellement traité par la file d'ingestion,
les vecteurs persistants 384D, les réponses Groq sourcées widget/Playground, la salutation,
les analytics visiteurs, l'escalade/résolution humaine et son retour au visiteur, une
nouvelle session lisant les documents persistés, ainsi que l'outbox livrée dans Mailpit.
Le premier contrôle des domaines supposait un ordre de liste : l'API renvoie correctement
un ensemble trié. Le contrôle a été corrigé pour comparer les domaines indépendamment de
l'ordre, puis les 21 contrôles ont passé ensemble.

Preuves privées générées : `logs/native-verification.json`, `logs/native-final-health.json`
et `logs/native-stack-state.json`. Les accès créés sont dans `data/local-access.json`,
ignoré par Git, et la sauvegarde dans `data/backups`. Le stockage local est SQLite/JSON,
dont la santé pgvector est signalée dégradée ; PostgreSQL et Docker restent non exécutés.
Cette exécution ajoute une preuve API/workers/stockage/IA réelle ; les parcours navigateur
restent ceux de la campagne ci-dessous.

## Audit fonctionnel et corrections du 16 octobre 2026

Le [rapport français en huit parties](AUDIT.md#audit-fonctionnel-local-du-16-octobre-2026)
décrit les corrections, leur cause, la matrice fonctionnelle, les fichiers et les limites.
Les URL privées sont préservées pour l'ingestion et filtrées à la sortie ; les statistiques
comptent les résultats explicites des visiteurs ; les sessions rejettent les opérations dépassées ;
le nettoyage des événements de débit est effectué hors admission par le worker existant.
La migration **0008** est requise. La campagne initiale ci-dessous n'a migré aucune base
native ; le démarrage ultérieur du 17 octobre l'a appliquée localement, comme décrit ci-dessus.
Aucune installation distante n'a été migrée.

Commandes de cette campagne, avec la `.venv` existante et Node **24.21.0** du cache local :

| Commande / périmètre | Résultat exécuté |
|---|---|
| `python -m pytest -q --tb=short --cov=app --cov-report=term-missing` (backend, final) | **PASS : 192**, **186,62 s**, couverture **92 %** (3590 instructions, 290 non couvertes) ; 8 tests analytics dédiés également passés |
| `ruff check .` (backend), puis `ruff check ../scripts --config pyproject.toml` | **PASS** |
| ESLint `--max-warnings=0`, `tsc --noEmit` (frontend) | **PASS** |
| `vitest run --pool=threads --maxWorkers=1` (frontend) | **PASS : 57 tests / 8 fichiers** |
| `vite build`, puis `node scripts/check-production.mjs` (frontend) | **PASS** sur les dernières sources : client/SSR, pages et polices locales, URL malformée |
| `playwright test` avec `MAILPIT_BINARY` (frontend) | **PASS : 13 parcours ensemble, 2,6 minutes** ; changement de compte inter-onglets inclus |
| `node --test` (mailer) | **PASS : 8** |
| `python -m unittest discover -s scripts/tests -v`, `pip check` (racine) | **PASS : 12**, dépendances cohérentes |
| Compose autonome `--env-file .env.example config --quiet`, HTTP puis overlay TLS | **PASS** ; configuration uniquement |
| Git Bash `-n` | **PASS : 5 scripts** |
| `python scripts/check_documentation.py --node NODE_24 --json` | **PASS : aucune entrée manquante** |
| `HF_HUB_OFFLINE=1 python scripts/verify_local_knowledge.py --groq` (backend) | **PASS réel** : MiniLM384, persistance/isolement, Groq salutation et réponse sourcée HTTP 200 |
| `python -m pytest integration -q -rs` (backend) | **SKIPPED : 1**, `TEST_POSTGRES_URL` absent |
| Docker Engine, stack conteneurisée, restauration réelle de volumes et VM cible | **NOT EXECUTED** : Engine non disponible ; les succès CI historiques ne valident pas cette révision locale |

Les premières exécutions ont réellement échoué : double import des fixtures (URL SQL héritée
différente), démarrage client Vite intermittent et une attente après remboursement. Le paquet
de tests est maintenant unique ; une régression protège l'URL héritée par les sous-processus.
Vite prépare les modules fréquents ; les diagnostics de démarrage excluent corps/en-têtes/requêtes.
Les assertions et délais existants sont conservés. Le préchargement a passé un parcours
administratif isolé puis la campagne complète, sur deux démarrages distincts ; la cause exacte
du rejet initial de module n'est pas établie. Le test de bornes BI a d'abord reproduit 1 contre 0,
puis passé après alignement des fins exclusives. Un warning amont Starlette/httpx demeure.

Le smoke Groq utilise seulement la politique synthétique « Shipping delivery takes three
working days ». Aucune livraison SMTP externe, donnée client ni publication n'est incluse.

## Phase-1 and documentation completion: 2026-10-16

The supplied bilingual roadmap was re-read against the current project. The French
[phase-1 follow-up README](../README_SUIVI_PHASE_1.md) maps all six application tasks,
actors, architecture/data model, flows and demonstrations. The
[documentation report](DOCUMENTATION_REVIEW_2026-10-16.md) closes the preceding comment pass;
[FILE_GUIDE_FR](FILE_GUIDE_FR.md) explains each maintained file. Groq remains an explicit
cloud exception; the VM and literal zero-cloud acceptance are not silently marked complete.

| Command and scope | Observed result |
|---|---|
| `python scripts/check_documentation.py --node NODE_24 --json` (root) | No missing required docs: 634 Python declarations, 405 JS/TS contracts; per-file inventory checked. |
| `python -m ruff check .` (backend) | Passed after wrapping six newly added overlong docstrings. |
| `python -m ruff check scripts --config backend/pyproject.toml` (root) | Passed. |
| `python -m pytest -q --tb=short` (backend, preceding 15 October comment pass) | **165 passed**, one upstream warning, **184.26 seconds**; app/test executable AST unchanged in completion review. |
| `node node_modules/eslint/bin/eslint.js . --max-warnings=0` and `tsc --noEmit` (frontend, comment pass) | Passed; zero ESLint warnings, typecheck passed. |
| `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1` (frontend) | **44 passed in 8 files, 76.26 seconds**. |
| `node node_modules/vite/bin/vite.js build` (frontend) | Client and SSR builds passed. |
| `node scripts/check-production.mjs` (frontend) | Production SSR landing/login, local font/MIME and malformed URL passed. |
| `node node_modules/@playwright/test/cli.js test` with `MAILPIT_BINARY` (frontend) | **12 passed in one grouped run, 2.6 minutes**; real local SMTP invitation/password replacement/confirmation included. |
| `node --test mailer/templates.test.mjs` (root) | **8 passed**, no skips/errors. |
| `python -m unittest discover -s scripts/tests -v` (root) | **12 passed**. |
| `python scripts/verify_local_knowledge.py --groq`, `HF_HUB_OFFLINE=1` (backend) | **Passed**: cached real MiniLM384, one persisted/reopened chunk, foreign-tenant exclusion, Groq model/greeting/sourced widget response HTTP 200. |
| `python -m pytest integration -q -rs` (backend) | **1 skipped**: TEST_POSTGRES_URL not configured. |
| Standalone Compose baseline/TLS `config --quiet`; Git Bash `-n` on five shell scripts | Passed during comment pass; configuration/syntax checks only. |

The initial resumed Vitest forks attempt executed 34 tests and failed to start the remaining
worker. It is an unsuccessful attempt, not a green suite. The final threads run executes all
44 unchanged tests, with a single worker for this Windows host. Production and browser tests
use cached Node 24.21.0. Python uses the existing 3.13.3 venv; CI/image target remains 3.11.

Real synthetic policy answer: “Shipping delivery takes three working days.” The two live
generation requests exercise greeting and cited knowledge separately; no private document
or credential is included in the evidence. Assertions verify a source and tenant exclusion,
not universal factual accuracy. Browser LLM/embedding fixtures remain explicitly test-only.

The pre-comment snapshot comparison found unchanged executable syntax in 91 Python and
100 JS/TS files and unchanged PostCSS rules in four stylesheets. Configuration values were
initially identical outside comments. The later phase-1 completion intentionally strengthens
private environment ignore patterns and adds the documentation/Ruff CI gates. No actual
backup/restore, target VM deployment or local Docker Engine execution was performed here.

Publication was verified on 16 October: local and remote SHA
`40b8b0316bf8f1cc19ea53e43afa1348cabef9e5` match on `feature/supportdeflect-v2`.
The [first hosted run](https://github.com/dhiaxayed/SupportDeflect_AI/actions/runs/38849007018)
was triggered by that push. Its backend job passed **165 tests in 56.05 seconds** with
**91% measured statement coverage** (3499 statements, 302 missed). Its separate real
PostgreSQL/pgvector test passed in **1.44 seconds**, including migrations, vector(384)/HNSW,
tenant-scoped cosine retrieval and distinct concurrent claims. This does not retroactively
turn the local PostgreSQL skip into a local pass. Frontend, mailer and browser jobs also
passed; the hosted browser run executed **12 passing journeys in 2.3 minutes**.
The containers job also **passed**: actual image build/startup, sole proxy ingress,
schema/authenticated routes, local SMTP, down/up comparisons, backup, restoration onto
fresh volumes and successful subsequent writes. All **six jobs** of the first run completed
successfully. Sanitized acceptance reports were uploaded as the compose-acceptance artifact.
This proves an ephemeral hosted Linux/Docker run, not student provisioning/reboot of the
target VM. The branch Actions page records subsequent documentation-commit runs independently.

The subsequent documentation commit `67dd2c5` passed five application/database jobs, but
its containers job failed twice in the down/up phase after successful registration, logo
and SMTP checks. The original sanitized message omitted the Docker operation. Follow-up
diagnostics now retain only fixed operation/reason labels and allowlisted container states,
error classes and categories; raw inspect/log output remains private. The operator suite
still passes all 12 tests, including secret-bearing output/argument redaction. The live
Actions result remains authoritative for this follow-up; the earlier green run is not
substituted for a failed later revision.

The instrumented revision `dc600a1` subsequently passed **all six groups** in
[run 38850991816](https://github.com/dhiaxayed/SupportDeflect_AI/actions/runs/38850991816),
including the unchanged down/up, full-restore and post-restore-write assertions. The earlier
Docker stderr was not retained, so its exact cause is not asserted. The new diagnostic
retains actionable safe context for future failures. The validated revision was then
integrated into `main` at the user's request; presentation badges and clone instructions
follow the principal branch. Its post-integration run is visible in the main Actions page.

## Resumed final review: 2026-10-15

The resumed review checked the current source and corrected stale quota-risk wording in
AUDIT.md. A later save timestamp on rag.py was investigated: its compiled instructions and
constants matched the earlier cached version, and independent source review found no semantic
change. The complete-suite/browser results below remain dated 13 October; they were not relabeled
as new runs.

- Backend `python -m pytest -q tests/test_chat_reasoning.py tests/test_rag_grounding.py tests/test_security_providers.py tests/test_documents_chat_widget_analytics.py --tb=short`: **53 passed**, one upstream warning, 35.93 seconds.
- Backend `python -m ruff check .`: **passed**.
- Local Markdown links in README and docs: **no missing targets**.

No behavioral source change or production operation was needed during this final resumption.

## Full project review: 2026-10-13

These results belong to the current root layout and this execution. Older dated sections below
remain historical. The initial baseline was backend 141 passing tests, operator 10 passing tests,
mailer 6 passing tests, and passing frontend lint/type/build. A new standalone engineering report
maps problems, files, workflow coverage and every Definition of Done status:
[QUALITY_REPORT_2026-10-13.md](QUALITY_REPORT_2026-10-13.md).

| Command (working directory) | Observed final result |
|---|---|
| `python -m pytest -q` (backend) | **165 passed**, one upstream Starlette test-client deprecation warning, 265.49 seconds |
| `python -m ruff check .` (backend) | **Passed** |
| `python -m ruff check scripts --config backend/pyproject.toml` (root) | **Passed** |
| `python -m pip check` (root virtual environment) | **No broken requirements** |
| `node node_modules/eslint/bin/eslint.js .` (frontend) | **Passed, zero errors/warnings** |
| `node node_modules/typescript/bin/tsc --noEmit` (frontend) | **Passed** |
| `node node_modules/vitest/vitest.mjs run --maxWorkers=1` (frontend) | **44 passed across 8 files**, 38.07 seconds |
| `node node_modules/vite/bin/vite.js build` (frontend) | **Client/SSR build passed**; informational plugin timing diagnostics |
| `node scripts/check-production.mjs` (frontend) | **Passed**: production SSR landing/login, local font/MIME, malformed URL |
| `node node_modules/@playwright/test/cli.js test` with MAILPIT_BINARY (frontend) | **12 passed in one final grouped run**, 8.0 minutes; real local SMTP included |
| `node --test` (mailer) | **8 passed** |
| `python -m unittest discover -s scripts/tests -v` (root) | **12 passed** |
| `npm audit --json` (frontend) | **Zero known findings** after targeted Seroval/source-map-js updates |
| `npm audit --omit=dev --json` (mailer) | **Zero known findings** |
| `python -m pip_audit -s osv --progress-spinner off --timeout 15` (root virtual environment) | **No known vulnerabilities found** |
| Standalone Compose 5.5.1 `--env-file .env.example config --quiet`, baseline and TLS overlay (root) | **Both passed**; configuration validation only |
| Git Bash `-n` on all five operational shell scripts | **Passed**; syntax only |
| `python -m pytest integration -q -rs` (backend) | **1 skipped**: TEST_POSTGRES_URL not configured; no PostgreSQL pass claimed |
| `python scripts/verify_local_knowledge.py --groq` with HF_HUB_OFFLINE=1 (backend) | **Passed**: real cached MiniLM384, persisted tenant-isolated retrieval, real Groq greeting and sourced widget answer |

Python uses the repository .venv (3.13.3). Frontend/mailer/browser commands use cached Node
24.21.0, not the host's default 23.8.0. Equivalent npm scripts are lint, typecheck, test:run and
build; --maxWorkers=1 is a host resource constraint, not a change to assertions or timeouts.
The initial default Vitest forks failed to start under load; the next serial baseline had three
5-second chat-test timeouts. Focused diagnostics passed unchanged, followed by the final complete
44-test run. Ruff must run from backend for its auto-discovered application/import root; operator
scripts are linted separately from the repository root with the backend configuration.

The initial pip-audit PyPI service failed on DNS resolution. The completed OSV-service retry
reported no known findings. The frontend baseline npm audit found Seroval critical/high and
source-map-js high advisories; the targeted update changed exactly two lockfile entries:
Seroval 1.5.4 -> 1.6.9 and source-map-js 1.2.1 -> 1.2.2. No direct dependency was added.

New regressions first reproduced ledger/account/quota/worker races, event-loop blocking, queued
title loss, stale-session/draft responses, corrupt gzip replacement, privileged mail redirects and
Uvicorn exception/access-log disclosure. Passing results are observed reruns after correction.
The logging checks instantiate actual Uvicorn handlers; SQLite concurrency uses separate real
sessions/threads. PostgreSQL lock intent is tested by actual ORM SQL compilation, not a live server.

The separate production worker/Mailpit acknowledgement check observed **one SMTP acceptance**,
**three identical result POST attempts** (two 503 responses followed by 200), and a subsequent
claim without resend. Its synthetic harness is ignored local evidence in
logs/verify-mailer-ack-2026-10-13.mjs. No production mailbox or user database was used.

Browser execution initially failed before every test because matching Chromium 1243 was absent.
`node node_modules/@playwright/test/cli.js install chromium --only-shell` installed the required
Chrome Headless Shell 153.0.8010.12. A subsequent grouped run passed 10/12; cold login hydration
and an interrupted navigation timed out in two scenarios. Live diagnostics found no browser or
network errors (10.981 seconds cold, 1.551 seconds warm). No E2E timeouts/assertions were relaxed.
The final stable-source browser run passed all 12 scenarios together. It used the isolated API
on 8020, frontend on 5175, independent widget host on 8055 and disposable SMTP/mailbox on
1030/8090. Both earlier failures passed with their original assertions/timeouts. No normal
database/mailbox was modified.

The separate final real-provider run completed successfully at 19:28 Africa/Lagos on 13 October
2026 (HTTP logs use UTC). It loaded cached multilingual MiniLM locally with HF_HUB_OFFLINE=1,
persisted one chunk across database reconnect, retrieved the synthetic shipping policy and
excluded a foreign organization. Groq models and both real chat calls returned HTTP 200 with
the configured openai/gpt-oss-20b model. The greeting had no sources/human escalation; the factual
widget answer was resolved with one source and correctly stated three working days. Only a
disposable synthetic policy/question went to Groq; the normal tenant database was not used.
This is live integration evidence for that test, not a universal grounding/reliability guarantee.

Audit date: 27 September 2026. Local host: Windows, Python 3.13, Node 24.21.
Frontend restoration and regression checks completed on 28 September 2026.
Administrative theme unification and widget identity regression checks completed on 1 October 2026.
Reference CI/container Python is 3.11 on Linux; local success does not replace that host test.

## Multilingual CV RAG Repair: 6-8 October 2026

The existing Forvia CV was genuinely indexed (seven chunks). An English encoder, a
pre-generation cosine threshold, absent conversation history and a company-only prompt
prevented useful French profile answers. The repair uses a local multilingual encoder,
hybrid BM25Plus/cosine ranking, header/neighbor context and server-owned evidence IDs.
Similarity is no longer a probability or a gate. No CV re-upload was needed.

| Command / scope | Actual result / evidence |
|---|---|
| `pip install rank-bm25==0.2.2`; `pip check` | Installed; no broken requirements |
| `alembic upgrade head` on preserved native DB | Upgraded to 0006 after SQLite backup; model identity column added |
| `python scripts/reindex_vectors.py --all` | Nine chunks re-embedded locally with the real 384-dimensional multilingual model; subsequent startup reports zero stale chunks; `logs/rag-reindex-2026-10-05.log` |
| `pytest -q` | 101 passed, one upstream Starlette/httpx deprecation warning; `logs/rag-backend-final-2026-10-06.log` |
| Frontend unit tests | 26 passed; history transport included; final recheck `logs/rag-frontend-final-2026-10-08.log` |
| Ruff, TypeScript, ESLint | Passed; final recheck `logs/rag-types-final-2026-10-08.log`, `logs/rag-eslint-final-2026-10-08.log` |
| `vite build` | Client and SSR production builds passed; `logs/rag-build-2026-10-06.log` |
| Chromium Playground + independent widget | Two complete scenarios passed, including profile import, sourced answer, follow-up history, mobile clarification and external snippet conversation; `logs/rag-browser-final-2026-10-06.log` |
| `docker compose config --quiet` | Passed with the updated model/budget environment; this is NOT a container runtime test |
| `python scripts/run_native.py --check` | Passed; native launcher starts services with auto-reindexing and embedding warmup |
| `pytest scripts/tests -q` | Ten tests and 31 subtests passed; `logs/rag-operations-2026-10-08.log` |
| Actual CV + Groq + native authenticated API | All four cases passed on 8 October; `logs/rag-cv-final-2026-10-08.log` |
| `python scripts/verify_local_knowledge.py --groq` | Real multilingual 384-dimensional model, persisted disposable DB, tenant isolation, actual Groq greeting and sourced widget answer; HTTP 200, resolved, one source; `logs/rag-real-widget-2026-10-08.log` |

Live CV acceptance used the configured `openai/gpt-oss-20b` with real local embeddings:

| Question | Actual outcome |
|---|---|
| `c est qui dhia ayed` | Resolved, three verified CV sources, retrieval score 0.16 |
| `quelles sont ses competences techniques ?` | Resolved with prior-turn history, five verified CV sources |
| `parle moi de cette entreprise` | Clarification needed, no invented Forvia facts or human escalation |
| `Quel est son numero de passeport ?` | Insufficient knowledge, no sources, no invented number |

All returned HTTP 200 with no provider error. Identity/skills answers were also compared
to the saved CV text. The short inter-request waits respect the actual account quota.

Browser tests use a disposable database and deterministic test-only providers. Their
desktop/mobile captures under `frontend/test-results/` were visually inspected; sources
are expandable and do not obscure answers. Separate live native API acceptance uses the
actual uploaded CV, real local embeddings and Groq, not browser fixtures.

Intermediate failed probes are retained as diagnostics, not counted as passing proof:
literal-quote generation was too brittle and was replaced by stable evidence IDs;
an actual Groq 429 showed free-account quota limits; cold loading timed out the first
question and was moved to startup; gpt-oss could truncate JSON before answering, so its
reasoning/output budgets became configurable; an unsupported answer's empty text was
incorrectly rejected and is now accepted only for abstention. Supported answers still
require nonempty text and valid evidence. SDK reasoning controls are tested through an
actual SDK HTTP transport, not a permissive mock method signature.
An interrupted recheck spanned the 6-8 October suspension: a test bearer token expired
and Vitest worker startup timed out. Those logs are not passing proof. Fresh authenticated
requests and a completed frontend run on 8 October produced the final results above;
application token lifetime was not extended to bypass the expiry.

No secret, bearer token or private CV body is stored in these acceptance logs. Native
probes log ordinary conversations and consume the existing question quota; they do not
fabricate documents, change a subscription or reset usage. Actual Linux/PostgreSQL/HNSW
execution and hosted CI remain separate acceptance gates, not inferred from SQLite tests.

## Groq / Playground Fix: 5 October 2026

The reported `helo` / 15% fallback was caused by the retrieval confidence gate, before any
Groq generation request. Forvia had one indexed document. The actual configured Groq credentials
passed the models endpoint (HTTP 200), and the configured model was available.

| Scope | Actual result / evidence |
|---|---|
| Complete backend suite | 80 passed; `logs/llm-backend-tests-2026-10-05.log` |
| Final focused backend suite | 31 passed; greetings, factual greeting prefixes, retrieval outages, provider error codes; `logs/llm-backend-focused-final-2026-10-05.log` |
| Frontend unit suite | 25 passed; greeting metadata and rate-limit diagnostics; `logs/llm-frontend-tests-final-2026-10-05.log` |
| Frontend production build | Client and SSR build passed; `logs/llm-build-final-2026-10-05.log` |
| Ruff, frontend ESLint, TypeScript | Passed; initial Prettier-only errors were corrected |
| Real Groq + local MiniLM/database | Actual greeting and sourced synthetic shipping answer, HTTP 200, no greeting escalation; `logs/llm-real-groq-final-2026-10-05.log` |
| Native Forvia API | Actual Groq replies to `helo` and `bonjour`, HTTP 200, `reason=greeting`, no human escalation; no tenant document bodies sent for this probe |
| Chromium Playground + external widget | Both passed in one run; `logs/llm-browser-verified-2026-10-05.log`; desktop/mobile screenshots under `frontend/test-results/` |

Browser fixtures deliberately use test-only providers; the separate real-Groq check uses only
synthetic policy data in a disposable database. The native check used the existing account and
logged two ordinary greeting messages; it did not change Forvia documents, settings or quotas.
Two earlier browser runs are not passing evidence: one overlapped a build and interrupted the
dev module load; another selected a deliberately over-quota BI fixture account. The final test
registers its own fresh isolated organization, preserves all assertions and passes.

Greetings have no retrieval-confidence badge or Sources panel. Unsupported factual questions
still require indexed knowledge and fall back honestly. Provider/retrieval outages no longer
masquerade as insufficient documentation. Root `.env` fallback preserves the Groq key/model pair;
changes to either variable require a backend restart.

## Architecture Refactor Recheck: 3-4 October 2026

The following results belong to the refactored source, not only to the earlier audit.
No public API, schema, theme or runtime-provider substitution was introduced for these checks.

| Command / scope | Status | Actual result |
|---|---|---|
| `pip install -r backend/requirements-dev.txt` | PASS | Runtime and development requirements installed; `pip check` reports no broken requirements |
| Frontend `npm ci --no-audit --no-fund` | PASS | 435 packages installed from the updated lockfile |
| Backend `ruff check .` and operator Ruff checks | PASS | No lint errors |
| Backend `python -m pytest --cov=app --cov-report=term-missing` | PASS | 63 tests, 89% coverage; `logs/refactor-backend-tests-2026-10-03.log` |
| Operator `python -m unittest discover -s scripts/tests -v` | PASS | 10 tests |
| Frontend `npm run lint` / `tsc --noEmit` | PASS | Zero lint errors or warnings; types pass |
| Frontend `vitest run` | PASS | 23 tests in three files; `logs/refactor-frontend-tests-final-2026-10-04.log` |
| Frontend `vite build` | PASS | Client and SSR builds; previous named-route-export warnings removed; `logs/refactor-build-final-2026-10-04.log` |
| `node scripts/check-production.mjs` | PASS | Production landing/login/local-font HTTP checks and malformed URL rejection |
| Mailer `node --test templates.test.mjs` | PASS | Four tests |
| Chromium `playwright test` | PASS | All eight scenarios in one 2.3-minute run; `logs/refactor-browser-final-2026-10-04.log` |
| Frontend `npm audit --audit-level=high` | PASS | Zero reported vulnerabilities; not a guarantee against undiscovered vulnerabilities |
| Standalone Compose baseline and TLS `config --quiet` | PASS | Configuration only, not a container runtime test |
| `HF_HUB_OFFLINE=1 python scripts/verify_local_knowledge.py --groq` | PASS | Real MiniLM384, persisted retrieval and tenant isolation; actual Groq models/chat and widget HTTP 200, resolved with one source; `logs/refactor-real-knowledge-2026-10-04.log` |
| Docker/VM runtime and hosted CI | NOT AVAILABLE | No Docker CLI/Desktop/Engine or provisioned VM; no source push/hosted run performed |

New regressions cover fixed-query-count ledger reads, malformed invitation retry, public ingestion
errors, failed inline URL state, successful queued retries, UTC normalization, safe traceback
formatting, CSV session expiry/body handling and request-local structured SSR errors.
Existing scenarios cover API authorization, tenant isolation, migrations, accounting, invitations,
saved widget design/logo, snippet integration, human replies and actual local SMTP capture.

Browser coverage includes administrative/customer views at 320/390/768/1024/1440px, the public
landing, initial password replacement and a separate framework-free HTML client with hostile CSS.
The final admin desktop and widget Studio mobile screenshots were also inspected visually.
Screenshots are under `frontend/test-results/`; they contain isolated synthetic fixture data.

Two intermediate failures are not counted as passing evidence: Windows initially locked the native
CSS module during npm ci while Vite was running, and the first browser run had a navigation interrupt
the administrative dialog measurement. Stopping the managed development stack allowed clean
installation. The complete browser rerun with stabilized source passed all eight scenarios without
weakening an assertion or increasing a timeout during this refactor.

The upstream Starlette/httpx test-client deprecation and npm deprecation notices for Recharts 2 /
whatwg-encoding remain dependency-maintenance items, not failing assertions. No speculative major
framework/chart-library migration was mixed into this compatibility-focused refactor.

The 4 October real-model check used configured `openai/gpt-oss-20b`, not a test double. It sent
only a disposable synthetic shipping policy; the sourced answer correctly reported three working
days. The native user database was not used for this model/ingestion test.

Final native restart on 5 October: landing and login at `http://127.0.0.1:5173` returned HTTP 200
with SupportDeflect branding; `/api/v1/auth/me` through Vite returned the expected HTTP 401 without
a token. Database readiness and the widget script on port 8000 and local mailbox on port 8025
returned HTTP 200. The ingestion worker started and the mailer claimed the outbox successfully.
Cold Vite startup initially refused connections before becoming ready; the successful probes were
made afterward. The native stack remains a development run, not VM/Compose acceptance evidence.

## Phase Readiness Recheck: 2-3 October 2026

The professor's supplied `(1).docx` roadmap was reviewed phase by phase. The following commands
were actually rerun on this Windows host; the older ledger below retains its original dates.

| Command / scope | Observed result |
|---|---|
| Backend `python -m pytest -q` | 52 passed; one upstream test-client deprecation warning |
| Backend `ruff check .` | Passed |
| Operator `python -m unittest discover -s scripts/tests -v` | 10 passed: origin validation, secret preservation, archive safety/ownership calls, container contract, private state, interruption guard, redaction, redirect refusal and actionable timeout |
| Ruff on changed operator scripts/tests | Passed using the backend lint configuration |
| `python -m pip check` | No broken requirements |
| Frontend `npm run lint` | Zero errors; six existing Fast Refresh export warnings |
| Frontend `npm run typecheck` | Passed |
| Frontend `npm run test:run` | 16 passed |
| Frontend `npm run build` | Passed; `logs/phase-build-2026-10-02.log` |
| `node scripts/check-production.mjs` | Production SSR landing/login, local font and malformed URL checks passed |
| Mailer `node --test templates.test.mjs` | 4 passed |
| Playwright Chromium with real local SMTP | Seven scenarios passed in the grouped run; widget reached its final screenshot but exceeded the original 90-second whole-test budget |
| Widget scenario after test stabilization | Passed in 58.4 seconds (1.7-minute run); 180-second whole-journey budget and animation-disabled captures, with all business assertions retained; `logs/phase-widget-retry-2026-10-02.log` (completed 3 October) |
| `HF_HUB_OFFLINE=1 python scripts/verify_local_knowledge.py --groq` | Real cached MiniLM384, persisted retrieval and tenant isolation passed; actual Groq models/chat HTTP 200; sourced widget answer resolved with one source, configured gpt-oss-20b |
| Standalone Compose baseline and TLS `config --quiet` | Both passed; eight resolved services and named mailbox volume inspected without exposing environment values |
| Git Bash `bash -n` for each operator shell script | Passed; syntax only |
| Native landing / DB readiness / widget script | HTTP 200 for all three |
| `python scripts/verify_stack.py --report logs/stack-local-2026-10-02.json` | Correctly FAILED with zero runtime checks: Docker absent; not counted as a successful deployment |
| Actual VM / container build, network, restart, reboot, restore | Not executed locally: user confirmed no VM yet; no Docker Engine/CLI or WSL distribution |
| Hosted CI | Not executed: reviewed source has not been committed/pushed by this agent |

The added API test executes the probe's registration, upload and saved/public design workflow
against the real test API/DB; only its SMTP transport is a double. It is not Docker/SMTP evidence.
On Windows, archive ownership system calls are checked by test doubles; actual Linux ownership
and post-restore writes must be demonstrated by the prepared container CI/VM scenario.

The eight browser scenarios therefore each have passing execution evidence, but this recheck is
not described as a single all-green grouped run. An intermediate widget retry also failed before
the test began because its isolated API startup exceeded 120 seconds; the next clean retry started
normally and passed. The targeted widget ESLint check subsequently passed. No application styling,
business assertions or provider safeguards were weakened to make the test pass.

CI now builds AND starts Compose, runs the same acceptance probe, verifies down/up persistence,
restores database/logos/mail onto empty disposable volumes and checks new writes afterward.
Artifacts explicitly include only sanitized report files, never private state, credentials or backups.
This workflow definition is tested locally; its hosted outcome remains unobserved.
The manual procedure is in [Executable Acceptance](RUNBOOK.md#executable-acceptance).

## Executed Results

| Check | Actual result |
|---|---|
| Python dependencies including real CPU ML stack | Installed; pip check: no broken requirements |
| Backend pytest | 51 passed; one upstream Starlette/httpx test-client deprecation warning |
| Backend Ruff | Passed |
| Frontend npm ci | Passed from lockfile |
| Frontend ESLint | Zero errors; six existing component-export Fast Refresh warnings |
| TypeScript tsc --noEmit | Passed |
| Vitest / React Testing Library | 16 passed, two files |
| Client and SSR production build | Passed |
| Production Node server smoke | SSR public landing and login 200, local WOFF2 font 200/correct MIME, malformed URL 400 |
| Final native-stack smoke | Login, database health and local mailbox HTTP 200; existing Super Admin active; Groq available and SMTP worker connected |
| Nodemailer node --test | Four passed |
| Playwright Chromium business suite | Four passed: administration, forced reset, actual local SMTP, external widget + human reply |
| Playwright Chromium public landing | Two passed: root remains public, official logo/local font load, demo controls and account links work, login/register forms hydrate, 320px/390px layouts fit |
| Playwright Chromium customer design | Passed: eleven routes at five widths (1440/1024/768/390/320), nonblank analytics bars, real document search, real support-case assignment and resolution |
| Final grouped Playwright run after design restoration | Seven passed in 2.6 minutes, including real local SMTP and external-host widget integration |
| October theme / widget identity Playwright run | Eight passed in 4.7 minutes; all previous workflows plus eight administrative views, organization detail tabs, modal and account security at five viewport widths |
| Real MiniLM + persistent DB retrieval | Passed, dimension 384, persisted chunk found after reconnect, foreign tenant excluded |
| Real Groq models check | HTTP 200; configured original Llama model absent from this account |
| Real widget API -> local retrieval -> Groq | HTTP 200, openai/gpt-oss-20b, resolved, one source; synthetic shipping-policy question |
| Local migrations | Disposable databases and preserved local DB upgraded to 0005 |
| Compose baseline and TLS overlay config | Both passed using official standalone Compose CLI |
| Bash operation scripts | bash -n passed for every script; this is syntax, not Docker runtime verification |
| npm audit, frontend and mailer | Zero reported vulnerabilities |
| pip-audit after ML dependency update | No known findings among audited packages; CPU PyTorch wheel skipped by package index |
| Upstream PyTorch 2.14.0 metadata | Published vulnerability list empty; not a full CPU-binary security certification |
| Docker image builds / real container network / restart / restore | NOT EXECUTED: Docker Engine unavailable |
| Linux VM acceptance | NOT EXECUTED: no configured VM/WSL distribution |
| Hosted GitHub Actions execution | NOT EXECUTED: no authorized source push was performed |

Initial lint/test failures were corrected and rerun. A failed earlier run is not counted as success.
The 1 October theme pass reran ESLint (zero errors, six existing warnings), TypeScript,
all 16 frontend unit tests, client/SSR build, production smoke and all eight browser scenarios.
The native stack was restarted afterward: public landing and updated widget script returned
HTTP 200, and the persisted database health check returned healthy.
Backend unit, real Groq and infrastructure results above belong to the earlier audit;
the visual change does not claim a new execution of those checks.
The administrative review caught duplicate active navigation, an accessible table label escaping
its mobile scroll container, and status tints that lost their intended hue. These were corrected.
Browser captures now disable animations and wait for the organization dialog to close before navigation.
The initial startup timeout and failed intermediate visual runs are superseded by the complete passing run.
The restored theme uses the original customer design reference and locally bundled Inter.
Visual checks caught compressed mobile team columns, a long-question grid overflow and a
pre-hydration demo click; these were corrected before the final passing run. Native restart
also confirmed public home HTTP 200, healthy database and the existing Forvia tenant login.
The first Groq check failed on the test client's untrusted hostname; the verification client now
uses an allowed localhost origin, and the real request subsequently passed.
The native platform health endpoint deliberately reports degraded pgvector capability because
this Windows run uses persisted SQLite JSON vectors. Database, ingestion and Groq checks are
healthy; this is not a claim that PostgreSQL/pgvector has been exercised locally.

## Backend Commands

From backend with the repository virtual environment active:

```bash
pip install --index-url https://download.pytorch.org/whl/cpu torch==2.14.0+cpu
pip install -r requirements-dev.txt
pip check
ruff check .
python -m pytest -q
python scripts/verify_local_knowledge.py
python scripts/verify_local_knowledge.py --groq
```

The Groq check reads the key from process/native configuration, with a root .env key fallback,
and sends only the temporary synthetic shipping policy. It does not print secrets.
Set HF_HUB_OFFLINE=1 once the model is cached to prove local embedding inference without
checking the model registry on every process start.
Unit tests explicitly set ENVIRONMENT=test and isolate fake embeddings/LLM in temporary data.
They cannot be used to claim real-model inference; the two real checks above supply that evidence.

## Email and Invitation Audit: 2026-10-08

The audit first reproduced four failures against the old implementation: accepting an expired
invitation with an existing JWT, rotating a password while SMTP was sending it, replaying a lost
delivery acknowledgement, and reactivating a pending member with obsolete credentials.
`logs/invitations-before-2026-10-08.log` records those failures on disposable fixtures.

| Verification | Actual result |
|---|---|
| Backend `python -m pytest -q` | 114 passed; one upstream Starlette test-client deprecation warning |
| Focused invitation/administration/team API tests | 35 passed |
| Frontend `vitest run` | 29 passed, including transport/expiry states and password-activation error paths |
| Mailer `node --test` after `npm ci` | 6 passed; MIME/logo, invalid credentials, empty recipient acceptance and ambiguous connection failure covered |
| Playwright `test e2e/mailing.spec.ts` | 1 passed with real Nodemailer/Mailpit SMTP and actual tenant/agent browser workflows |
| Backend Ruff, frontend ESLint and TypeScript | Passed |
| Frontend production build and `check-production.mjs` | Passed; SSR landing/login, local font and malformed URL checks |
| Restarted native stack | Database healthy; frontend/mailbox HTTP 200; tenant login and Team metadata verified; SMTP worker connected in local_capture mode |

The SMTP browser scenario creates the agent through Team, reads the captured invitation only
in memory, renews it through Team, rejects the former password, completes mandatory password
replacement in a separate agent browser session and opens the support Inbox. It also checks
old-JWT revocation, agent denial of administrator mail status, confirmation email and honest
local-capture status. Desktop/mobile Team screenshots contain fixture identities but no secrets.
Temporary SMTP ports are 1030/8090; the application/database are isolated from normal user data.

Additional backend regressions cover current-invitation binding, pending-role rotation, canceled
outbox secrets, corrupt ciphertext, recovery with offline SMTP, missing deadlines, replayed failed
acknowledgements, in-flight quota reservations and accepted-member reactivation without resetting
their personal password. No real Gmail/Forvia delivery is claimed. These SQLite tests also do not
constitute PostgreSQL row-lock/concurrency evidence; that requires the disposable integration
environment described below. Log files are local, ignored verification evidence, not secrets to
publish. The test database uses explicit AI doubles; this email audit makes no new real-LLM claim.

## Frontend and Mailer Commands

From frontend:

```bash
npm ci
npm run lint
npm run typecheck
npm run test:run
npm run build
node scripts/check-production.mjs
npm audit
npx playwright install chromium
# Set MAILPIT_BINARY to an installed local Mailpit executable.
npx playwright test
```

From mailer: npm ci, npm test, npm audit.

Playwright starts its own fresh fixture database/API on 8020, frontend on 5175 and separate HTML
client on 8055. It does not modify the user's normal database. SMTP verification additionally
uses loopback ports 1030/8090 and a temporary mailbox. E2E_PYTHON overrides Python discovery;
E2E_BROWSER_PATH can use an already installed Chromium. Without MAILPIT_BINARY the SMTP
test explicitly skips; a skip must not be reported as a passed SMTP check.

The browser test uploads and saves a custom local logo, changes dimensions/color/position/radius,
uses robot/default/custom identities, reloads, copies the exact generated snippet to another
server, survives hostile host CSS, sends actual API requests, inspects sources, checks mobile
bounds, creates an escalation and receives a human reply after reload without the private note.
Administrative tests exercise real SQL aggregates over clearly synthetic fixture records.
SMTP uses a real Nodemailer transport, validates the branded MIME result and logs in using the
password extracted in memory. The invitation/password is never attached to reports.

Sanitized screenshots are in docs/evidence after the browser runs, including the restored landing.
They demonstrate layout and test workflows, not actual customer revenue.

## PostgreSQL Integration and CI

```bash
# Supply a disposable database whose name ends in _test.
export TEST_POSTGRES_URL=postgresql+psycopg://USER:PASSWORD@HOST:5432/supportdeflect_test
cd backend
python -m pytest integration -q
```

This checks real pgvector schema/query behavior, tenant isolation and concurrent worker claims.
No PostgreSQL runtime was available locally; CI provisions pgvector/pgvector explicitly.
The default unit test command does not silently count a skipped PostgreSQL integration as passed.

The workflow at .github/workflows/ci.yml installs its prerequisites, builds/tests backend/frontend/
mailer, runs a PostgreSQL service and browser/SMTP tests, validates Compose and builds all
application images. It also starts the Compose stack, checks persistence and rehearses restoration
on disposable runner volumes. It has no deploy job. Its hosted result must be observed after publication.

## VM Acceptance

Use VM_SETUP.md and RUNBOOK.md. Collect actual ingress, service health, model/SMTP, persistence,
backup and restore evidence on the Linux VM. Compose config validation and local SQLite reconnect
are not equivalent to a Docker down/up persistence proof.
