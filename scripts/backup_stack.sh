#!/usr/bin/env bash
# Snapshot PostgreSQL, widget assets and the local mailbox for one Compose stack.
# Inputs: no arguments; use the intended Docker context/project and compatible
# backend image. Requires Bash, Docker Compose, host Python 3 and a running stack.
# Output: a private backups/stack-* directory containing two gzip TAR archives
# and database-path.txt, which references a separate backups/*.dump in this checkout.
# Contains tenant data and captured email, without encryption. Keep the dump and
# bundle together; retain .env/TLS keys separately under appropriate protection.
# Application/mail writers are stopped for consistency. The EXIT trap attempts
# to start those services even after failure; it does not verify their readiness.
# A failed command can leave an incomplete bundle: check exit status and contents.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
target="$(pwd)/backups/stack-$(date -u +%Y%m%dT%H%M%S)-$$"
mkdir -p "$target"
# Resolve the volume from Compose, including an operator-selected project name.
mail_volume="$(docker compose config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["volumes"]["mail_data"]["name"])')"
# Stop writers while taking a consistent DB/assets/mail snapshot. Restart even on failure.
trap 'docker compose start backend worker mailer frontend mailpit >/dev/null' EXIT
docker compose stop frontend backend worker mailer mailpit
# PostgreSQL remains available for pg_dump; the returned relative path is the
# manifest link to the independently published dump, not the dump bytes themselves.
bash scripts/backup_postgres.sh > "$target/database-path.txt"
# Use the backend image's mounted asset volume and Python TAR support; root is
# needed to read service-owned files. The one-off container starts no dependencies.
docker compose run --rm --no-deps -T --user root --volume "$target:/backup" --entrypoint python backend -c \
  'import tarfile; t=tarfile.open("/backup/widget-assets.tar.gz","w:gz"); t.add("/app/data/widget-assets",arcname="widget-assets"); t.close()'
# Mount stopped Mailpit storage read-only so archiving cannot mutate its mailbox.
docker compose run --rm --no-deps -T --user root --volume "$mail_volume:/mail:ro" --volume "$target:/backup" --entrypoint python backend -c \
  'import tarfile; t=tarfile.open("/backup/mail.tar.gz","w:gz"); t.add("/mail",arcname="mail"); t.close()'
printf '%s\n' "$target"
printf 'Keep the referenced PostgreSQL dump and this directory together. Store .env and TLS keys separately and securely.\n'
