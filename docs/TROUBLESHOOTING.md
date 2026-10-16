# Troubleshooting

Run Compose from the repository root; never share expanded secret configuration.

| Symptom | Check / action |
|---|---|
| Docker unavailable | Install Engine and Compose in the Linux VM; a standalone config parser cannot build images |
| Migration unhealthy | Inspect migrate/postgres logs and current revision; do not stamp unknown schemas |
| Backend rejects startup | Check central production validation, Groq key/model, strong secrets and explicit hosts |
| Groq unavailable | Verify actual account model access, key, quota and timeout; no silent mock fallback |
| Documents pending | Check worker heartbeat, shared DB, queued mode and migration |
| Document failed | Inspect failure cause, supported readable file/public URL, active subscription and chunk quota; retry from platform or reimport |
| Widget missing | Use served HTTP(S) HTML, correct snippet origin/company ID, approved hostname and browser network panel |
| Widget Origin denied | Empty allowlist denies all; localhost differs from 127.0.0.1; configure hostnames without paths/ports |
| HTTPS page blocks widget | Use HTTPS API with a certificate trusted by the client; never bypass mixed-content protection |
| Custom logo absent | Confirm saved identity=custom, owned local asset path, persisted widget_assets volume and image response |
| Human reply not visible | Keep panel/page visible; wait 15 seconds; pending token expires after seven days or is lost when host localStorage is cleared |
| Private note not visible to visitor | Expected; only the final human answer is public to the scoped capability |
| Password-change screen | Expected for invited users; replace the initial password before protected work |
| API 402 | Check active plan/period and rolling 30-day usage; platform admin can adjust commercial settings |
| Email not in Gmail | Expected local-only configuration; inspect /mail/ and platform delivery status |
| Mailer offline | Verify backend URL/shared service token/local SMTP availability; never paste the token in a report |
| Data absent after restart | Confirm same project/volumes/env; never run down -v |
| Restore failure | Keep writers stopped, preserve backups and inspect error before retry |
| Type/build install mismatch | Use Node 24 and npm ci against the committed lockfile |
| PostgreSQL integration skipped | Supply a disposable *_test database via TEST_POSTGRES_URL; skipped is not proven |
| Model installation network denied | Prepopulate the MiniLM cache; do not change to fake embeddings outside isolated tests |

The platform health page itself needs DB authentication. On a complete DB outage use container
logs and internal readiness endpoints. Changes to .env require container recreation (compose up -d).
