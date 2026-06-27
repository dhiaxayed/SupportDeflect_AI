# API REST

L'API est exposee sous `/api/v1`. La documentation interactive est disponible sur `http://localhost:8000/docs`.

## Auth

### POST `/api/v1/auth/register`

Cree une organisation et le premier utilisateur admin.

```json
{
  "organization_name": "Acme SaaS",
  "admin_email": "admin@acme.com",
  "password": "secure-password",
  "admin_full_name": "Acme Admin"
}
```

### POST `/api/v1/auth/login`

Retourne un JWT Bearer.

```json
{
  "email": "admin@acme.com",
  "password": "secure-password"
}
```

### GET `/api/v1/auth/me`

Retourne l'utilisateur courant et son organisation.

## Documents

Toutes les routes documents necessitent `Authorization: Bearer <token>`.

- `GET /api/v1/documents`
- `POST /api/v1/documents/upload`
- `POST /api/v1/documents/url`
- `DELETE /api/v1/documents/{document_id}`

## Chat admin

### POST `/api/v1/chat`

```json
{
  "question": "How do I regenerate my API key?"
}
```

Reponse :

```json
{
  "answer": "...",
  "sources": [
    {
      "document_id": "...",
      "title": "API guide",
      "source": "api-guide.txt",
      "chunk_index": 0,
      "score": 0.82,
      "snippet": "..."
    }
  ],
  "confidence_score": 0.78,
  "status": "resolved",
  "needs_human": false
}
```

## Widget public

- `GET /api/v1/widget/script.js`
- `GET /api/v1/widget/settings/{company_id}`
- `POST /api/v1/widget/chat`

Payload widget :

```json
{
  "company_id": "company_123",
  "visitor_id": "visitor_abc",
  "question": "question utilisateur"
}
```

## Analytics

- `GET /api/v1/analytics/summary`
- `GET /api/v1/analytics/unresolved`

## Settings

- `GET /api/v1/settings/widget`
- `PUT /api/v1/settings/widget`
