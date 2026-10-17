# Final Repository Audit

## Revue avant publication du 17 octobre 2026

L'ensemble des modifications locales a été relu par responsabilité : public et authentification,
transport de session, espaces locataire/plateforme, analytics et données métier, URLs privées,
traitement des documents, débit et migration 0008. La présentation publique utilise désormais
une composition HTML lisible sans Three.js ; la démo réemploie exactement le moteur réel dans
une iframe opaque avec des réponses locales et sans API. Les trois rôles internes restent
contrôlés côté serveur ; un Super Admin n'obtient pas une appartenance implicite aux locataires.

La revue corrige les alertes critiques TanStack par des versions corrigées et adapte le type
de la frontière d'erreur racine au contrat courant. Les nouveaux modules et tests sont expliqués
dans l'inventaire français, et la CI vérifie la fidélité de la copie du widget et l'audit npm.
Les preuves, échecs initiaux et limites locales sont consignés dans [TESTING.md](TESTING.md),
sans transformer un PostgreSQL sauté, un Docker indisponible ou une VM non déployée en succès.

## Démarrage de la base native du 17 octobre 2026

À la demande de l'utilisateur, l'application existante a été démarrée sur
<http://localhost:5173>, avec API, worker d'ingestion, mailer et Mailpit
(<http://127.0.0.1:8025>). Les cinq processus sont actifs sous le superviseur natif.
Une sauvegarde SQLite cohérente et vérifiée a précédé les migrations **0006 → 0008**.
Les identifiants de toutes les lignes préexistantes des organisations, utilisateurs,
documents, vecteurs et jobs sont conservés. `PRAGMA quick_check` retourne `ok` et
`PRAGMA foreign_key_check` ne trouve aucune violation.

**21 contrôles ont passé sur cette instance persistante**, avec un nouvel espace de
démonstration isolé : connexion plateforme/entreprise, santé Groq réelle, worker SMTP local,
réglages persistants, politique Origin, escalade et réponse humaine jusqu'au visiteur,
import en file puis indexation par le worker, vecteurs persistants de dimension 384,
réponse Groq sourcée, salutation, Playground, compteurs visiteurs séparés, restrictions
de rôles, nouvelle connexion conservant les documents et courriel réellement capturé.
Seul le contenu synthétique de démonstration est utilisé pour ces questions IA.

Les accès de démonstration et plateforme sont conservés dans le fichier privé ignoré
`data/local-access.json`. Les preuves générées sont `logs/native-verification.json`,
`logs/native-final-health.json` et `logs/native-stack-state.json`. La sauvegarde est dans
`data/backups`. Aucun ancien compte n'a été promu ni son mot de passe remplacé.

Ce démarrage utilise **SQLite persistant**, conformément au mode natif local. Le statut
pgvector dégradé est attendu pour son stockage JSON ; PostgreSQL/Docker et la VM cible
restent hors de cette preuve. Les 13 parcours navigateur de la campagne précédente restent
la preuve UI : aucun nouveau parcours navigateur n'est revendiqué pour ce démarrage natif.

## Audit fonctionnel local du 16 octobre 2026

### 1. Synthèse

Les quatre corrections prioritaires sont implémentées : confidentialité des URL sources,
indicateurs métier, concurrence des sessions et admission en base. L'audit a également corrigé
les erreurs de validation qui renvoyaient les entrées privées, un double chargement des fixtures
de tests et les bornes temporelles contradictoires des graphiques métier.

Les parcours existants ont été inspectés dans les routes, services, modèles, workers et
consommateurs frontend. Les vérifications exécutées sont distinguées ci-dessous des composants
seulement inspectés. Aucun push, déploiement ou changement de données de production n'a été effectué.

### 2. Problèmes trouvés et corrigés

| Problème initial et cause | Correction et fichiers principaux | Régression et résultat |
|---|---|---|
| Les URL complètes étaient copiées dans les titres, vecteurs et citations, exposant les paramètres d'accès. | `core/source_urls.py`, `schemas.py`, `routers/documents.py`, `services/ingestion.py`, `rag.py`, `routers/platform.py` : l'ingestion conserve l'URL privée ; les métadonnées publiées gardent origine/chemin et identité du document. Les anciennes citations et les titres restent protégés à la sérialisation. Aucun changement de schéma URL. | 10 tests de confidentialité : paramètres encodés/casse variable/signatures, téléchargement intact, réponses document/chat/widget/dossier, anciennes métadonnées et journaux. PASS. |
| Playground et salutations gonflaient la résolution ; les booléens historiques ne distinguaient pas les pannes et clarifications. | `models.py`, migration `0008`, `rag.py`, `analytics.py`, `business.py`, `routers/platform.py` et écrans analytics : résultat explicite persisté, périmètre visiteurs commun, compteurs séparés, libellés « AI answer rate ». L'historique inconnu est séparé ; aucune déflexion confirmée n'est inventée. | 8 tests dédiés aux résultats et métriques, plus régressions existantes actualisées avec des résultats explicites. PASS. |
| Des réponses de connexion/inscription pouvaient s'imposer dans le désordre ; le contrôle ne protégeait pas les requêtes initialement anonymes. | `frontend/src/lib/api.ts` : dernière tentative commune, révision de session, contrôle des succès et erreurs réseau/décodage, rejet après logout/changement d'onglet et protection contre les 401 tardifs. `change-password.tsx` préserve un nouveau compte si la reconnexion automatique est dépassée. | Ordre des réponses contrôlé dans les tests API ; remplacement réel du cache de documents après changement de compte dans un autre onglet. PASS. |
| Chaque admission lançait un DELETE global des événements expirés. | `rate_limiter.py` : comptage indexé par clé/fenêtre sous verrou transactionnel ; `run_ingestion_worker.py` nettoie par lots de 1000 hors requêtes. Migration `0008` : index temporel. SQLite réserve son writer avant lecture ; PostgreSQL conserve ses verrous consultatifs. | 9 tests : limite, expiration exacte, SQL sans DELETE d'admission, clés communes/distinctes, trois processus réels, nettoyage borné et panne de commit. PASS sur SQLite. Concurrence PostgreSQL ajoutée, non exécutée localement. |
| Les erreurs Pydantic incluaient l'entrée brute ; les journaux ne couvraient pas toutes les URL encodées. | `main.py` conserve loc/type/msg sans input/ctx ; `core/logging.py` retire les requêtes des URL HTTP et des cibles d'accès Uvicorn. Les exceptions restent diagnostiquables sans leurs valeurs privées. | Régressions URL/mot de passe invalide et formats réels des journaux HTTP/Uvicorn. PASS. |
| `conftest.py` pouvait être importé sous deux identités et remplacer DATABASE_URL après création de l'engine. | `backend/tests/__init__.py` donne une identité unique au paquet ; le test multiprocessus vérifie que l'URL héritée est celle de l'engine. | Échec reproduit « no such table », puis 16 tests concernés passés ensemble et suite complète verte. |
| Graphiques et compteurs utilisaient des bornes différentes ; une inscription arrivée après l'instant du rapport apparaissait uniquement dans le graphique. | `business.py` utilise la même fin exclusive pour questions, encaissements et nouvelles organisations, y compris les classements d'usage. | Test à horloge contrôlée : échec initial 1 contre 0, puis égalité des séries et compteurs. PASS. |

Le démarrage Vite a aussi montré des échecs intermittents de chargement du module client avant
hydratation. `vite.config.ts` précharge le routeur et la connexion avec l'option
[warmup documentée par Vite](https://vite.dev/config/server-options#server-warmup).
Deux démarrages distincts avec cette configuration ont passé le parcours administratif, dont
la campagne finale de 13 parcours. Les diagnostics du test conservent uniquement chemins et
catégories d'échec des ressources, sans en-têtes, paramètres ou corps. Aucun délai ni assertion
n'a été assoupli. La cause exacte du premier rejet de module n'est pas établie ; cette mesure
ne constitue pas une preuve de stabilité universelle du serveur de développement.

### 3. Matrice de validation fonctionnelle

| Domaine | Vérifications réellement exécutées | Limite de la preuve |
|---|---|---|
| Authentification | API inscription/login/révocation, concurrence déterministe, logout et changements d'onglet en navigateur | Comptes de test uniquement |
| Utilisateurs et rôles | Permissions API, invitations, activation et remplacement de mot de passe en navigateur | Parcours maintenus, pas toutes les combinaisons possibles |
| Organisations et multi-tenancy | Isolation API/recherche, création, archivage/restauration et administration en navigateur | Bases de test uniquement |
| Ingestion documentaire | Fichiers, URL contrôlées, jobs/reprises/suppression/concurrence ; indexation MiniLM réelle | Pas de téléchargement d'un site tiers réel dans cette campagne |
| RAG | Régressions de preuves, clarification/pannes ; salutation et réponse sourcée Groq réelles | Documents synthétiques ; ne prouve pas la justesse de toute génération |
| Widget intégré | Snippet sur hôte indépendant, configuration, chat, escalade et réponse humaine | Fournisseurs simulés pour les parcours navigateur |
| Studio | Persistance, logo, aperçu partagé, options et rendu mobile/desktop | Fournisseurs simulés dans l'aperçu navigateur |
| Dossiers support | Permissions, assignation, notes, états, résolution et capacité visiteur | Parcours API/navigateur exécutés sur fixtures |
| Analytics | Résultats persistés, dénominateurs, historique inconnu, isolation, séries/périodes et écrans | Déflexion réelle non mesurée, valeur null explicite |
| Abonnements et facturation | Quotas/concurrence, expiration, périodes, paiements/remboursements et idempotence ; parcours UI | Registre manuel, aucun paiement externe exécuté |
| Mailing et notifications | Tests worker/templates et parcours SMTP Mailpit réel, invitation et confirmation | Acceptation SMTP locale, aucune livraison externe affirmée |
| Frontend | Types/lint/tests/build/SSR et 13 parcours, vues maintenues à plusieurs largeurs | Pas de certification WCAG exhaustive ; Browser intégré indisponible, captures Playwright inspectées |
| Infrastructure | Compose HTTP/TLS, syntaxe shell, readiness/migrations SQLite et tests d'exploitation/restauration isolés | Docker Engine et PostgreSQL/pgvector non exécutés localement |

### 4. Architecture et qualité

L'organisation existante routes → services → modèles/workers est conservée. Les règles de
périmètre analytique et de confidentialité des URL sont partagées ; login et inscription
utilisent une même séquence. L'entretien global des événements sort du chemin d'admission,
en réutilisant le worker existant. Aucun nouveau service, framework, fournisseur ou paquet
n'est ajouté. Les contrats historiques resolved/resolution_rate restent des alias documentés
des réponses IA sans escalade. Les quotas continuent à comptabiliser aussi le Playground,
car ils mesurent l'usage admis, distinct de l'activité support visiteurs.

Les composants fonctionnels, la séparation des rôles, le stockage vectoriel, l'outbox et les
transactions de facturation n'ont pas été réécrits. Aucune réorganisation cosmétique n'était
justifiée. La migration conserve les lignes historiques sans leur inventer un résultat.

### 5. Résultats des tests

Baseline : 165 tests backend et 44 tests frontend passés. Environnement local : Python 3.13.3,
Node 24.21.0 ; l'image/CI Python 3.11 n'a pas été exécutée ici.

| Contrôle | Statut observé |
|---|---|
| Pytest complet final avec couverture | PASS : 192 tests en 186,62 s, 92 % (3590 instructions, 290 non couvertes) |
| Analytics après correction de borne | PASS : 8 tests, dont la nouvelle régression |
| Ruff backend et scripts | PASS |
| ESLint sans warning et TypeScript | PASS |
| Vitest | PASS : 57 tests, 8 fichiers |
| Playwright final avec Mailpit | PASS : 13 parcours ensemble, 2,6 minutes |
| Build client/SSR et smoke serveur de production | PASS sur les dernières sources ; résultat consigné dans TESTING.md |
| Mailer Node | PASS : 8 tests |
| Exploitation Python | PASS : 12 tests ; pip check sans dépendance cassée |
| Compose HTTP/TLS et bash -n | PASS : configurations valides et 5 scripts analysés |
| Documentation | PASS : aucune entrée/contrat documenté manquant |
| MiniLM/Groq réels | PASS : dimension 384, persistance, isolement, salutation et réponse sourcée HTTP 200 |
| PostgreSQL/pgvector | SKIPPED : TEST_POSTGRES_URL absent |
| Démarrage Docker, restauration réelle de volumes et VM cible | NOT EXECUTED : Docker Engine non disponible dans cette session |

Les premières campagnes ont échoué sur le double chargement des fixtures et sur le démarrage
client Vite ; une autre tentative a dépassé le délai d'affichage après remboursement. Ces échecs
ne sont pas comptés comme succès. Le parcours de remboursement a ensuite passé avec les
assertions et délais d'origine. Un warning amont Starlette/httpx subsiste dans Pytest.

### 6. Fichiers changés

Créations : helper `core/source_urls.py`, migration `0008_outcomes_rate_cleanup.py`, paquet
`tests/__init__.py` et trois modules de régression (`test_source_privacy.py`,
`test_analytics_outcomes.py`, `test_rate_limiter.py`).

Modifications principales : schémas/modèles et routes document/platform/main ; services
ingestion/RAG/analytics/business/rate_limiter ; worker d'entretien et fixtures E2E ; client API,
reconnexion après mot de passe, écrans/graphes/statuts, configuration Vite et tests frontend.
API.md, SECURITY.md, FILE_GUIDE_FR.md et TESTING.md décrivent les contrats et preuves actuels.
Aucun fichier fonctionnel ni dépendance n'a été supprimé.

### 7. Limites restantes

La migration 0008 doit précéder le démarrage du code mis à jour dans un environnement existant.
La campagne initiale l'a testée sur des bases temporaires ; la demande de démarrage suivante
l'a appliquée à la base native sauvegardée, comme décrit dans la section du 17 octobre.
Le nettoyage périodique suppose un worker d'ingestion actif. L'URL complète demeure privée
en base pour l'ingestion ; une citation publique sans requête peut nécessiter un accès séparé
à une ressource dont l'identité dépend de paramètres. Aucun secret arbitraire présent dans le
corps d'un document ou dans un chemin URL n'est détecté par ce mécanisme.

Les nouveaux tests de concurrence PostgreSQL sont disponibles pour une base jetable *_test,
mais pas exécutés ici. Les preuves Docker/CI historiques ci-dessous ne valident pas cette
révision locale. L'acceptation TLS/backup/restore/redémarrage de la VM cible reste à exécuter.

### 8. Verdict

- Développement : utilisable après migration, avec preuves unitaires/API/UI et intégration IA réelle.
- Démonstration locale : fixtures puis instance native persistante validées avec scénario IA synthétique ; aucune donnée client requise.
- Staging : candidate à validation PostgreSQL/pgvector et Docker, puis aux vérifications sur l'hôte cible.
- Production : non certifiée par cette campagne locale ; les validations externes restantes ne sont pas des PASS.

## Historique antérieur à cette campagne locale

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
