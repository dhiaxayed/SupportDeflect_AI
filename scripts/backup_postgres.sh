#!/usr/bin/env bash
# Create one private, custom-format PostgreSQL dump for this Compose project.
# Inputs: no arguments; Docker context, Compose configuration and the running
# postgres service select the database and credentials. Requires Bash/Docker.
# Output: a timestamp/PID-named backups/*.dump and its relative path on stdout.
# The dump contains tenant data and is not encrypted. Protect it as sensitive
# operator material; database-only backup excludes local logos, mail and secrets.
# Strict mode propagates failed commands; the EXIT trap removes an unfinished
# dump so a partial pg_dump is never published under the final .dump name.
set -euo pipefail
# Resolve repository-relative configuration independently of the invoking folder.
cd "$(dirname "$0")/.."
# New host files/directories are private to the invoking operator by default.
umask 077
mkdir -p backups
target="backups/supportdeflect-$(date -u +%Y%m%dT%H%M%S)-$$.dump"
partial="$target.partial"
trap 'rm -f -- "$partial"' EXIT
# Read PostgreSQL identity inside its container; do not expand credentials into
# the host command line or mix the binary archive with the success-path output.
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$partial"
# Publish only after pg_dump exits successfully; an actual restore drill is a
# separate acceptance step, not something the existence of this file proves.
mv -- "$partial" "$target"
printf '%s\n' "$target"
