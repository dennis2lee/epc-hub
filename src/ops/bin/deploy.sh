#!/bin/sh
# Deploy a commit of main to the Mac mini (D41, D47). Run by hand by the tech
# contact (asks for the admin password to restart the app service).
#
#   sh deploy.sh              # deploy origin/main (CI must have passed)
#   sh deploy.sh <commit>     # deploy a commit that is on origin/main
#   sh deploy.sh --rollback   # switch back to the previous good release
#                             # (app only; migrations are never rolled back)
#
# Order: build a new release folder (the running app is untouched) → apply
# migrations (forward-only and additive, D8, so the old app keeps working) →
# switch "current" → restart → health check → on failure switch back.
set -eu
. "$(dirname "$0")/common.sh"
REPO="$CHURCH_HOME/repo"
REL="$CHURCH_HOME/releases"
SERVICE="system/org.epcsj-hub.app"
mkdir -p "$REL"

restart_app() {
  launchctl print "$SERVICE" >/dev/null 2>&1 || {
    echo "the app service is not installed; see doc/deploy.md 6장" >&2
    return 1
  }
  sudo launchctl kickstart -k "$SERVICE"
}

healthy() {
  for _ in $(seq 1 20); do
    sleep 3
    if curl -fsS -m 5 -o /dev/null http://127.0.0.1:3000/api/health; then return 0; fi
  done
  return 1
}

switch_to() {
  ln -sfn "$1" "$CHURCH_HOME/current"
}

if [ "${1:-}" = "--rollback" ]; then
  prev=$(readlink "$CHURCH_HOME/previous" 2>/dev/null || true)
  [ -n "$prev" ] && [ -f "$prev/.ok" ] || { echo "no previous good release" >&2; exit 1; }
  now=$(readlink "$CHURCH_HOME/current")
  switch_to "$prev"
  ln -sfn "$now" "$CHURCH_HOME/previous"
  restart_app
  healthy && echo "rolled back to $(basename "$prev")" || { echo "rolled back, but the app is not healthy" >&2; exit 1; }
  exit 0
fi

# Fail closed: no CI check, no deploy.
command -v gh >/dev/null || { echo "refusing: gh is not installed (needed to check CI)" >&2; exit 1; }
git -C "$REPO" fetch -q origin
sha=$(git -C "$REPO" rev-parse "${1:-origin/main}^{commit}")
git -C "$REPO" merge-base --is-ancestor "$sha" origin/main || { echo "refusing: $sha is not on origin/main" >&2; exit 1; }
short=$(printf '%s' "$sha" | cut -c1-12)
ci=$(gh run list -R dennis2lee/epc-hub --commit "$sha" --json conclusion -q '.[0].conclusion' 2>/dev/null || true)
[ "$ci" = "success" ] || { echo "refusing: CI for $short is '${ci:-unknown}'" >&2; exit 1; }

# A new folder every time, so redeploying the live commit never touches the
# running app.
dest="$REL/$short-$(date +%Y%m%d%H%M%S)"
mkdir -p "$dest"
git -C "$REPO" archive "$sha" | tar -x -C "$dest"
printf '%s\n' "$sha" > "$dest/.release"
cd "$dest"
# Dev dependencies are needed to build (TypeScript, Tailwind) and for the
# Supabase CLI used by migrations, backups and restores. Install without the
# app's secrets in the environment.
npm ci --include=dev --no-audit --no-fund
(load_env "$CHURCH_HOME/app.env"; npm run build)

# The DB admin URL lives in deploy.env, never in app.env.
(load_env "$CHURCH_HOME/deploy.env"; npx --no-install supabase db push --workdir src --remote="$DATABASE_ADMIN_URL")

old=$(readlink "$CHURCH_HOME/current" 2>/dev/null || true)
switch_to "$dest"
restart_app
if healthy; then
  touch "$dest/.ok"
  [ -n "$old" ] && ln -sfn "$old" "$CHURCH_HOME/previous"
  echo "deployed $short"
else
  echo "new release is not healthy; switching back" >&2
  if [ -n "$old" ]; then switch_to "$old"; restart_app; fi
  exit 1
fi

# Keep the last 5 releases, never the current or previous one.
cur=$(readlink "$CHURCH_HOME/current"); prv=$(readlink "$CHURCH_HOME/previous" 2>/dev/null || true)
ls -1dt "$REL"/*/ | sed 's:/$::' | tail -n +6 | while read -r d; do
  [ "$d" = "$cur" ] || [ "$d" = "$prv" ] || rm -rf "$d"
done
