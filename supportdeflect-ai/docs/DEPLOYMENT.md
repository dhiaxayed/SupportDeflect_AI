# Deploiement

## Local avec Docker Compose

```bash
cp backend/.env.example backend/.env
# Renseigner DATABASE_URL avec l'URL Neon dans backend/.env
cd backend && python scripts/init_db.py && cd ..
docker compose up --build
```

Services :

- Admin React : `http://localhost:5173`
- Backend API : `http://localhost:8000`
- FastAPI docs : `http://localhost:8000/docs`
- Database : Neon Postgres via `DATABASE_URL`
- Worker ingestion : service `worker`, meme image que le backend

## Variables importantes

- `SECRET_KEY` : secret JWT long et aleatoire.
- `DATABASE_URL` : URL Neon/PostgreSQL avec SSL.
- `DOCS_ENABLED` : `false` en production pour cacher Swagger/ReDoc.
- `INIT_DATABASE_ON_STARTUP` : `false` en production apres initialisation/migration.
- `GROQ_API_KEY` : cle Groq Cloud.
- `LLM_PROVIDER` : `groq` en production, `mock` pour les tests offline.
- `EMBEDDING_PROVIDER` : `sentence-transformers` en production, `fake` pour tests offline.
- `VECTOR_PROVIDER` : `database` pour utiliser Neon/PostgreSQL avec pgvector comme stockage RAG persistant.
- `RATE_LIMIT_PROVIDER` : `database` pour partager le rate limiting via Neon.
- `INGESTION_MODE` : `queued` en production, avec `worker` lance.
- `CORS_ORIGINS` : liste stricte des origines admin autorisees.

## Production recommandee

- API FastAPI conteneurisee derriere un reverse proxy TLS.
- Frontend deploye sur CDN ou service statique.
- Neon Postgres avec backups et rotation des credentials.
- Neon/PostgreSQL + pgvector pour les chunks RAG et Neon/PostgreSQL pour le rate limiting distribue.
- Worker dedie pour ingestion asynchrone via `python scripts/run_ingestion_worker.py`.
- Object storage pour les fichiers originaux.
- CI/CD avec tests backend, build frontend et scan de dependances.

## Activation manuelle des abonnements

Les plans sont geres sans service payant externe. Une organisation demarre en `trial`. Apres validation commerciale, mettre a jour Neon :

```sql
update organizations
set subscription_plan = 'pro',
    subscription_status = 'active',
    trial_ends_at = null
where public_id = 'company_xxx';
```

Valeurs attendues :

- `subscription_plan` : `trial`, `starter`, `pro`, `enterprise`
- `subscription_status` : `trialing`, `active`, `past_due`, `canceled`

Les quotas sont appliques par l'API sur les uploads, l'indexation d'URL, le chat admin et le widget public.
