#!/bin/sh
# Restore a nightly backup into a FRESH, EMPTY self-hosted stack (D44, D47).
# Used for the quarterly restore drill (on another Mac) and after losing the
# Mac mini.
#
#   sh restore.sh <backup-YYYY-MM-DD.tar.age> <age key file>
#
# Before: install and start an empty stack (src/ops/supabase/install.sh,
# start.sh) at the Supabase version in the backup's supabase-version.txt, and
# deploy the release in release.txt; keep the app stopped.
#
# Guards: refuses on a machine whose app.env says APP_ENV=production unless
# RESTORE_TARGET_OK is set to this machine's hostname; refuses if the database
# has any people, logins or claims; refuses on a version mismatch unless
# ALLOW_VERSION_MISMATCH=1. The data load is one transaction.
set -eu
. "$(dirname "$0")/common.sh"
load_env "$CHURCH_HOME/backup.env"
[ $# -eq 2 ] || { echo "usage: restore.sh <backup.tar.age> <age key file>" >&2; exit 1; }
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
# supabase_admin: the only superuser in the official image (needed to load
# auth and storage tables and to turn triggers off for the load).
psql_db() { docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -q -U supabase_admin -d postgres "$@"; }

if grep -q '^APP_ENV=production' "$CHURCH_HOME/app.env" 2>/dev/null && [ "${RESTORE_TARGET_OK:-}" != "$(hostname -s)" ]; then
  echo "refusing: this is the production server. Set RESTORE_TARGET_OK=$(hostname -s) only if you really mean to restore here." >&2
  exit 1
fi

work=$(mktemp -d "$CHURCH_HOME/restore.XXXXXX")
trap 'rm -rf "$work"' EXIT
age -d -i "$2" "$1" | tar -x -C "$work"
dir=$(ls -d "$work"/backup-*)

backup_release=$(cat "$dir/release.txt" 2>/dev/null || echo unknown)
running_release=$(cat "$CHURCH_HOME/current/.release" 2>/dev/null || basename "$(readlink "$CHURCH_HOME/current")")
backup_supabase=$(cat "$dir/supabase-version.txt" 2>/dev/null || echo unknown)
running_supabase=$(cat "$CHURCH_HOME/supabase/.supabase-version" 2>/dev/null || echo unknown)
echo "backup: release $backup_release, supabase $backup_supabase"
echo "here:   release $running_release, supabase $running_supabase"
if [ "${ALLOW_VERSION_MISMATCH:-}" != "1" ]; then
  [ "$backup_supabase" = "$running_supabase" ] || { echo "refusing: Supabase version differs" >&2; exit 1; }
  case "$running_release" in "$backup_release"*|"$(printf '%s' "$backup_release" | cut -c1-12)"*) ;;
    *) echo "refusing: deploy release $backup_release first (or ALLOW_VERSION_MISMATCH=1)" >&2; exit 1 ;; esac
fi

# 1. Schema: the migrations of the running release (forward only, D8).
#    ASSUME_YES=1 skips the CLI's confirmation (drills on a throwaway stack).
cd "$CHURCH_HOME/current"
npx --no-install supabase db push --workdir src --remote="$BACKUP_DB_URL" ${ASSUME_YES:+--yes}
used=$(psql_db -tAc "select (select count(*) from public.people) + (select count(*) from auth.users) + (select count(*) from public.claims)")
[ "$used" = "0" ] || { echo "refusing: the database is not empty ($used rows in people, logins, claims)" >&2; exit 1; }

# 2. Data, in one transaction: empty every table the dump fills (migrations
#    seed a few rows, e.g. settings and the receipts bucket), then load it with
#    triggers off so the audit and append-only guards do not fire on history.
tables=$(grep -oE '^COPY "[a-z_]+"\."[a-z_0-9]+"' "$dir/data.sql" | cut -d' ' -f2 | sort -u | paste -sd, -)
{
  echo "SET session_replication_role = replica;"
  echo "TRUNCATE $tables RESTART IDENTITY CASCADE;"
  cat "$dir/data.sql"
  echo "SET session_replication_role = origin;"
} | psql_db --single-transaction
echo "database restored"

# 3. Receipt files at their original storage paths.
node src/scripts/restore-receipts.mjs "$dir/receipts"

psql_db -tAc "select 'people', count(*) from public.people union all select 'claims', count(*) from public.claims
  union all select 'attachments', count(*) from public.attachments union all select 'payments', count(*) from public.payments
  union all select 'audit_logs', count(*) from public.audit_logs union all select 'auth.users', count(*) from auth.users
  union all select 'objects', count(*) from storage.objects"
echo "restore done: open a few claims and check their receipts before starting the app"
