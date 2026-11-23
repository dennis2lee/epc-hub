#!/bin/sh
# Start only the services the app uses (no realtime, edge functions or pooler).
# Usage: sh src/ops/supabase/start.sh [dir]     # default: ~/church/supabase
set -eu
DIR="${1:-$HOME/church/supabase}"
cd "$DIR"
[ "$(stat -f %Lp .env)" = "600" ] || { echo "refusing: .env must be mode 600" >&2; exit 1; }
grep -q '^SMTP_PASS=.\+' .env || { echo "refusing: SMTP_PASS is empty in .env" >&2; exit 1; }
docker compose up -d --wait db auth rest storage imgproxy meta studio api-gw
docker compose ps --format 'table {{.Service}}\t{{.Status}}\t{{.Ports}}'
