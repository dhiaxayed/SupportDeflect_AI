# Guide de lecture technique et fonctionnel

Ce guide explique chaque fichier maintenu de SupportDeflect AI. Il complète les
commentaires placés dans les sources : les docstrings Python et commentaires
TypeScript/JavaScript décrivent les contrats, effets et limites près du code concerné.
Ils restent en anglais pour conserver une convention unique dans le dépôt ; les
explications transversales et l’inventaire ci-dessous sont en français.

## Présentation publique et validation associée

| Fichier | Responsabilité |
|---|---|
| `frontend/playwright.public.config.ts` | Vérification autonome des pages publiques, sans compte ni API ; peut viser le serveur de production construit. |
| `frontend/e2e/public-auth.spec.ts` | Inscription et connexion réelles sur une base jetable, erreurs de mot de passe et conservation des styles privés. |
| `frontend/public/demo/widget/script.js` | Copie exacte du moteur de widget de production ; seule la passerelle de réponses locales transforme cette instance en démonstration. |
| `frontend/scripts/sync-marketing-widget.mjs` | Copie le moteur officiel ou vérifie son égalité octet par octet, sans modifier le widget de production. |
| `frontend/src/components/marketing/auth-shell.tsx` | Habillage public commun de connexion et inscription ; les formulaires conservent leurs effets d'authentification. |
| `frontend/src/components/marketing/demo-data.ts` | Questions, réponses et sources synthétiques prédéfinies ; aucun document client ni appel IA. |
| `frontend/src/components/marketing/knowledge-visual.tsx` | Composition HTML document, passage surligné et réponse ; aucun canvas ou téléchargement WebGL. |
| `frontend/src/components/marketing/landing-experience.tsx` | Structure éditoriale de la landing, fonctionnalités vérifiées, exemples, limites et plans partagés. |
| `frontend/src/components/marketing/marketing-nav.tsx` | Logo officiel, ancres, état des sections et menu mobile avec fermeture clavier/focus. |
| `frontend/src/components/marketing/public-font.ts` | Préchargement de la police locale Instrument Sans limité aux routes publiques. |
| `frontend/src/components/marketing/public-motion.tsx` | Frontière Motion et typographie publique ; respecte la préférence de réduction des mouvements. |
| `frontend/src/components/marketing/use-landing-motion.ts` | Chorégraphie GSAP du hero et du parcours, ScrollTrigger sans blocage du défilement, nettoyage au démontage. |
| `frontend/src/test/public-auth.test.tsx` | Régressions des vrais gestionnaires de formulaires : trois rôles, changement obligatoire, cache et erreurs. |

## Comprendre le parcours métier

Un visiteur s’inscrit pour créer une organisation et son administrateur locataire.
Celui-ci importe des fichiers ou des URL publiques, attend leur indexation, teste
les réponses dans le Playground et installe le widget sur son site. Un agent de
support traite les dossiers remontés dans Inbox. Le super-administrateur gère les
organisations, conditions d’abonnement, événements financiers saisis manuellement,
campagnes et opérations. Il n’est pas automatiquement membre de chaque locataire.

Une importation suit le chemin route HTTP → validation/autorisation → document et
tâche persistés → worker d’ingestion → extraction/découpage → embeddings locaux →
stockage des passages et vecteurs. L’enregistrement d’un fichier ne signifie donc
pas que celui-ci est déjà interrogeable. Le worker utilise un bail et des tentatives
pour empêcher un ancien traitement de republier les résultats après suppression ou reprise.

Une question suit widget ou Playground → quota/autorisation → recherche limitée à
l’organisation → sélection de passages → génération Groq → réponse, sources et
résultat. Une salutation ou une demande de clarification a un sens différent d’une
réponse fondée sur un document. Le score de recherche mesure une similarité ; il
ne constitue pas une probabilité de vérité. Les passages sélectionnés, la question
et un historique borné peuvent quitter la machine vers Groq ; les embeddings et
la base restent locaux. Les URL publiques importées impliquent leur propre accès réseau.

Le widget public utilise un identifiant company public. Le JWT du personnel reste
dans l’application d’administration. La prévisualisation utilise le même moteur
que le snippet client ; le parent Studio traite les questions protégées et vérifie
l’origine/source des messages. Le suivi d’un dossier visiteur utilise une capacité
signée pour ce dossier, distincte du JWT du personnel. Une réponse humaine ultérieure
ne transforme pas rétroactivement le résultat IA initial dans les statistiques.

Les invitations/campagnes entrent dans une file de mails en base. Le worker SMTP
réclame un message, construit le contenu, envoie puis confirme le résultat avec un
jeton de réclamation. Un accusé réseau réessayé ne doit pas renvoyer le même mail
dans ce cycle. SMTP ne permet pas une garantie absolue « exactement une fois ».
Le mode par défaut capture les messages dans Mailpit ; « accepté SMTP » ne prouve
pas une arrivée dans une boîte externe.

## Lire le code dans un ordre utile

Ajouts de l'audit fonctionnel du 16 octobre 2026 :

| Fichier | Rôle |
|---|---|
| `backend/app/core/source_urls.py` | Sépare les URL privées d'ingestion des métadonnées publiques ; retire identifiants, requêtes et fragments des URL HTTP dans les réponses et journaux. |
| `backend/alembic/versions/0008_outcomes_rate_cleanup.py` | Ajoute le résultat explicite des interactions sans reclasser l'historique et l'index temporel du nettoyage de limitation de débit. |
| `backend/tests/test_source_privacy.py` | Vérifie ingestion des URL complètes et confidentialité des documents, citations, anciens dossiers, erreurs de validation et journaux. |
| `backend/tests/test_analytics_outcomes.py` | Vérifie les résultats RAG persistés et les mêmes définitions métier dans les indicateurs locataire et plateforme. |
| `backend/tests/test_rate_limiter.py` | Vérifie bornes temporelles, admission concurrente avec connexions/processus distincts, nettoyage borné et propagation des pannes SQL. |
| `backend/tests/__init__.py` | Donne une identité unique au paquet de tests ; évite une seconde initialisation de conftest et une URL de base héritée différente dans les sous-processus. |

1. Lire README puis GUIDE_FONCTIONNEL_FR pour les usages et rôles.
2. Ouvrir les routes React et leurs composants/hooks pour suivre les actions de l’écran.
3. Suivre les DTOs/helpers HTTP dans lib/api et lib/admin-api jusqu’aux routers FastAPI.
4. Lire les dépendances d’autorisation, schémas de validation et services métier appelés.
5. Consulter models/db et les migrations pour les contraintes persistées.
6. Vérifier dans les tests les scénarios d’erreur, de concurrence et les limites des fixtures.
7. Utiliser RUNBOOK/DEPLOYMENT pour les opérations ; ne pas confondre une commande documentée et une opération déjà exécutée.

Chaque docstring de fonction explique son objectif et, quand ils comptent pour
l’appelant, les entrées, résultat, autorisation attendue, erreurs, commit, accès
réseau/disque ou invariants de concurrence. Les commentaires de bloc expliquent
les étapes sensibles. Les petites fonctions anonymes de map, JSX, événements et
tests sont expliquées par le contrat du traitement qui les contient ; une répétition
ligne par ligne du langage rendrait les flux plus difficiles à lire.

## Vocabulaire et frontières

| Terme | Sens dans ce projet |
|---|---|
| API / route | Point HTTP qui reçoit une requête, authentifie/valide et appelle un service. |
| DTO / schéma | Structure échangée et validée ; ne remplace pas les règles métier/permissions. |
| ORM / migration | Mapping objets-tables SQLAlchemy / évolution versionnée du schéma Alembic. |
| Tenant / organisation | Périmètre d’isolation des utilisateurs, documents, questions et dossiers. |
| Embedding / chunk | Vecteur numérique d’un passage / morceau textuel indexé d’un document. |
| RAG / grounding | Recherche de passages avant génération / obligation d’appuyer la réponse sur ces preuves. |
| Cache / invalidation | Données UI réutilisées / suppression ou rafraîchissement après mutation ou changement de session. |
| Quota / réservation | Limite d’usage / prise atomique de capacité avant le traitement concurrent d’une question. |
| Bail / fencing | Droit temporaire de traiter une tâche / vérification qui refuse le résultat d’un ancien titulaire. |
| Outbox / claim | File persistée des emails / attribution temporaire d’un message à un worker. |
| Idempotence | Une répétition avec la même clé représente la même opération, notamment les événements du registre financier. |
| Unité mineure | Montant entier tel que des centimes ; les devises restent séparées, aucun paiement bancaire n’est exécuté. |
| SSR / hydratation | HTML produit par le serveur / activation des composants et événements dans le navigateur. |
| Shadow DOM / iframe | Isolation DOM du widget / cadre de prévisualisation relié au parent par un protocole contrôlé. |

## Périmètre des commentaires

Le contrôle porte sur les sources, tests, exemples de configuration, infrastructure
et documents maintenus, pas sur les dépendances ni les données d’exploitation.
Les JSON stricts et lockfiles gardent leur grammaire : leur explication se trouve
dans l’inventaire. tsconfig accepte JSONC et conserve ses commentaires valides.
Les PNG sont décrits ici. L’arbre de routes généré est documenté mais laissé à
TanStack. Les modèles Alembic conservent leurs instructions de génération.

Les vrais `.env`, variantes privées `.local`, certificats/clés, bases SQLite,
volumes `data/`, sauvegardes, journaux, heartbeats, caches, dépendances et bundles
ne sont pas lus par le contrôleur. Les anciens répertoires `learn-serve-main/`
et `supportdeflect-ai/` sont hors du dépôt actif réorganisé décrit par README.
Les captures représentent des données synthétiques ; leur ancienneté et leur
portée restent indiquées dans docs/evidence/README.

Depuis la racine, après installation des dépendances frontend :

```powershell
.venv/Scripts/python.exe scripts/check_documentation.py
```

L’option `--node CHEMIN` sélectionne un binaire Node compatible ; `--json` donne
les compteurs et manques au format machine. Ce contrôle vérifie la présence et
la syntaxe des explications, pas leur vérité. Une relecture et les validations
de code complètent ce signal, comme détaillé dans le rapport de documentation.

## Inventaire de chaque fichier

Les chemins sont relatifs à la racine du dépôt actif. Chaque ligne explique le
rôle du fichier et sa relation avec le reste du projet. Les détails de chaque
fonction restent à côté de sa définition pour éviter deux contrats contradictoires.

### Racine, CI et infrastructure

| Fichier | Rôle et compréhension |
|---|---|
| `.dockerignore` | Filtre le contexte Docker racine utilisé pour construire le mailer : métadonnées Git, environnements, dépendances locales, bases, données, sauvegardes et certificats sont exclus selon les motifs déclarés. Les dépendances sont réinstallées dans les images. Ce fichier ne supprime aucun fichier local et ne remplace pas les règles Git ni les permissions du système. |
| `.env.example` | Modèle public de l'environnement Compose, servant à générer le véritable .env ignoré. Il décrit les secrets indépendants, PostgreSQL, l'origine publique, Groq, le modèle local, les budgets de récupération et les limites en octets ou requêtes par minute. L'opérateur doit fournir de vraies valeurs ; le mode hors ligne suppose que le modèle existe déjà dans le volume hf_cache. |
| `.gitattributes` | Définit la normalisation Git des fichiers texte. Les scripts shell et Dockerfile utilisent LF, tandis que le lanceur Windows utilise CRLF. Ces attributs agissent sur les fins de ligne du dépôt et des extractions, sans modifier la configuration fonctionnelle de l'application ni convertir les fichiers binaires détectés comme tels. |
| `.github/workflows/ci.yml` | Exécute les contrôles lors des push et pull requests avec un accès GitHub en lecture : backend, intégration pgvector jetable, frontend, conteneurs/persistance/restauration, mailer et navigateur/SMTP local. Les versions Python/Node sont cohérentes avec les images et les rapports publiés sont explicitement limités aux artefacts prévus. Le nettoyage destructif concerne les volumes du runner jetable ; aucun job ne déploie vers une VM cible. |
| `.gitignore` | Écarte du suivi Git les secrets locaux, bases, données, certificats, sauvegardes, journaux, dépendances et artefacts générés. Les modèles d'environnement publics restent versionnables grâce aux exceptions explicites. Une règle d'exclusion ne retire pas un fichier déjà suivi et ne constitue pas un contrôle d'accès aux fichiers présents sur le disque. |
| `README.md` | Point d’entrée : architecture du dépôt, démarrage Docker/natif, prérequis, commandes et liens vers les guides spécialisés. |
| `README_SUIVI_PHASE_1.md` | Dossier français de présentation au professeur : auteurs, problème, solution, exigences phase 1, rôles, architecture, diagrammes, recette et preuves/limites. |
| `demarrer-supportdeflect.bat` | Point d'entrée Windows pour démarrer l'installation native depuis le répertoire du projet. Il exige le Python de .venv, transmet les options au lanceur run_native.py, demande l'ouverture du navigateur et renvoie un statut non nul en cas d'échec. Il ne crée pas l'environnement et n'installe pas les dépendances ; les erreurs restent visibles pour un lancement par double clic. |
| `docker-compose.tls.yml` | Complément HTTPS du fichier Compose principal, à sélectionner de manière cohérente pour toutes les commandes d'exploitation. Il remplace les arguments Traefik, ajoute le port 443, redirige HTTP et monte les routes TLS ainsi que les certificats en lecture seule. Il exige server.crt/server.key, une origine publique HTTPS et la confiance du certificat côté client ; il ne génère ni certificat ni compte auprès d'une autorité externe. |
| `docker-compose.yml` | Décrit les huit services de la pile Linux et leurs dépendances : Traefik, PostgreSQL/pgvector, migration, API, ingestion, mailer, Mailpit et interface SSR. Docker Engine, Compose, des secrets configurés et un premier téléchargement du modèle sont nécessaires. Seul Traefik publie un port ; les volumes conservent base, logos, messages et cache, et les migrations doivent réussir avant le démarrage des services applicatifs. |
| `infra/traefik/routes.yml` | Configure le routage HTTP par fichiers statiques vers l'API, l'interface et Mailpit, sans accès au socket Docker. Les priorités des préfixes API/mail précèdent la route frontend générale ; le chemin /mail est conservé pour Mailpit. Le corps des requêtes API est plafonné à 101 Mio avec seuil mémoire de 2 Mio, et les en-têtes communs ne remplacent ni authentification applicative ni TLS. |
| `infra/traefik/tls.yml` | Configure les routes HTTPS de websecure en réutilisant les services, priorités et middlewares HTTP. Les certificats sont lus depuis le montage privé en lecture seule et TLS 1.2 est la version minimale. Le complément Compose doit être activé, les fichiers doivent exister et le certificat doit être reconnu par les clients ; aucune autorité de certification externe n'est appelée par ce fichier. |

### Configuration, modèle de données et migrations backend

| Fichier | Rôle et compréhension |
|---|---|
| `backend/.dockerignore` | Filtre le contexte de construction propre au répertoire backend, indépendamment du .dockerignore racine. Il exclut les fichiers d'environnement, bases natives, journaux et outils/caches Python locaux selon sa liste. L'image construit son propre environnement Linux ; les fichiers exclus restent présents sur la machine de développement. |
| `backend/.env.example` | Modèle de développement natif à copier vers backend/.env, avec SQLite relatif au répertoire de travail du backend et origines Vite explicites. Il configure Groq, les embeddings locaux de dimension 384, l'ingestion, la récupération, les logos et les limites. Les secrets doivent être remplacés, le token doit correspondre au mailer et les migrations restent explicites ; cette configuration est distincte du .env racine de Compose. |
| `backend/.env.production.example` | Référence publique pour un processus backend natif en production ; le chemin Compose canonique utilise plutôt l'environnement racine. Elle exige PostgreSQL accessible, secrets privés, vrai fournisseur Groq, hôtes autorisés et proxy effectivement approuvé. Debug, documentation interactive et création implicite du schéma sont désactivés ; les noms réseau d'exemple doivent correspondre au déploiement réel et les migrations précèdent le service. |
| `backend/Dockerfile` | Construit l'image Python 3.11 commune à l'API, aux migrations et au consommateur d'ingestion. Une étape de compilation installe le venv, PyTorch CPU et les dépendances de production ; l'image finale conserve les sources nécessaires et utilise un compte sans privilèges root. Les poids du modèle sont initialisés dans le cache persistant à l'exécution, et EXPOSE 8000 ne publie aucun port hôte à lui seul. |
| `backend/alembic.ini` | Localise les révisions Alembic relativement au fichier INI et ajoute le répertoire de travail aux imports Python. env.py choisit l'URL explicite Alembic ou la configuration effective de l'application. Les commandes sont normalement lancées depuis backend pour conserver des imports et chemins SQLite cohérents ; ce fichier n'effectue aucune migration par sa seule présence. |
| `backend/alembic/env.py` | Relie les métadonnées SQLAlchemy et l’URL effective aux migrations Alembic en ligne/hors ligne ; ne crée pas silencieusement un schéma de production. |
| `backend/alembic/script.py.mako` | Modèle de génération des futures révisions : métadonnées, upgrade et downgrade documentés ; conserver les substitutions Mako pour Alembic. |
| `backend/alembic/versions/0001_baseline.py` | Schéma initial versionné des organisations, comptes, connaissances, conversations et vecteurs ; point de départ des bases neuves. |
| `backend/alembic/versions/0002_roles_cases_audit.py` | Ajoute les rôles, le suivi humain et l’audit ; fait évoluer les données existantes vers les contrats multi-rôles. |
| `backend/alembic/versions/0003_pgvector.py` | Active le stockage/index vectoriel natif PostgreSQL ; conserve la voie SQLite de développement sans prétendre y installer pgvector. |
| `backend/alembic/versions/0004_administration_billing_mail.py` | Ajoute administration commerciale, registre financier et état durable des communications/invitations ; migrations distinctes des services métier. |
| `backend/alembic/versions/0005_widget_design.py` | Persiste la configuration versionnée du design widget afin de partager les réglages entre Studio, API et moteur client. |
| `backend/alembic/versions/0006_embedding_identity.py` | Ajoute l’identité du modèle d’embedding ; les anciens vecteurs doivent être réindexés avant comparaison avec le modèle courant. |
| `backend/alembic/versions/0007_question_reservations.py` | Ajoute les réservations persistées de quota pour compter aussi les questions concurrentes encore en traitement. |
| `backend/app/__init__.py` | Déclare le paquet applicatif ; le montage FastAPI et les effets de démarrage restent dans main plutôt que dans cet import. |
| `backend/app/admin_schemas.py` | DTOs Pydantic plateforme : organisations, conditions commerciales, encaissements/remboursements et mail interne ; services responsables des invariants transactionnels. |
| `backend/app/core/__init__.py` | Déclare le paquet transversal configuration, temps et journaux sans démarrer de service à l’import. |
| `backend/app/core/config.py` | Charge et valide les variables d’environnement, origines, secrets et paramètres IA ; refuse notamment les fournisseurs factices hors environnement de test. |
| `backend/app/core/datetime.py` | Normalise les dates UTC entre SQLAlchemy, SQLite et PostgreSQL ; évite les comparaisons entre dates naïves et dates avec fuseau. |
| `backend/app/core/logging.py` | Journalisation locale UTC avec filtrage des données sensibles et traitement sûr des exceptions/handlers Uvicorn ; conserve types et emplacements utiles. |
| `backend/app/db.py` | Définit moteur SQLAlchemy, sessions et base ORM ; les requêtes possèdent leur session et Alembic gère l’évolution du schéma. |
| `backend/app/deps.py` | Résout JWT, compte courant, rôle, organisation et restrictions de première connexion ; autorisation appliquée côté serveur à chaque requête protégée. |
| `backend/app/main.py` | Assemble FastAPI, middleware, routes, santé et cycle de vie ; prépare les embeddings réels et les protections d’exécution avant disponibilité. |
| `backend/app/models.py` | Contrats persistés SQLAlchemy : entités, clés, contraintes, relations et index des organisations, support, quotas, registre et outbox. |
| `backend/app/schemas.py` | Schémas API communs : entrées nettoyées, historique borné et sorties contrôlées pour auth, documents, chat, support et configuration. |
| `backend/app/security.py` | Hachage/vérification BCrypt, signature/décodage JWT et identité secrète ; les rôles et révocations sont ensuite confrontés au compte réel. |
| `backend/app/widget_cors.py` | Politique CORS spécifique au widget multi-sites : contrôle les origines approuvées sans ouvrir les endpoints privés à tous les sites. |
| `backend/app/widget_design.py` | Contrat versionné des réglages et migrations/defaults du widget ; bornes de géométrie, couleurs, identité et assets communs au Studio et au rendu. |
| `backend/pyproject.toml` | Centralise les options pytest et Ruff, sans installer de paquet. La collecte normale vise tests, l'intégration PostgreSQL est invoquée séparément et les fixtures asynchrones utilisent une boucle par fonction. Ruff cible Python 3.11, contrôle les erreurs, imports et constructions risquées, et autorise explicitement les appels déclaratifs Depends/Query/File dans les valeurs par défaut FastAPI. |
| `backend/requirements-dev.txt` | Étend les dépendances de production par inclusion relative et ajoute pytest, l'exécution asynchrone, la couverture, Ruff et PyYAML. Il sert au développement et à la CI ; l'image de production installe uniquement requirements.txt. Les outils mesurent les contrôles exécutés localement et ne constituent pas une preuve d'exploitation des conteneurs ou de la VM. |
| `backend/requirements.txt` | Versions épinglées des dépendances de production : HTTP/ASGI, persistance/migrations, authentification, embeddings locaux/récupération, Groq et extraction de documents/images. PyTorch CPU est installé séparément comme indiqué par Docker/CI ; les poids du modèle ne sont pas fournis par cette liste. Toute modification de version appelle une vérification de compatibilité et un nouvel audit, sans garantir à elle seule la sécurité du déploiement. |

### Routes HTTP backend

| Fichier | Rôle et compréhension |
|---|---|
| `backend/app/routers/__init__.py` | Paquet des adaptateurs HTTP ; l’assemblage explicite des routers se trouve dans main. |
| `backend/app/routers/analytics.py` | Expose les statistiques de l’organisation autorisée sans agréger les données d’un autre locataire. |
| `backend/app/routers/auth.py` | Inscription, connexion, compte courant et remplacement de mot de passe ; prépare les sessions et applique les règles d’invitation/révocation. |
| `backend/app/routers/billing.py` | Endpoints plateforme du registre manuel : filtres, paiements enregistrés et remboursements liés/idempotents ; aucune transaction bancaire exécutée. |
| `backend/app/routers/chat.py` | Chat protégé du Playground : validation, autorisation et orchestration RAG sans création de dossier visiteur. |
| `backend/app/routers/documents.py` | Liste/import fichier ou URL/suppression des connaissances du locataire ; réserve les quotas et persiste le travail asynchrone. |
| `backend/app/routers/mail.py` | Communications plateforme et API privée des workers : audience revue, campagnes, état et accusés de claims distincts des JWT utilisateurs. |
| `backend/app/routers/platform.py` | Administration inter-organisations, tableaux BI, audit, santé et reprises explicites ; accès super_admin et services spécialisés. |
| `backend/app/routers/settings.py` | Paramètres locataires, design, logo et intégration ; valide les données et délègue la gestion des assets locaux. |
| `backend/app/routers/support_cases.py` | Dossiers Inbox : filtres, affectation, notes et transitions avec réponse humaine ; contrôle du rôle et de l’organisation. |
| `backend/app/routers/team.py` | Comptes et invitations de l’équipe ; sépare autorisation locataire, rotation des identifiants temporaires et état de livraison. |
| `backend/app/routers/widget.py` | Configuration/script/widget public, questions et suivi de dossier ; vérifie origine, organisation, quotas et capacités visiteur sans exposer de JWT administrateur. |

### Services métier et IA

| Fichier | Rôle et compréhension |
|---|---|
| `backend/app/services/__init__.py` | Paquet des services métier/IA ; les opérations restent explicites dans chaque module plutôt qu’exécutées lors de l’import. |
| `backend/app/services/accounts.py` | Prépare les créations d’identités et résout proprement les courses d’unicité email avec rollback ; empêche une session SQL invalide de masquer le conflit. |
| `backend/app/services/analytics.py` | Calcule les indicateurs de conversation et d’usage d’un locataire ; résultat IA initial séparé des réponses humaines ultérieures. |
| `backend/app/services/audit.py` | Prépare les événements d’audit bornés et non secrets dans la transaction métier ; conserve auteur, action, périmètre et ressource. |
| `backend/app/services/billing.py` | Registre append-only en unités mineures et devise unique : idempotence, plafond des remboursements et sérialisation des écritures concurrentes. |
| `backend/app/services/business.py` | Agrégats BI plateforme, séries et fenêtres de comparaison ; distingue engagement commercial, recettes constatées et usage sans mélanger les devises. |
| `backend/app/services/domain.py` | Valide et normalise l’origine navigateur contre les domaines autorisés du widget ; liste vide refusée, sous-domaines délimités et limites distinctes de l’authentification visiteur. |
| `backend/app/services/embeddings.py` | Charge le modèle multilingue local et produit les vecteurs normalisés ; vérifie dimension/identité, avec faux fournisseur uniquement pour tests explicites. |
| `backend/app/services/ingestion.py` | Extraction PDF/TXT/Markdown/HTML, validation URL publique et découpage ; construit l’index sous bail valide et refuse de republier un document supprimé. |
| `backend/app/services/ingestion_jobs.py` | Admission durable document+tâche, claim atomique, heartbeat/reprise et publication clôturée par tentative/horodatage de bail ; évite les doublons de workers. |
| `backend/app/services/invitations.py` | Préparation transactionnelle du mot de passe temporaire, expiration, version de compte et outbox chiffrée ; annule les invitations devenues obsolètes. |
| `backend/app/services/llm.py` | Adaptateur Groq et doubles de test isolés : timeouts, sorties JSON et codes d’erreur assainis ; aucun succès fictif en cas de panne réelle. |
| `backend/app/services/mailing.py` | File de mails persistée : chiffrement, événements, audience, quotas, claims/baux et accusés rejouables ; l’envoi SMTP physique appartient au worker Node. |
| `backend/app/services/organizations.py` | Création et évolution des organisations : conditions/périodes, archivage réversible, invitations, audit et mails cohérents dans les transactions. |
| `backend/app/services/rag.py` | Orchestre conversation, recherche, contexte, génération et validation des citations ; distingue clarification, connaissance absente et panne fournisseur avant de journaliser le résultat. |
| `backend/app/services/rate_limiter.py` | Comptabilisation partagée des requêtes pour limiter les abus ; utilise la base et complète les quotas commerciaux sans être une authentification. |
| `backend/app/services/retrieval.py` | Fusion des classements dense et lexical, expansion des voisins/en-têtes et contexte borné ; l’historique ne devient pas une preuve factuelle. |
| `backend/app/services/subscriptions.py` | Droits/plans, état effectif et réservations atomiques document/chunk/question ; libère ou consomme la capacité sans maintenir un verrou pendant l’appel IA. |
| `backend/app/services/vector_store.py` | Stockage/recherche de passages cloisonnés par organisation et modèle ; pgvector/HNSW en PostgreSQL et cosinus JSON persistant sous SQLite. |
| `backend/app/services/visitor_access.py` | Capacités signées de sept jours liées à une organisation et un dossier ; audience distincte des sessions du personnel. |
| `backend/app/services/widget_assets.py` | Vérifie/décode les images locales, borne taille/pixels, réencode sans métadonnées et contrôle l’appartenance avant association au design. |

### Commandes et tests backend

| Fichier | Rôle et compréhension |
|---|---|
| `backend/integration/test_pgvector.py` | Intégration PostgreSQL/pgvector réellement exécutée seulement si TEST_POSTGRES_URL pointe vers une base de test ; skip explicite autrement, aucune simulation de succès. |
| `backend/scripts/create_super_admin.py` | Bootstrap opérateur interactif d’un nouveau super-administrateur ; ne promeut ni ne réinitialise silencieusement un compte existant. |
| `backend/scripts/init_db.py` | Point d’entrée historique d’initialisation contrôlée de la base ; la procédure normale de schéma reste alembic upgrade head. |
| `backend/scripts/inspect_db.py` | Inspection SQL du schéma PostgreSQL pour opérateur ; outil spécifique à ce dialecte, pas une commande portable SQLite. |
| `backend/scripts/prune_widget_assets.py` | Repère et nettoie les assets widget locaux orphelins selon les références persistées ; lire les options avant une opération de suppression. |
| `backend/scripts/reembed_vector_chunks.py` | Outil historique de recalcul des vecteurs qui ne renseigne pas l’identité embedding_model ; préférer reindex_vectors pour le parcours actuel. |
| `backend/scripts/reindex_vectors.py` | Réindexe par lots les textes déjà persistés vers le modèle courant avec identité et contrôle des conflits ; pas besoin de renvoyer les fichiers ni d’appeler Groq. |
| `backend/scripts/run_ingestion_worker.py` | Lance le consommateur durable d’ingestion avec les paramètres backend ; le processus supervise ses tâches et publie sa disponibilité. |
| `backend/scripts/seed_admin_e2e.py` | Comptes/données synthétiques de la recette navigateur ; garde explicite d’environnement isolé, jamais bootstrap normal d’une base client. |
| `backend/scripts/smoke_http.py` | Probe HTTP pour fixture loopback v2_smoke explicitement isolée ; ne constitue pas une preuve de fonctionnement Groq ou pgvector réel. |
| `backend/scripts/verify_local_knowledge.py` | Crée une base jetable migrée, indexe une politique synthétique avec MiniLM réel puis vérifie persistance et exclusion inter-locataires ; option --groq pour génération/widget réels. |
| `backend/tests/conftest.py` | Fixtures API/SQL isolées et fournisseurs IA de test déterministes ; remplace les ressources du test sans ouvrir la base native de l’utilisateur. |
| `backend/tests/test_account_creation_concurrency.py` | Courses concurrentes sur l’email global : résultat déterministe et rollback propre pour création publique, plateforme et équipe. |
| `backend/tests/test_administration.py` | Contrats plateforme et autorisations : organisations, conditions, registre, remboursements/idempotence et coût borné des requêtes de liste. |
| `backend/tests/test_auth.py` | Inscription, login, erreurs et jetons ; interdit les promotions de rôle et les accès non autorisés au-delà du contrat public. |
| `backend/tests/test_billing_concurrency.py` | Sessions réellement concurrentes du registre : empêche sur-remboursement et doublons malgré les clés/requêtes simultanées. |
| `backend/tests/test_chat_reasoning.py` | Comportements du chat avec sorties fournisseur contrôlées : salutations, faits, historique, clarification, risques et pannes distincts. |
| `backend/tests/test_configuration_operations.py` | Validation de configuration et contrats d’exploitation : fournisseurs de test refusés hors test et protections de déploiement attendues. |
| `backend/tests/test_datetime.py` | Sens UTC conservé entre dates naïves/avec fuseau et dialectes ; évite les décisions erronées sur expirations ou baux. |
| `backend/tests/test_documents_chat_widget_analytics.py` | Intégration API connaissances→chat/widget→analytics et isolement des locataires, avec contrats publics/protégés vérifiés. |
| `backend/tests/test_ingestion.py` | Extraction, découpage et ingestion de contenus synthétiques ; erreurs de formats/URLs et publication des passages recherchables. |
| `backend/tests/test_ingestion_concurrency.py` | Workers/sessions concurrents réels : claim unique, quotas, fencing, suppression/reprise et non-blocage des routes pendant traitements lourds. |
| `backend/tests/test_logging.py` | Confidentialité des journaux applicatifs et handlers Uvicorn réels ; chaînes sensibles synthétiques, UTC et restitution de configuration après chaque fixture. |
| `backend/tests/test_migrations_jobs.py` | Évolution Alembic et cycle durable des tâches, reprises/échecs et conservation des invariants persistés. |
| `backend/tests/test_product_consistency.py` | Régressions transversales : états affichés/persistés, suppressions et traitements IA concurrents sans réapparition de données obsolètes. |
| `backend/tests/test_rag_grounding.py` | Citations/identifiants contrôlés côté serveur, contexte non fiable et réponses insuffisamment étayées ; ne prouve pas une exactitude sémantique parfaite. |
| `backend/tests/test_security_providers.py` | Frontières de confiance/fournisseurs : validation des destinations, réponses malformées/pannes et absence de fuite de secrets ou d’accès inter-locataires. |
| `backend/tests/test_stack_acceptance.py` | Contrat statique/sécurité des outils de recette infrastructure ; vérifie les garde-fous sans faire passer des mocks pour une VM réellement déployée. |
| `backend/tests/test_team_invitations.py` | Cycle invitation-compte-mail : expiration/version, renouvellement, mot de passe obligatoire, révocation, ciphertext invalide et claims/accusés. |
| `backend/tests/test_v2_workflows.py` | Parcours API multi-rôles : support humain, administration et communications avec droits/transactions cohérents. |
| `backend/tests/test_widget_design.py` | Persistance complète du design, différences public/protégé et traitement sûr des logos locaux ; confirme que le moteur charge la configuration enregistrée. |

### Frontend : configuration et infrastructure

| Fichier | Rôle et compréhension |
|---|---|
| `frontend/.dockerignore` | Écarte dépendances locales, sorties de build et configuration privée du contexte de construction frontend. |
| `frontend/.env.example` | Exemple de configuration publique frontend/proxy de développement ; toute variable VITE exposée au navigateur doit rester non secrète. |
| `frontend/.gitignore` | Exclusions Git propres au frontend : dépendances, sorties et fichiers de développement générés. |
| `frontend/.prettierignore` | Limite le formatage aux sources maintenues et laisse les lockfiles, dépendances et enregistrement des routes à leurs générateurs. |
| `frontend/.prettierrc` | JSON strict de présentation : largeur, guillemets et points-virgules ; appliqué par Prettier/ESLint, sans effet métier. |
| `frontend/Dockerfile` | Construction Node du client/SSR puis image d’exécution ; dépendances et bundles sont produits pendant le build, paramètres privés fournis seulement à l’exécution. |
| `frontend/bunfig.toml` | Configuration Bun des tâches frontend ; explique la compatibilité des commandes du projet, sans rendre Bun obligatoire pour les validations npm/Node. |
| `frontend/components.json` | JSON du générateur shadcn : style, CSS et alias des composants/utilitaires ; sert à générer les primitives, pas à configurer les droits utilisateur. |
| `frontend/eslint.config.js` | Analyse TypeScript, règles des hooks React, frontières Fast Refresh et formatage ; écarte les sorties générées et les imports server-only incompatibles. |
| `frontend/package-lock.json` | Résolutions et intégrités npm exactes de l’interface ; npm ci les applique, npm les met à jour. Ne pas ajouter de prose dans ce JSON généré. |
| `frontend/package.json` | Manifeste npm : scripts dev/build/typecheck/lint/tests, dépendances et versions attendues ; JSON strict documenté ici plutôt que commenté dans sa grammaire. |
| `frontend/playwright.config.ts` | Orchestre navigateur, Vite et API jetable ; exécution séquentielle car les parcours modifient les mêmes organisations synthétiques. |
| `frontend/scripts/check-production.mjs` | Démarre puis ferme un serveur de production temporaire et vérifie SSR, police locale/MIME et URL malformée ; contrôle le chemin de build réel. |
| `frontend/server.mjs` | Serveur HTTP Node de production : fichiers confinés dans dist/client et adaptation Fetch vers le handler SSR ; métadonnées proxy acceptées seulement depuis l’adresse de confiance. |
| `frontend/tsconfig.json` | Configuration TypeScript en JSONC commenté : contrôle strict sans émission, DOM/ES2022, résolution bundler et alias @ vers src ; Vite produit les bundles. |
| `frontend/vite.config.ts` | Compose TanStack SSR/file routes, React et Tailwind ; les appels /api sont relayés vers DEV_API_URL pendant le développement. |
| `frontend/vitest.config.ts` | Tests composants/unitaires sous jsdom avec transformations React, alias de production et nettoyage commun des états de test. |

### Frontend : sources partagées et composants

| Fichier | Rôle et compréhension |
|---|---|
| `frontend/src/admin.css` | Présentation des vues plateforme : navigation, tableaux, formulaires, indicateurs et adaptation aux petits écrans. |
| `frontend/src/assets/official-icon.png` | Icône binaire locale empaquetée avec l’interface pour l’identité produit ; distincte des logos personnalisés téléversés par un locataire. |
| `frontend/src/assets/official-logo.png` | Logo binaire officiel importé par BrandLogo ; rendu local pour marketing, connexion et espaces authentifiés. |
| `frontend/src/components/admin-ui.tsx` | Primitives de présentation plateforme : filtres, cartes, dialogues et états ; reçoivent valeurs/actions et laissent les règles métier aux vues/services. |
| `frontend/src/components/app-sidebar.tsx` | Navigation locataire adaptée au rôle et à la route ; affiche l’usage réel sans remplacer les vérifications d’autorisation du backend. |
| `frontend/src/components/brand-logo.tsx` | Affiche le logo local avec texte alternatif et variantes de mise en page ; centralise l’identité produit. |
| `frontend/src/components/chat-playground.tsx` | Conversation protégée de test : question/historique local borné, preuves, clarification/pannes et rafraîchissement usage/analytics après réponse. |
| `frontend/src/components/dashboard-header.tsx` | En-tête locataire : identité, déconnexion et navigation vers la recherche documentaire ; reçoit titre et actions de chaque page. |
| `frontend/src/components/empty-state.tsx` | Explique une liste vide et expose l’action fournie par la vue ; ne fabrique pas de données pour remplir l’écran. |
| `frontend/src/components/marketing-widget-preview.tsx` | Conversation illustrative de la vitrine, explicitement statique ; ouverture après hydratation et lien vers inscription. |
| `frontend/src/components/metric-card.tsx` | Carte de métrique locataire : formatage des tendances et explications fournies par la page, sans calcul métier autonome. |
| `frontend/src/components/organization-directory.tsx` | Annuaire plateforme partagé avec les abonnements : filtres/pagination serveur, comptes archivés, création puis ouverture de la fiche réelle. |
| `frontend/src/components/organization-picker.tsx` | Sélecteur d’organisation pour formulaires plateforme ; recherche différée côté serveur et sélection contrôlée par le formulaire parent. |
| `frontend/src/components/platform-overview.tsx` | Tableaux BI métier/usage à partir des agrégats serveur ; sépare devises, revenu contractuel récurrent et encaissements enregistrés. |
| `frontend/src/components/query-state.tsx` | Présentation accessible des chargements/erreurs React Query ; les données et actions de récupération restent dans la vue métier. |
| `frontend/src/components/role-guard.tsx` | Masque le contenu privé pendant résolution de session/redirection ; consulte /auth/me et propose de réessayer une panne récupérable. |
| `frontend/src/components/status-badge.tsx` | Associe libellé/icône/couleur aux états ingestion/chat ; distingue clarification, résolution IA et besoin de suivi humain. |
| `frontend/src/components/subscription-usage.tsx` | Affiche abonnement, dates et compteurs/limites réels ; n’autorise pas le locataire à modifier son propre plan commercial. |
| `frontend/src/components/team-management.tsx` | Gestion des membres/invitations : sépare compte actif, invitation et livraison du mail ; invalide le cache partagé avec les assignations Inbox. |
| `frontend/src/components/ui/alert.tsx` | Alertes neutres/destructives avec classes communes et ref DOM ; la vue fournit message et action de récupération. |
| `frontend/src/components/ui/avatar.tsx` | Wrappers Radix Avatar : image/fallback, dimensions et refs ; Radix coordonne le chargement de l’image. |
| `frontend/src/components/ui/badge.tsx` | Étiquette de statut/métadonnée avec variantes de présentation ; le domaine appelant donne le sens du statut. |
| `frontend/src/components/ui/button.tsx` | Bouton natif et variantes communes ; Radix Slot permet un lien stylé sans imbrication invalide de boutons. |
| `frontend/src/components/ui/card.tsx` | Blocs HTML de cartes avec attributs/refs transmis ; la vue compose titres, données et actions. |
| `frontend/src/components/ui/dialog.tsx` | Dialogues Radix avec portail, focus, fermeture et relations ARIA ; wrappers chargés de la présentation commune. |
| `frontend/src/components/ui/dropdown-menu.tsx` | Menus Radix : focus/clavier, portails, cases/radios et indicateurs ; permissions et actions fournies par le composant métier. |
| `frontend/src/components/ui/input.tsx` | Champ natif une ligne avec ref et styles ; type, valeur, contrainte, label et autocomplete sont choisis par le formulaire. |
| `frontend/src/components/ui/label.tsx` | Label Radix avec association htmlFor et typographie commune ; le formulaire fournit l’identifiant du champ. |
| `frontend/src/components/ui/progress.tsx` | Barre Radix de progression/usage ; représente la valeur fournie sans gérer elle-même le traitement en arrière-plan. |
| `frontend/src/components/ui/select.tsx` | Select Radix : trigger, popup bornée, défilement et choix ; conserve contrôle clavier et état du composant de base. |
| `frontend/src/components/ui/sonner.tsx` | Hôte unique des notifications Sonner monté à la racine ; les mutations déclenchent leurs messages séparément. |
| `frontend/src/components/ui/table.tsx` | Tableaux HTML sémantiques avec refs et conteneur de défilement horizontal pour les petits écrans. |
| `frontend/src/components/ui/textarea.tsx` | Zone de texte native multiligne commune pour notes/réponses ; validation métier et label restent dans la vue. |
| `frontend/src/components/upload-zone.tsx` | Sélection et envoi multipart séquentiel ; conserve uniquement les fichiers non acceptés pour reprendre un lot partiellement échoué sans doublons. |
| `frontend/src/components/widget-preview.tsx` | Pont iframe Studio vers le moteur widget réel : configuration et questions corrélées à origine/source exactes, JWT administrateur conservé dans le parent. |
| `frontend/src/hooks/use-auth.tsx` | Abonnements React aux changements de jeton et à /auth/me ; attend l’hydratation, fait suivre le compte serveur et invalide les états de session. |
| `frontend/src/hooks/use-data.ts` | Hooks React Query locataires : clés communes, chargement après authentification, polling seulement quand un traitement asynchrone le nécessite. |
| `frontend/src/hooks/use-hydrated.ts` | Distingue rendu serveur et navigateur après attachement des événements ; évite d’activer un formulaire avant que ses actions soient prêtes. |
| `frontend/src/landing.css` | Styles de la vitrine publique et de ses sections ; indépendants des données authentifiées du tableau de bord. |
| `frontend/src/lib/admin-api.ts` | Contrats plateforme et helpers BI/facturation/campagnes ; montants en unités mineures entières, clés d’idempotence et audience revue avant envoi. |
| `frontend/src/lib/api.ts` | Frontière HTTP/session et DTOs : jetons, notifications inter-onglets, erreurs structurées et rejet des réponses arrivant après un changement de compte. |
| `frontend/src/lib/error-page.ts` | Document HTML statique de secours sans dépendance React/CSS ; permet la récupération même quand le rendu SSR échoue. |
| `frontend/src/lib/request-id.ts` | UUID cryptographiques utilisés pour les opérations idempotentes ; fallback getRandomValues pour le laboratoire HTTP quand randomUUID manque. |
| `frontend/src/lib/subscription-plans.ts` | Descriptions publiques des plans et quotas, partagées entre vitrine et abonnement ; les droits effectifs et les tarifs contractuels restent côté serveur. |
| `frontend/src/lib/utils.ts` | Fusion des classes conditionnelles et résolution des conflits Tailwind ; utilitaire de présentation sans effet sur les autorisations. |
| `frontend/src/lib/widget-design.ts` | Contrat versionné/defaults du design widget ; normalise les anciennes configurations pour Studio et moteur partagé, avec validation serveur complémentaire. |
| `frontend/src/routeTree.gen.ts` | Registre TanStack généré depuis les noms des fichiers de routes par le plugin Vite ; ne pas le commenter ou le modifier à la main. Son en-tête indique son générateur. |
| `frontend/src/router.tsx` | Fabrique un routeur et un QueryClient propres à chaque contexte SSR/client ; relie l’arbre généré et évite le partage global des caches locataires. |
| `frontend/src/server.ts` | Adaptateur SSR : charge le handler TanStack et remplace seulement les pannes catastrophiques reconnues par une page de secours sans fuite d’état entre requêtes. |
| `frontend/src/start.ts` | Middleware serveur TanStack : conserve les erreurs HTTP normales et convertit les exceptions inattendues en réponse de secours sans détail privé côté client. |
| `frontend/src/styles.css` | Fondations visuelles partagées : Tailwind, polices locales, variables de thème et styles communs aux pages. |
| `frontend/src/widget-studio.css` | Disposition et contrôles du Studio : panneau de réglages/prévisualisation et comportement responsive du formulaire. |

### Frontend : routes et tests

| Fichier | Rôle et compréhension |
|---|---|
| `frontend/e2e/admin-design.spec.ts` | Parcours visuels plateforme desktop/mobile : navigation, dialogues, cohérence du thème, dépassements et erreurs navigateur. |
| `frontend/e2e/administration.spec.ts` | Parcours réel API/UI : organisations, périodes, encaissement/remboursement, campagne revue et premier mot de passe invité sous contexte HTTP. |
| `frontend/e2e/client.html` | Hôte client indépendant utilisé par les tests d’installation du snippet ; styles volontairement agressifs pour vérifier l’isolation Shadow DOM. |
| `frontend/e2e/customer-design.spec.ts` | Vérifie toutes les vues locataires à plusieurs largeurs avec données synthétiques et dossier humain réel ; captures représentatives. |
| `frontend/e2e/landing.spec.ts` | Vitrine responsive, marque/police locales et liens ; vérifie que la conversation marketing est présentée comme illustrative. |
| `frontend/e2e/mailing.spec.ts` | SMTP local réel Mailpit + worker : invitation, livraison capturée, mot de passe remplacé et confirmation ; skip explicite si binaire absent. |
| `frontend/e2e/playground.spec.ts` | Conversation via API/UI réelles avec IA de test : salutation, absence de connaissance, import, historique et clarification. |
| `frontend/e2e/session.spec.ts` | Expiration et déconnexion inter-onglets, suppression du contenu privé et reprise d’une panne /auth/me sans déconnexion injustifiée. |
| `frontend/e2e/start-api.mjs` | Infrastructure jetable du navigateur : SQLite/assets neufs, comptes synthétiques et IA factice explicite ; lance aussi un site client au CSS hostile et nettoie les enfants. |
| `frontend/e2e/widget.spec.ts` | Studio/moteur/site client réels : paramètres persistés, logo, snippets, sources, historique, réponses humaines, notes privées et saisie IME. |
| `frontend/src/routes/README.md` | Conventions de routes TanStack et liens vers les contrats produit ; les noms des fichiers déterminent l’arbre généré. |
| `frontend/src/routes/__root.tsx` | Document racine, styles/polices/providers, erreurs et QueryClient ; nettoie les données privées sur déconnexion ou changement de compte. |
| `frontend/src/routes/change-password.tsx` | Remplacement du mot de passe, obligatoire si invité ; révocation des anciennes sessions puis nouvelle authentification ou retour à la connexion. |
| `frontend/src/routes/dashboard.analytics.tsx` | Graphiques locataires et questions récentes ; distingue similarité de recherche, résultat IA et réponse humaine ultérieure. |
| `frontend/src/routes/dashboard.billing.tsx` | Route d’abonnement qui compose la vue SubscriptionUsage ; les conditions commerciales sont modifiées uniquement dans la plateforme. |
| `frontend/src/routes/dashboard.documents.tsx` | Inventaire/recherche des connaissances, filtres et suppression ; synchronise les caches liés après mutation et suit l’ingestion par polling. |
| `frontend/src/routes/dashboard.inbox.tsx` | Suivi humain : dossiers, affectations, notes privées et réponses publiques ; conserve les brouillons et respecte les transitions de statut serveur. |
| `frontend/src/routes/dashboard.index.tsx` | Synthèse des analytics et documents réels, états d’ingestion et activités récentes à partir des hooks partagés. |
| `frontend/src/routes/dashboard.playground.tsx` | Cadre de page du ChatPlayground protégé ; le composant partagé gère historique, preuves et mutations. |
| `frontend/src/routes/dashboard.settings.tsx` | Identité et intégration en lecture seule, liens Studio/mot de passe ; distingue identifiant company public et jeton de session privé. |
| `frontend/src/routes/dashboard.sources.tsx` | Import d’URL publique via validation/fetch backend ; affiche les états réels du document et de son indexation. |
| `frontend/src/routes/dashboard.team.tsx` | Route qui réutilise TeamManagement sous la garde administrateur, sans dupliquer les règles d’invitation. |
| `frontend/src/routes/dashboard.tsx` | Coquille locataire et garde des routes ; Inbox accessible aux agents, autres destinations réservées à l’administrateur locataire. |
| `frontend/src/routes/dashboard.upload.tsx` | Page de sélection de fichiers qui réutilise UploadZone ; progression d’ingestion suivie ensuite dans Documents. |
| `frontend/src/routes/dashboard.widget.tsx` | Studio : brouillon, sauvegarde, upload de logo local et prévisualisation réelle ; conserve les éditions récentes pendant les retours asynchrones. |
| `frontend/src/routes/index.tsx` | Vitrine publique : identité, plans et exemple de widget, liens inscription/connexion ; ne charge pas les données des locataires. |
| `frontend/src/routes/login.tsx` | Connexion après hydratation : session neuve puis destination choisie selon le rôle ou le changement obligatoire de mot de passe. |
| `frontend/src/routes/platform.audit.tsx` | Journal de changements en lecture seule : filtres/pagination serveur, auteur/périmètre/ressource et dates UTC. |
| `frontend/src/routes/platform.billing.tsx` | Registre manuel d’encaissements/remboursements avec devises séparées, unités mineures entières et UUID conservé lors des tentatives répétées. |
| `frontend/src/routes/platform.communications.tsx` | Campagnes avec audience revue, historique de livraison et automations ; changement optimiste des interrupteurs avec rollback sur échec. |
| `frontend/src/routes/platform.health.tsx` | Santé dépendances/SMTP, files ingestion et reprises explicites ; observe les workers sans promettre une livraison en boîte externe. |
| `frontend/src/routes/platform.index.tsx` | Route de synthèse métier qui réutilise PlatformOverview et ses filtres/agrégats serveur. |
| `frontend/src/routes/platform.organizations.$id.tsx` | Fiche organisation : conditions, périodes, archivage réversible, renouvellement d’invitation et audit filtré après rechargement des données serveur. |
| `frontend/src/routes/platform.organizations.index.tsx` | Route annuaire qui délègue recherche, filtres, pagination et création à OrganizationDirectory. |
| `frontend/src/routes/platform.subscriptions.tsx` | Mode abonnement de l’annuaire partagé ; colonnes commerciales et filtres d’échéance sans deuxième source de données. |
| `frontend/src/routes/platform.tsx` | Coquille plateforme pour super_admin : navigation, identité et déconnexion ; ce rôle est distinct de l’appartenance à un locataire. |
| `frontend/src/routes/platform.usage.tsx` | Vue usage du même composant BI, sans recalculer des statistiques dans une seconde implémentation. |
| `frontend/src/routes/register.tsx` | Inscription d’une organisation et de son premier administrateur locataire avec essai ; ne crée jamais un super-administrateur. |
| `frontend/src/test/api.test.ts` | Régressions transport/session avec réponses synthétiques : quotas, courses de jetons, exports et configuration widget ; aucun backend réel requis. |
| `frontend/src/test/chat-playground.test.tsx` | Contrats du Playground : saisie accessible, validation, historique borné, preuves, salutations et pannes distinctes. |
| `frontend/src/test/invitation-password.test.tsx` | Distingue changement refusé et changement réussi suivi d’une reconnexion échouée ; vérifie le parcours obligatoire des invités. |
| `frontend/src/test/product-consistency.test.tsx` | Courses UI : brouillons Inbox pendant polling, affectations, notes, reprise partielle des uploads et sélection répétée d’un fichier. |
| `frontend/src/test/request-id.test.ts` | Vérifie UUID natif/fallback cryptographique sous HTTP, format/version et unicité ; refuse implicitement un remplacement par Math.random. |
| `frontend/src/test/server.test.ts` | Adaptateur SSR avec entrée TanStack contrôlée : secours sur panne catastrophique, erreurs JSON normales préservées. |
| `frontend/src/test/setup.ts` | Isolation Vitest : matchers DOM, démontage après chaque test, stockage navigateur vidé et globals restaurés. |
| `frontend/src/test/ui.test.tsx` | Contrats des vues locataire/plateforme avec données contrôlées : gardes, support, équipe, fiche commerciale et métriques API. |
| `frontend/src/test/widget-studio.test.tsx` | Promesses upload/save différées : vérifie conservation des éditions récentes et déverrouillage des contrôles après échec. |

### Widget et emails

| Fichier | Rôle et compréhension |
|---|---|
| `backend/app/static/official-icon.png` | Icône locale servie par le backend pour l’identité officielle du widget ; ne contient ni configuration locataire ni code exécutable. |
| `backend/app/static/widget.js` | Moteur commun du widget public et de la prévisualisation Studio : Shadow DOM, rendu textuel sûr, historique en mémoire, origine du parent vérifiée et suivi humain par capacité signée. |
| `mailer/.env.example` | Exemple natif Mailpit : URL interne, jeton partagé privé, hôte/port SMTP et expéditeur ; capture locale sans identifiants Gmail. |
| `mailer/Dockerfile` | Image Node non privilégiée du worker ; installe les dépendances verrouillées et copie le logo local requis par les modèles MIME. |
| `mailer/package-lock.json` | Arbre exact et intégrités des dépendances npm du mailer pour npm ci ; généré par npm, ne pas éditer manuellement ni y injecter de commentaires. |
| `mailer/package.json` | Manifeste ESM du worker : scripts start/test, version Node minimale et Nodemailer ; JSON strict, commentaires fournis dans ce guide. |
| `mailer/templates.mjs` | Construit invitations/notifications françaises en texte et HTML échappé ; valide les champs sensibles et ajoute le logo CID local sans envoyer de mail. |
| `mailer/templates.test.mjs` | Huit tests avec transport MIME en mémoire et serveurs HTTP loopback : échappement, TLS, destinataire accepté et refus des redirections du jeton privilégié. |
| `mailer/worker.mjs` | Réclame les messages persistés, vérifie SMTP, envoie puis accuse le résultat ; distingue les erreurs ambiguës et réessaie l’accusé sans renvoyer SMTP dans le même cycle. |
| `widget/demo.html` | Exemple autonome de site client : valide company/API dans l’URL puis charge le widget commun ; aucun jeton administrateur dans la page. |
| `widget/supportdeflect-logo.png` | Logo binaire utilisé par la page de démonstration et comme pièce jointe CID dans les emails ; son rôle est expliqué ici car une image ne porte pas de commentaire source. |

### Opérations et contrôles du dépôt

| Fichier | Rôle et compréhension |
|---|---|
| `scripts/backup_postgres.sh` | Sauvegarde logique PostgreSQL du service Compose via pg_dump ; archive les données relationnelles sans remplacer la sauvegarde des fichiers locaux. |
| `scripts/backup_stack.sh` | Coordonne sauvegarde SQL et archives des volumes applicatifs avec arrêt/reprise des services concernés pour préserver leur cohérence. |
| `scripts/check_documentation.mjs` | Analyse syntaxique TypeScript/JavaScript : commentaires des contrats nommés, composants, types, méthodes et fonctions stockées dans les objets ; valide aussi le JSONC de tsconfig. |
| `scripts/check_documentation.py` | Contrôle en lecture seule : inventaire des fichiers, docstrings Python, en-têtes de formats, JSON et délégation au parseur TypeScript ; retourne un code non nul si une explication manque. |
| `scripts/configure.py` | Génère une configuration privée cohérente à partir d’une origine HTTP(S), avec secrets indépendants ; refuse d’écraser un .env existant et ne montre pas les secrets. |
| `scripts/create_local_certificate.sh` | Crée une autorité/certificat TLS pour l’origine du laboratoire ; les clés restent dans le répertoire local de certificats et la confiance doit être installée côté client. |
| `scripts/restore_archive.py` | Valide entièrement compression et membres d’archive avant remplacement d’un volume ; refuse traversées/liens et rétablit propriétaires/modes adaptés au service. |
| `scripts/restore_postgres.sh` | Restaure un dump SQL dans le service PostgreSQL ciblé ; opération de remplacement de données, à suivre avec les prérequis du runbook. |
| `scripts/restore_stack.sh` | Restaure ensemble base et volumes locaux après validation des archives ; encadre l’arrêt, la reprise et les contrôles de cohérence. |
| `scripts/run_native.py` | Orchestre le développement Windows : dépendances, migrations, workers, serveur et Mailpit ; vérifie la disponibilité, ouvre le navigateur et nettoie ses processus enfants. |
| `scripts/tests/test_operations.py` | Tests stdlib en répertoires temporaires : secrets de configuration, archives dangereuses/corrompues, modes, contrat Compose et protection des probes ; aucune restauration de données utilisateur. |
| `scripts/verify_stack.py` | Vérifie le contrat Compose et la pile réelle ; les options explicites permettent exercice et reprise avec état privé, et le redémarrage exige une interruption annoncée. |

### Documentation et preuves visuelles

| Fichier | Rôle et compréhension |
|---|---|
| `docs/AI.md` | Chaîne IA locale/Groq, identité du modèle, limites des données envoyées au fournisseur et diagnostic des composants réels. |
| `docs/API.md` | Contrats HTTP : authentification, ressources, droits, statuts, formats et différences entre API protégée et widget public. |
| `docs/ARCHITECTURE.md` | Découpage UI/API/services/stockage/workers, dépendances et chemins des principales requêtes. |
| `docs/AUDIT.md` | Constats techniques et risques suivis ; distingue les limites restantes des corrections déjà vérifiées. |
| `docs/DEPLOYMENT.md` | Préparer puis lancer le déploiement auto-hébergé ; référence réseau, volumes et étapes de migration. |
| `docs/DOCUMENTATION_REVIEW_2026-10-16.md` | Preuves datées de la passe de commentaires : couverture, équivalence du code et vérifications réellement exécutées. |
| `docs/FILE_GUIDE_FR.md` | Le présent parcours de lecture et inventaire : rôle de chaque fichier maintenu, échanges métier et vocabulaire technique. |
| `docs/FRONTEND_DESIGN.md` | Référentiel visuel et contrats fonctionnels des vues locataire et plateforme, tailles d’écran et règles de présentation. |
| `docs/GUIDE_FONCTIONNEL_FR.md` | Mode d’emploi français par rôle : inscription, connaissances, chat, support, administration et facturation manuelle. |
| `docs/IMPLEMENTATION_STATUS.md` | État des fonctionnalités livrées et limites opérationnelles ; ne remplace pas les résultats datés des tests. |
| `docs/MULTI_TENANCY.md` | Isolation par organisation, autorisations et filtrage des données/embeddings ; frontières entre personnel et visiteurs. |
| `docs/PROFESSOR_REQUIREMENTS.md` | Correspondance entre exigences du projet, implémentation, documents et preuves vérifiables. |
| `docs/QUALITY_REPORT_2026-10-13.md` | Rapport de l’audit complet précédent : défauts, corrections, validations et exigences encore dépendantes de l’environnement. |
| `docs/RAG_PROMPT.md` | Consignes de génération et de grounding : utilisation des passages fournis, incertitude, clarification et sources. |
| `docs/RUNBOOK.md` | Procédures opérateur : démarrage, arrêt, santé, TLS, sauvegarde, restauration et reprise ; certaines commandes modifient les données. |
| `docs/SECURITY.md` | Modèle de confiance, secrets, JWT, origine du widget, SSRF, journaux et limites connues des protections. |
| `docs/SUPER_ADMIN.md` | Création et usage du compte plateforme, organisations, abonnements, encaissements, communications et suivi opérationnel. |
| `docs/TESTING.md` | Registre des vérifications avec dates, commandes et portée ; conserve les anciennes mesures sans les présenter comme de nouveaux passages. |
| `docs/TROUBLESHOOTING.md` | Diagnostic guidé des erreurs d’installation, configuration, IA, mail et services ; utiliser les causes observées avant de relancer. |
| `docs/VM_SETUP.md` | Installation manuelle de la VM Ubuntu et prérequis de l’hébergement ; cette procédure n’est pas une preuve qu’une VM a été exécutée ici. |
| `docs/demo_acme_api_keys.md` | Notes d’intégration de la démonstration Acme et distinctions entre identifiants publics et autorisations ; ne pas y consigner de nouveaux secrets. |
| `docs/evidence/README.md` | Légende des captures avec contexte et limites : données synthétiques, vues représentatives, aucune preuve de recette réelle ou de déploiement VM. |
| `docs/evidence/admin-communications-desktop.png` | Capture bureau de la vue communications plateforme, sur données synthétiques ; illustration complémentaire aux assertions, sans preuve de service externe. |
| `docs/evidence/admin-communications-mobile.png` | Capture mobile de la vue communications plateforme, sur données synthétiques ; illustration complémentaire aux assertions, sans preuve de service externe. |
| `docs/evidence/admin-organization-desktop.png` | Capture bureau de la vue fiche organisation plateforme, sur données synthétiques ; illustration complémentaire aux assertions, sans preuve de service externe. |
| `docs/evidence/admin-organization-mobile.png` | Capture mobile de la vue fiche organisation plateforme, sur données synthétiques ; illustration complémentaire aux assertions, sans preuve de service externe. |
| `docs/evidence/client-default.png` | Capture de l’identité officielle enregistrée sur le site client indépendant ; illustre le résultat du rendu partagé. |
| `docs/evidence/client-desktop.png` | Capture bureau de la vue widget intégré sur un site client indépendant, sur données synthétiques ; illustration complémentaire aux assertions, sans preuve de service externe. |
| `docs/evidence/client-mobile.png` | Capture mobile de la vue widget intégré sur un site client indépendant, sur données synthétiques ; illustration complémentaire aux assertions, sans preuve de service externe. |
| `docs/evidence/customer-analytics-desktop.png` | Capture bureau de la vue analytics du locataire, sur données synthétiques ; illustration complémentaire aux assertions, sans preuve de service externe. |
| `docs/evidence/customer-analytics-mobile.png` | Capture mobile de la vue analytics du locataire, sur données synthétiques ; illustration complémentaire aux assertions, sans preuve de service externe. |
| `docs/evidence/customer-billing-desktop.png` | Capture bureau de la vue abonnement/usage du locataire, sur données synthétiques ; illustration complémentaire aux assertions, sans preuve de service externe. |
| `docs/evidence/customer-billing-mobile.png` | Capture mobile de la vue abonnement/usage du locataire, sur données synthétiques ; illustration complémentaire aux assertions, sans preuve de service externe. |
| `docs/evidence/customer-inbox-desktop.png` | Capture bureau de la vue suivi humain Inbox, sur données synthétiques ; illustration complémentaire aux assertions, sans preuve de service externe. |
| `docs/evidence/customer-inbox-mobile.png` | Capture mobile de la vue suivi humain Inbox, sur données synthétiques ; illustration complémentaire aux assertions, sans preuve de service externe. |
| `docs/evidence/customer-overview-desktop.png` | Capture bureau de la vue synthèse du locataire, sur données synthétiques ; illustration complémentaire aux assertions, sans preuve de service externe. |
| `docs/evidence/customer-overview-mobile.png` | Capture mobile de la vue synthèse du locataire, sur données synthétiques ; illustration complémentaire aux assertions, sans preuve de service externe. |
| `docs/evidence/customer-playground-desktop.png` | Capture bureau de la vue Playground locataire, sur données synthétiques ; illustration complémentaire aux assertions, sans preuve de service externe. |
| `docs/evidence/customer-playground-mobile.png` | Capture mobile de la vue Playground locataire, sur données synthétiques ; illustration complémentaire aux assertions, sans preuve de service externe. |
| `docs/evidence/customer-settings-desktop.png` | Capture bureau de la vue paramètres du compte locataire, sur données synthétiques ; illustration complémentaire aux assertions, sans preuve de service externe. |
| `docs/evidence/customer-settings-mobile.png` | Capture mobile de la vue paramètres du compte locataire, sur données synthétiques ; illustration complémentaire aux assertions, sans preuve de service externe. |
| `docs/evidence/customer-team-desktop.png` | Capture bureau de la vue gestion de l’équipe locataire, sur données synthétiques ; illustration complémentaire aux assertions, sans preuve de service externe. |
| `docs/evidence/customer-team-mobile.png` | Capture mobile de la vue gestion de l’équipe locataire, sur données synthétiques ; illustration complémentaire aux assertions, sans preuve de service externe. |
| `docs/evidence/landing-desktop.png` | Capture bureau de la vue vitrine publique, sur données synthétiques ; illustration complémentaire aux assertions, sans preuve de service externe. |
| `docs/evidence/landing-mobile.png` | Capture mobile de la vue vitrine publique, sur données synthétiques ; illustration complémentaire aux assertions, sans preuve de service externe. |
| `docs/evidence/launcher-default-40.png` | Capture du lanceur officiel à 40 pixels : conservation du logo dans sa pastille circulaire. |
| `docs/evidence/launcher-default-88.png` | Capture du lanceur officiel à 88 pixels : contrôle visuel de l’identité à grande taille. |
| `docs/evidence/launcher-robot-88.png` | Capture de la variante robot à 88 pixels : distingue l’icône de son conteneur circulaire. |
| `docs/evidence/login-desktop.png` | Capture bureau de la connexion avec données de démonstration ; les véritables identifiants ne doivent pas figurer dans les preuves. |
| `docs/evidence/overview-desktop.png` | Capture bureau de la vue synthèse BI plateforme, sur données synthétiques ; illustration complémentaire aux assertions, sans preuve de service externe. |
| `docs/evidence/overview-mobile.png` | Capture mobile de la vue synthèse BI plateforme, sur données synthétiques ; illustration complémentaire aux assertions, sans preuve de service externe. |
| `docs/evidence/register-desktop.png` | Capture bureau du formulaire d’inscription organisation/administrateur locataire. |
| `docs/evidence/studio-desktop.png` | Capture bureau de la vue Studio de design du widget, sur données synthétiques ; illustration complémentaire aux assertions, sans preuve de service externe. |
| `docs/evidence/studio-mobile.png` | Capture mobile de la vue Studio de design du widget, sur données synthétiques ; illustration complémentaire aux assertions, sans preuve de service externe. |
