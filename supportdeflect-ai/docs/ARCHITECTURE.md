# Architecture technique

SupportDeflect AI est un SaaS RAG multi-tenant compose de quatre blocs principaux : dashboard React, API FastAPI, moteur RAG stocke dans Neon/PostgreSQL avec pgvector, et widget JavaScript embarquable.

## Flux principal

1. Un administrateur cree son organisation et son compte admin.
2. Il importe un document ou une URL depuis le dashboard.
3. FastAPI valide le document, cree une ligne `documents` et ajoute un job dans `ingestion_jobs`.
4. Le worker extrait/nettoie le texte, le decoupe en chunks et cree des embeddings MiniLM.
5. Les chunks sont stockes dans la table `vector_chunks` avec les metadonnees `org_id`, `document_id`, `title`, `source`, `chunk_index` et un embedding pgvector sur PostgreSQL/Neon.
6. Le widget envoie une question avec `company_id`, `visitor_id` et `question`.
7. Le backend retrouve l'organisation via `public_id`, verifie la domain allowlist, applique le rate limiting et lance le pipeline RAG.
8. Le retriever cherche uniquement les chunks dont `org_id` correspond au tenant courant.
9. Le prompt systeme impose le mode documentation-only et Groq Llama 3.3 70B genere la reponse.
10. La reponse, les sources, la confiance et le statut sont journalises dans PostgreSQL.

## Backend

Le backend suit une architecture modulaire :

- `core/` : configuration et logging.
- `routers/` : endpoints REST.
- `services/` : ingestion, embeddings, vector store, RAG, LLM, analytics, rate limiting.
- `models.py` : modeles SQLAlchemy.
- `schemas.py` : schemas Pydantic.
- `deps.py` : dependances FastAPI pour auth et tenant courant.

## Abstraction vectorielle

`BaseVectorStore` definit les operations necessaires :

- `upsert_chunks`
- `search`
- `delete_by_document`

L'implementation par defaut est `DatabaseVectorStore`. Sur PostgreSQL/Neon, elle utilise pgvector pour le tri cosine indexe. Sur SQLite, elle garde un fallback JSON utile au developpement local. `InMemoryVectorStore` permet les tests et les demos offline. `ChromaVectorStore` reste disponible comme provider optionnel si `chromadb` est installe.

## Multi-tenant

Chaque ressource relationnelle contient `org_id`. Les routes admin recuperent l'organisation depuis le JWT. Les routes publiques utilisent `company_id` uniquement pour retrouver le tenant puis filtrent toutes les operations par l'organisation correspondante.

Dans `vector_chunks`, chaque chunk contient `org_id`. Le retrieval filtre toujours par tenant avant le classement vectoriel.

## Abonnements et quotas

Les abonnements sont stockes sur `organizations` via `subscription_plan`, `subscription_status` et `trial_ends_at`. Le paiement reste manuel : l'equipe met a jour ces colonnes dans Neon apres contact client. Les quotas sont appliques par `services/subscriptions.py` sur :

- documents actifs ;
- chunks RAG ;
- questions sur 30 jours ;
- taille maximale d'upload.

## Queue d'ingestion

`ingestion_jobs` est une queue durable gratuite stockee dans Neon/PostgreSQL. L'API web cree des jobs et retourne vite au dashboard. Le worker `scripts/run_ingestion_worker.py` claim les jobs avec `FOR UPDATE SKIP LOCKED`, ce qui permet de lancer plusieurs workers sans traiter deux fois le meme document.
