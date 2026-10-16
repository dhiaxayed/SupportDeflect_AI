#!/usr/bin/env bash
# Restore one trusted DB/assets/mail bundle into the currently configured stack.
# Usage: restore_stack.sh backups/stack-DATE --confirm-replace. Keep its companion
# database dump at the manifest's relative checkout path; provide matching .env
# and TLS material separately. Requires Bash, realpath, Python 3, Docker Compose,
# a running postgres service and compatible backend/migrate images.
# Output: validation/restore progress and a completion reminder, not functional
# acceptance proof. This intentionally replaces data and interrupts tenant service.
# Archive validation precedes file deletion, but the combined DB/file restore is
# not globally atomic. Replacement failure does not restart stopped writers;
# final startup failure may leave a partial stack. Retain a known-good backup
# before invoking this operator-only workflow.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ "$#" -eq 2 && "$2" == "--confirm-replace" ]] || { printf 'Usage: bash scripts/restore_stack.sh backups/stack-DATE --confirm-replace\n' >&2; exit 2; }
# Resolve the selected bundle directory before enforcing this checkout's backups
# boundary. The manifest must identify an existing backups/*.dump companion.
backup="$(realpath "$1")"
[[ "$backup" == "$(pwd)/backups/"* && -f "$backup/database-path.txt" ]] || { printf 'Select a backup inside this checkout\n' >&2; exit 2; }
read -r dump < "$backup/database-path.txt"
[[ "$dump" == backups/*.dump && -f "$dump" ]] || { printf 'Companion database dump missing\n' >&2; exit 2; }
# Validate both gzip streams and permitted TAR members without --replace, before
# stopping services. The helper rejects traversal, links and unexpected roots.
for kind in widget-assets mail; do
  docker compose run --rm --no-deps -T --user root --volume "$backup:/backup:ro" --volume "$(pwd)/scripts:/restore:ro" --entrypoint python backend \
    /restore/restore_archive.py "/backup/$kind.tar.gz" "$kind"
done
# Resolve the actual project volume rather than guessing a default Compose name.
mail_volume="$(docker compose config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["volumes"]["mail_data"]["name"])')"
docker compose stop frontend backend worker mailer mailpit
# Restore/migrate the database but defer writer startup until matching file state
# is back in place, preventing jobs or mail delivery against half-restored data.
bash scripts/restore_postgres.sh "$dump" --confirm-replace --keep-stopped
# The helper revalidates each archive before replacement and restores recorded
# ownership/ordinary permission bits. Trusted backups must match service identities.
docker compose run --rm --no-deps -T --user root --volume "$backup:/backup:ro" --volume "$(pwd)/scripts:/restore:ro" --entrypoint python backend \
  /restore/restore_archive.py /backup/widget-assets.tar.gz widget-assets --replace
# Mailpit must remain stopped while its persistent mailbox files are replaced.
docker compose run --rm --no-deps -T --user root --volume "$mail_volume:/mail" --volume "$backup:/backup:ro" --volume "$(pwd)/scripts:/restore:ro" --entrypoint python backend \
  /restore/restore_archive.py /backup/mail.tar.gz mail --replace
# Compose startup is followed by the runbook's actual health/persistence and user
# workflow checks; launching containers alone does not prove restored correctness.
docker compose up -d
printf 'Restore complete. Verify login, knowledge retrieval, widget logo, cases and local mail.\n'
