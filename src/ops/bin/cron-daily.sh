#!/bin/sh
# launchd entry point for the daily check (org.epcsj-hub.cron.plist): calls
# /api/cron/daily on the local server. Repeats are harmless (D26, D39).
set -eu
. "$(dirname "$0")/common.sh"
load_env "$CHURCH_HOME/app.env"
status=$(curl -s -o /dev/null -w '%{http_code}' -m 60 -H "Authorization: Bearer $CRON_SECRET" \
  http://127.0.0.1:3000/api/cron/daily)
echo "$(date '+%F %T') cron-daily $status"
if [ "$status" = "200" ]; then ping_health "${HEALTHCHECK_CRON_URL:-}"; else exit 1; fi
