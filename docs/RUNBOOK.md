# Operator Runbook

All commands start at the repository root unless stated otherwise.
Compose project name is supportdeflect. Never operate on an unidentified deployment.

## Native Windows development

Run `demarrer-supportdeflect.bat` from the repository root. The launcher checks Node 24+,
Mailpit, the Python environment and installed dependencies, applies Alembic migrations,
reindexes stale vectors, then supervises the API, ingestion worker, frontend, SMTP capture
and mailer. Use `demarrer-supportdeflect.bat --offline-embeddings` when MiniLM is already
cached locally. The local configuration comes from `backend/.env`; keep a consistent
SQLite backup before upgrading an existing database.

Application: <http://localhost:5173>. API readiness: <http://127.0.0.1:8000/healthz/db>.
Captured mail: <http://127.0.0.1:8025>. Native logs are in `logs/native-*.log`.
SQLite persists both application data and 384-dimensional vectors; authenticated platform
health labels its JSON vector fallback as degraded because it does not provide PostgreSQL
pgvector. Groq remains the real external inference provider; local mail is captured only.

The 17 October 2026 local acceptance run retained the existing database, saved a verified
pre-upgrade backup in `data/backups`, and migrated from 0006 to 0008. Its separate synthetic
tenant and platform administrator have credentials in the ignored `data/local-access.json`.
The ignored `logs/native-stack-state.json` records this run's supervisor/service process IDs,
database and backup paths; `logs/native-verification.json` records the 21 passed checks.
These generated private files are specific to that run and are not distributed with Git.

## Routine Health

```bash
docker compose ps --all
docker compose logs --tail=100 backend worker mailer postgres traefik
python3 scripts/verify_stack.py
docker compose exec backend alembic current
docker compose exec backend python scripts/create_super_admin.py
```

Internal /healthz is liveness; /healthz/db requires DB connectivity and the current migration
head (0008). Local embeddings are warmed before the API accepts connections.
Authenticated /api/v1/platform/health reports dependency health. Missing Groq is not hidden
by a successful API liveness response. Worker heartbeats and actual queue progress are separate
signals. The mailbox is /mail/; mail delivery is local capture, not external delivery.

## Manual Release

Review the branch, run tests and obtain approval for a specific commit/tag. CI only builds/tests.

```bash
bash scripts/backup_stack.sh
git status --short
git fetch origin
read -r -p "Approved commit/tag: " RELEASE_REF
git checkout --detach "$RELEASE_REF"
docker compose config --quiet
docker compose build
docker compose stop frontend backend worker mailer
docker compose run --rm migrate
docker compose up -d
docker compose ps --all
```

Stop if the checkout has unexpected changes. Do not reset or discard them.
Keep the previous source revision, image identifiers, environment and matching backup together.
On failed migration, keep writers stopped and investigate; do not pretend rollback is a generic
alembic downgrade. Some historical migrations deliberately refuse destructive downgrade.

## Migrations

0001 freezes the initial schema; 0002 introduces platform identities, roles, cases and audit;
0003 adds PostgreSQL pgvector(384)/HNSW; 0004 adds administration, billing, mailing and token
revocation; 0005 persists the complete widget design; 0006 records vector model identity;
0007 reserves in-flight question quota without holding a database lock across generation;
0008 records explicit conversation outcomes and indexes periodic rate-limit cleanup.
For pre-Alembic databases, back up and compare the entire baseline schema before any stamp.
Never stamp an unknown database just to suppress an error.

## Change the Groq Model

Edit GROQ_MODEL in .env, then `docker compose up -d backend worker`.
Unset GROQ_REASONING_EFFORT if the new model does not support configurable reasoning.
Check authenticated platform health and ask a sourced question. A model listed in documentation
may still be inaccessible to the account; the actual models endpoint is authoritative.
Do not change embedding model/dimension without reindexing knowledge. Database vectors from a
different embedding function cannot be compared meaningfully even when lengths match.
See [AI operations](AI.md#startup-and-model-changes) for the reindex procedure, token budgets
and Groq rate-limit diagnostics. Native startup automatically reindexes stale vectors.

## TLS

For a local demonstration certificate:

```bash
bash scripts/create_local_certificate.sh YOUR_VM_HOSTNAME_OR_IP
# Set PUBLIC_URL=https://YOUR_VM_HOSTNAME_OR_IP in .env.
export COMPOSE_FILE=docker-compose.yml:docker-compose.tls.yml
docker compose config --quiet
docker compose up -d --build
```

Trust infra/certs/server.crt on each client. Keep server.key private and out of Git.
For broader distribution, supply a certificate trusted by the intended browsers at those same
paths. There is no hosted certificate service dependency. HTTP redirects to HTTPS in this overlay.
An HTTPS customer page cannot embed an insecure HTTP widget; fix the API origin/certificate,
not the browser's mixed-content protections. Keep COMPOSE_FILE exported in every operator shell,
including backup, restore, release and acceptance commands: these scripts inherit it. Passing -f
only to the initial up command does not configure subsequent script invocations. Never print
resolved Compose JSON: it contains interpolated secrets. For Python acceptance checks, pass
`--ca-file infra/certs/server.crt`; certificate verification is never disabled.

## Backup

```bash
bash scripts/backup_stack.sh
```

The script briefly stops application/mail writers, takes a PostgreSQL custom dump, local widget
asset archive and Mailpit database archive, then restarts them even on failure.
The returned directory contains database-path.txt pointing at the companion database dump.
Keep both together. hf_cache can be downloaded again and is not user data.
Store .env (including the invitation encryption secret) and TLS keys separately, encrypted.
A backup on the same VM alone is not disaster recovery: maintain a protected independent copy.

Inspect a database archive before restore:

```bash
read -r -p "Dump path: " DUMP
docker compose exec -T postgres pg_restore --list < "$DUMP"
```

## Restore

Use a disposable VM first. Restore replaces application data and requires downtime.
Confirm project/volume names, matching code revision and current backup before proceeding.

```bash
read -r -p "Dump path: " DUMP
bash scripts/restore_postgres.sh "$DUMP" --confirm-replace
```

This restores PostgreSQL in one transaction, migrates and restarts writers. It does not restore
logos or mailbox. For a full-stack restore, stop frontend/backend/worker/mailer/mailpit and restore
the trusted widget-assets.tar.gz and mail.tar.gz archives into their named volumes, preserving
ownership. Use a clean destination deployment for the first rehearsal; never extract an untrusted
archive as root. Keep the source database and corresponding asset backup together.
After restoration check login, document/vector retrieval, custom logo, pending mail and cases.
Restoration of assets/mail is performed with explicit confirmation:

```bash
bash scripts/restore_stack.sh backups/stack-YOUR_TIMESTAMP --confirm-replace
```

Archives are validated before writers are stopped or data is replaced. Absolute/traversal paths,
links/devices, duplicate paths, missing root directories and file/directory conflicts are rejected.
The archive helper reads the complete gzip stream and verifies its CRC/trailer before replacing
existing files. TAR path/type checks then reuse that same open source descriptor. Corrupted or
truncated archives leave the destination intact; this does not make replacement atomic against
disk failure or interruption during extraction. Keep the pre-restore backup until validation passes.

Ownership and ordinary permission bits are restored so non-root API/mail services remain writable;
setuid/setgid bits are never restored. Only restore backups from this trusted deployment/revision.
The mailbox volume name is resolved from Compose, not hardcoded to the default project name.

## Restart Persistence

Create a known organization, document, custom logo and support case. Record their IDs plus
widget design JSON. Then:

```bash
docker compose down
docker compose up -d
docker compose ps --all
```

Never add -v: it deletes persistent volumes. Sign in again, verify the exact IDs/design/logo,
ask the same knowledge question and read the case/audit history. Check /mail/ retained messages.
Container recreation alone is not proof of data persistence; compare application data.
Repeat after rebooting the VM. This infrastructure proof is still required on the target VM.

## Executable Acceptance

The default check is read-only. It verifies the actual containers, successful migration, service
health, exact network/volume attachments, sole published proxy ingress, landing, API, widget and
protected Mailpit access. It returns nonzero on failure, including when Docker is unavailable.

```bash
python3 scripts/verify_stack.py --report logs/stack-readiness.json
# Explicitly creates one synthetic tenant, logo/design and local welcome email.
python3 scripts/verify_stack.py --exercise --state logs/stack-state.json --report logs/stack-initial.json
# Explicit downtime for ALL tenants; never adds -v and never removes persistent volumes.
python3 scripts/verify_stack.py --state logs/stack-state.json --restart --allow-interruption --report logs/stack-restart.json
# After a manual VM reboot or restore, verify the SAME identity, design, logo hash and email ID.
python3 scripts/verify_stack.py --state logs/stack-state.json --report logs/stack-after-reboot.json
```

Use a new state filename for each new exercise. Welcome mail automation must be enabled and the
mail quota available. The exercise remains visible as a synthetic organization; archive it from
Super Admin once acceptance is recorded. It does not delete user data or call Groq/MiniLM.
The state file contains a random synthetic account password: POSIX mode 0600, ignored logs directory.
Keep it private with host filesystem permissions on Windows. Never upload it, backups, .env or full
container inspection as CI evidence. Only the sanitized report is suitable for sharing.

The CI containers job exercises this same procedure, then restores a backup onto empty disposable
runner volumes and verifies both retained data and new writes. CI volume deletion is deliberately
confined to that ephemeral runner. It is NOT a deployment or a substitute for the target VM reboot,
browser/external-snippet test, real Groq answer, or hosted green workflow evidence.

## Team Invitation Troubleshooting

1. Open Team as the tenant administrator. Inspect account state, invitation expiry and latest
   email state separately; an invited account is not an activated account.
2. Check the transport status. In the default self-hosted stack, `Captured locally` means Mailpit
   accepted the mail; it did not reach a real Gmail/Forvia inbox. Only an authorized operator may
   inspect the protected local mailbox. Do not give tenants access to this shared inbox.
3. If the worker is offline or SMTP unavailable, fix the service/configuration first. Queueing an
   invitation is durable and does not prove SMTP delivery. The worker reserves at most the configured
   rolling daily mail limit, including in-flight deliveries.
4. Renew an expired or unusable pending invitation from Team. Previous credentials become invalid.
   Wait for an active sending claim to finish; do not rotate the password during SMTP delivery.
5. Treat `delivery_unknown` or ambiguous delivery failures as manual-review cases. The server may
   have accepted the mail before losing its connection. Blind retries can produce duplicate emails;
   the stable Message-ID does not guarantee recipient deduplication.
6. On first login, the agent replaces the temporary password, then signs in with their personal
   password. The old JWT/password no longer works. If automatic sign-in fails after replacement,
   the UI returns to login; do not repeat the change with the old password.
7. Deactivation cancels unsent invitation credentials. Reactivation creates a fresh invitation only
   for an unaccepted account; accepted agents keep their personal password.

Keep Mailpit data/backups private: scrubbing the database outbox does not erase captured emails.
Changing SECRET_KEY makes pending invitation ciphertext unusable; explicitly renew those invitations.

## Presentation Checklist

1. Show the approved Git revision and the teacher requirement matrix.
2. Explain frontend/API/business/database and client/widget/knowledge diagrams.
3. Show networks, named volumes, migration success and sole Traefik ingress.
4. Register Tenant A; create an agent; inspect the branded invitation in local Mailpit.
5. Log in as the agent and complete mandatory password change.
6. Upload a short support policy; show indexing progress and real persisted chunks.
7. Ask a documented question with configured Groq; show source evidence.
8. Customize every relevant widget property, upload a logo, save and reload Studio.
9. Copy the generated snippet into a separate served HTML page and open the widget.
10. Show desktop/mobile layout, original brand/custom logo and Powered by SupportDeflectAI.
11. Ask an unsupported question; inspect the created Inbox case.
12. Add a private note and resolve; show the human reply in the widget without the note.
13. Show wrong-role, foreign-tenant and disallowed-Origin denial.
14. Open Super Admin BI; explain MRR versus collected receipts and currency filters.
15. Edit an organization's plan/period, archive/restore, record a payment and linked refund.
16. Send a previewed campaign; observe local SMTP delivery status and automation preferences.
17. Show audited actions, failed-job retry and actual dependency health.
18. Perform restart/persistence and backup/restore on disposable infrastructure.
19. Show passing hosted CI and explain why deployment remains manual.

Record actual timestamps/statuses and sanitized screenshots. Never display passwords, tokens,
API keys or full invitation emails in a public report.
