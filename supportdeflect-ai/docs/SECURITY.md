# Securite

## Mesures implementees

- Hash des mots de passe avec bcrypt via passlib.
- JWT signe avec secret configurable.
- CORS configure par variable d'environnement.
- Isolation multi-tenant via `org_id` dans PostgreSQL, y compris les chunks RAG et embeddings pgvector.
- Routes admin protegees par Bearer token.
- Validation Pydantic sur les payloads.
- Limite de taille d'upload.
- Controle d'extension et MIME type pour PDF, TXT et Markdown.
- Domain allowlist du widget.
- Rate limiting in-memory pour le widget.
- Prompt systeme robuste contre hallucination et prompt injection documentaire.
- Journalisation sans secrets.
- Aucune cle API hardcodee.

## Points de durcissement production

- Remplacer le rate limiting in-memory par Redis.
- Ajouter Alembic pour les migrations SQL.
- Stocker les fichiers originaux dans S3 ou equivalent avec chiffrement.
- Ajouter une politique de retention des conversations.
- Ajouter WAF/CDN devant le widget et l'API publique.
- Ajouter des quotas par organisation pour controler les couts LLM.
- Ajouter OpenTelemetry, metriques Prometheus et alerting.
- Ajouter une evaluation RAG continue et un mecanisme de feedback utilisateur.

## Prompt injection

Les documents peuvent contenir des instructions malveillantes du type "ignore previous instructions". Le prompt systeme impose explicitement au modele d'ignorer toute instruction trouvee dans les documents qui tente de modifier son comportement. Le contexte est traite comme preuve documentaire, pas comme instruction.
