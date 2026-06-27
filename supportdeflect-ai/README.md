# SupportDeflect AI

SupportDeflect AI est une plateforme SaaS RAG multi-tenant qui transforme une documentation produit en assistant support intelligent integrable sur n'importe quel site web via un widget JavaScript.

Le produit permet a une entreprise d'uploader des PDF, fichiers TXT/Markdown ou URLs de documentation, de les indexer dans Neon/PostgreSQL avec pgvector et des embeddings MiniLM, puis de generer un snippet :

```html
<script src="https://supportdeflect.ai/api/v1/widget/script.js" data-company="company_123"></script>
```

Le visiteur pose une question depuis le widget. Le backend recupere uniquement les chunks du tenant concerne, construit un prompt RAG strict et appelle Llama 3.3 70B Versatile via Groq.

## Fonctionnalites

- Authentification JWT.
- Inscription organisation + premier admin.
- SaaS multi-tenant avec isolation stricte par `org_id`.
- Upload PDF, TXT, Markdown.
- Indexation d'URL de documentation.
- Extraction, nettoyage, chunking, embeddings et stockage vectoriel Neon/PostgreSQL via pgvector.
- Ingestion asynchrone via une queue durable stockee dans Neon, sans service payant externe.
- Chat admin playground.
- Widget JavaScript vanilla avec Shadow DOM.
- Configuration widget : marque, couleur, greeting, support email, mode strict, domaines autorises.
- Analytics : total questions, resolues, non resolues, taux de resolution, confiance moyenne, dernieres questions, documents les plus utilises.
- Essai gratuit limite avec quotas, puis plans actives manuellement dans Neon apres contact commercial.
- Escalade humaine si la confiance est insuffisante ou si le contexte ne contient pas la reponse.
- Docker Compose pour lancement local.
- Tests essentiels backend.

## Stack

| Couche | Technologie |
|---|---|
| Frontend admin | React, TypeScript, Vite |
| Backend | FastAPI, Python, SQLAlchemy, Pydantic |
| Auth | JWT, bcrypt |
| Relationnel | Neon Postgres / PostgreSQL |
| Vector store | Neon/PostgreSQL + pgvector via `VECTOR_PROVIDER=database` |
| Embeddings | sentence-transformers/all-MiniLM-L6-v2 |
| LLM | Llama 3.3 70B Versatile via Groq |
| Widget | JavaScript vanilla + Shadow DOM |
| Deploiement | Docker, Docker Compose |

## Structure

```text
supportdeflect-ai/
├── backend/
│   ├── app/
│   │   ├── core/
│   │   ├── routers/
│   │   ├── services/
│   │   ├── models.py
│   │   ├── schemas.py
│   │   ├── db.py
│   │   ├── deps.py
│   │   ├── security.py
│   │   └── main.py
│   ├── tests/
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
├── widget/
│   └── demo.html
├── docs/
├── docker-compose.yml
└── README.md

../learn-serve-main/learn-serve-main/
├── src/
├── package.json
├── vite.config.ts
└── Dockerfile
```

## Lancement local avec Docker

```bash
cp backend/.env.example backend/.env
# Renseigner DATABASE_URL avec l'URL Neon dans backend/.env
cd backend && .venv/Scripts/python.exe scripts/init_db.py && cd ..
docker compose up --build
```

Puis ouvrir :

- Frontend admin : `http://localhost:5173`
- Backend API : `http://localhost:8000`
- Docs FastAPI : `http://localhost:8000/docs`
- Worker ingestion : service `worker` dans Docker Compose

Le backend passe automatiquement en LLM mock si `GROQ_API_KEY` est vide. Pour un vrai appel Llama via Groq, renseigner :

```env
GROQ_API_KEY=your_groq_api_key
LLM_PROVIDER=groq
```

Pour une demo offline rapide sans telechargement du modele d'embeddings, utiliser :

```env
EMBEDDING_PROVIDER=fake
VECTOR_PROVIDER=memory
LLM_PROVIDER=mock
```

## Deploiement production

Utiliser `backend/.env.production.example` comme base et fournir les vraies valeurs via les variables d'environnement de la plateforme :

- `ENVIRONMENT=production`
- `DEBUG=false`
- `DOCS_ENABLED=false`
- `INIT_DATABASE_ON_STARTUP=false`
- `DATABASE_URL` vers Neon avec SSL
- `SECRET_KEY` long et unique
- `CORS_ORIGINS` limite au domaine frontend public
- `TRUSTED_HOSTS` limite au domaine API public
- `GROQ_API_KEY` configure
- `VECTOR_PROVIDER=database` pour garder le RAG persistant dans Neon avec pgvector sans service vectoriel separe
- `RATE_LIMIT_PROVIDER=database` pour partager les limites entre instances sans Redis payant

Initialiser Neon explicitement avant le premier demarrage :

```bash
cd backend
python scripts/init_db.py
```

Pour respecter le mode RAG reel gratuitement avec Neon, garder :

```env
EMBEDDING_PROVIDER=sentence-transformers
EMBEDDING_MODEL_NAME=sentence-transformers/all-MiniLM-L6-v2
VECTOR_PROVIDER=database
RATE_LIMIT_PROVIDER=database
```

## Plans, quotas et paiement manuel

Le projet ne depend pas d'un prestataire de paiement. Par defaut, une nouvelle organisation est creee en `trial` avec un essai gratuit limite :

- 3 documents ;
- 200 chunks RAG ;
- 100 questions sur 30 jours ;
- upload maximum de 2 MB.

Apres contact client et validation manuelle du paiement, mettre a jour Neon directement :

```sql
update organizations
set subscription_plan = 'starter',
    subscription_status = 'active',
    trial_ends_at = null
where public_id = 'company_xxx';
```

Plans supportes : `trial`, `starter`, `pro`, `enterprise`.

Pour suspendre un client :

```sql
update organizations
set subscription_status = 'past_due'
where public_id = 'company_xxx';
```

## Lancement sans Docker

Backend :

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Renseigner DATABASE_URL avec l'URL Neon
python scripts/init_db.py
uvicorn app.main:app --reload
```

Worker d'ingestion dans un second terminal :

```bash
cd backend
python scripts/run_ingestion_worker.py
```

Frontend :

```bash
cd ../learn-serve-main/learn-serve-main
npm install
cp .env.example .env
npm run dev
```

## Scenario de demonstration

1. Creer une organisation `Acme SaaS` depuis `/register`.
2. Uploader `docs/demo_acme_api_keys.md` depuis la page Upload.
3. Aller dans Playground.
4. Poser : `How do I regenerate my API key?`
5. Verifier la reponse, les sources et le score de confiance.
6. Copier le snippet depuis la page Widget snippet.
7. Coller le snippet dans `widget/demo.html` en remplacant `company_xxx` par le public id de l'organisation.
8. Ouvrir la page demo et tester le widget.
9. Consulter Analytics pour voir la question journalisee.

## Endpoints principaux

### Auth

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`

### Documents

- `GET /api/v1/documents`
- `POST /api/v1/documents/upload`
- `POST /api/v1/documents/url`
- `DELETE /api/v1/documents/{document_id}`

### Chat

- `POST /api/v1/chat`

### Widget public

- `GET /api/v1/widget/script.js`
- `GET /api/v1/widget/settings/{company_id}`
- `POST /api/v1/widget/chat`

### Analytics

- `GET /api/v1/analytics/summary`
- `GET /api/v1/analytics/unresolved`

### Settings

- `GET /api/v1/settings/widget`
- `PUT /api/v1/settings/widget`

## Securite

Le projet implemente ou prepare les controles suivants :

- bcrypt pour les mots de passe ;
- JWT pour les sessions admin ;
- CORS configurable ;
- validation Pydantic ;
- taille maximale d'upload ;
- controle MIME/extension ;
- filtrage des chunks vectoriels par `org_id` ;
- domain allowlist pour le widget ;
- rate limiting widget ;
- prompt systeme anti-hallucination et anti-prompt-injection ;
- logs sans secrets ;
- aucune cle API hardcodee.

## Tests

```bash
cd backend
pytest
```

La suite couvre : auth register/login/me, ingestion texte, upload document, chat RAG, widget chat, isolation tenant et analytics.

## Limites connues du MVP

- L'ingestion utilise une queue DB gratuite. Pour tres gros volumes, migrer vers un broker dedie.
- Pas encore de migrations Alembic.
- Pas de stockage objet des fichiers originaux.
- Rate limiting in-memory non partage entre replicas.
- Pas de facturation ni quotas par organisation.
- Pas de reranking ni evaluation RAG automatisee.

## Roadmap production

1. Alembic pour migrations.
2. Redis + worker ingestion.
3. Stockage S3 compatible avec chiffrement.
4. Rate limiting distribue.
5. Monitoring OpenTelemetry, Prometheus et alerting.
6. Feedback utilisateur sur les reponses.
7. Reranking et evaluation RAG.
8. Quotas, plans tarifaires et Stripe.
9. Integrations Zendesk, Intercom, Slack, HubSpot.
10. CI/CD avec tests, build, scan de vulnerabilites et deploiement cloud.
