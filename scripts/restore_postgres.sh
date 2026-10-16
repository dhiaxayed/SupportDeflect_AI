#!/usr/bin/env bash
# Restore an operator-selected PostgreSQL dump into this configured Compose database.
# Usage: restore_postgres.sh DUMP --confirm-replace [--keep-stopped]. Inputs must
# be trusted backups compatible with the current application/schema and .env.
# Requires Bash, Docker Compose, a running postgres service and the migrate image.
# --clean replaces archived database objects; --no-owner/--no-acl retain destination
# role ownership policy. This does not restore widget assets, mail volumes or keys.
# Output: pg_restore/migration/startup status and a nonzero exit on command failure.
# The data restore is one PostgreSQL transaction; migration is a separate step.
# Failure during restore/migration does not restart writers; a final startup
# failure can leave only some services running and requires operator inspection.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$#" -lt 2 || "$#" -gt 3 || "$2" != "--confirm-replace" || ! -f "$1" || ( "$#" -eq 3 && "$3" != "--keep-stopped" ) ]]; then
  printf 'Usage: bash scripts/restore_postgres.sh backups/FILE.dump --confirm-replace\n' >&2
  exit 2
fi
# The operator has explicitly selected the database in this Compose project.
# Check archive table-of-contents readability before downtime. This is not a
# complete payload-integrity check; pg_restore can still reject data during restore.
docker compose exec -T postgres pg_restore --list < "$1" > /dev/null
# Block application/outbox writes while database state is replaced and migrated.
# The database-only workflow intentionally leaves the separate Mailpit service alone.
docker compose stop backend worker frontend mailer
docker compose exec -T postgres sh -c 'pg_restore --single-transaction --clean --if-exists --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$1"
# Bring restored relational state to the checked-out application's expected schema
# before allowing these service writers to resume.
docker compose run --rm migrate
# The full-stack wrapper keeps writers down until file volumes are restored too.
if [[ "${3:-}" != "--keep-stopped" ]]; then
  docker compose up -d backend worker frontend mailer
fi
