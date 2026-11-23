#!/bin/sh
# Nightly backup (org.epcsj-hub.backup, 03:30, D44/D47): encrypted dump +
# receipts, copied to the church Google Drive with rclone.
# - daily/: 31 days. monthly/: the first good backup of each month, 7 years
#   (pruning monthly/ is a manual, board-approved step).
# - Deletions on Drive go to its trash (30 days), so a mistake or a compromised
#   Mac cannot erase history at once.
set -eu
. "$(dirname "$0")/common.sh"
load_env "$CHURCH_HOME/backup.env"
remote="${BACKUP_REMOTE:?set BACKUP_REMOTE, e.g. church-drive:epc-hub-backup}"
stamp=$(date +%F)
month=$(date +%Y-%m)
out="$CHURCH_HOME/backups/backup-$stamp"
mkdir -p "$CHURCH_HOME/backups"
cd "$CHURCH_HOME/current"

status=0
BACKUP_DIR="$out" SUPABASE_DIR="$CHURCH_HOME/supabase" BACKUP_COUNT_FILE="$CHURCH_HOME/backups/receipt-count" \
  RELEASE_SHA="$(cat .release 2>/dev/null || basename "$PWD")" node src/scripts/backup.mjs || status=$?
file="$out.tar.age"
if [ "$status" -ne 0 ] && [ "$status" -ne 3 ]; then
  echo "$(date '+%F %T') backup FAILED ($status)" >&2
  ping_health "${HEALTHCHECK_BACKUP_URL:+$HEALTHCHECK_BACKUP_URL/fail}"
  exit 1
fi

rclone copyto "$file" "$remote/daily/backup-$stamp.tar.age"
# First good backup of the month goes to monthly/ (not only on the 1st, so a
# day the Mac was off does not lose the month).
if [ "$status" -eq 0 ] && [ -z "$(rclone lsf "$remote/monthly" --include "backup-$month-*" 2>/dev/null)" ]; then
  rclone copyto "$file" "$remote/monthly/backup-$stamp.tar.age"
fi
rclone delete --min-age 31d "$remote/daily"

# Keep the last 3 local copies for a quick restore.
ls -1t "$CHURCH_HOME"/backups/*.tar.age 2>/dev/null | tail -n +4 | while read -r old; do rm -f "$old"; done

if [ "$status" -eq 3 ]; then
  echo "$(date '+%F %T') backup uploaded but receipts are missing or damaged" >&2
  ping_health "${HEALTHCHECK_BACKUP_URL:+$HEALTHCHECK_BACKUP_URL/fail}"
  exit 1
fi
echo "$(date '+%F %T') backup ok $stamp"
ping_health "${HEALTHCHECK_BACKUP_URL:-}"
