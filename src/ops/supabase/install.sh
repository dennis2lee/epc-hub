#!/bin/sh
# Install the self-hosted Supabase stack on the church Mac mini (D41, D43).
#
# Usage (from the repo root, once):
#   sh src/ops/supabase/install.sh [target-dir]      # default: ~/church/supabase
#
# What it does:
#   1. Sparse-clones the official docker/ setup at a pinned release tag.
#   2. Copies it to the target directory with our compose override.
#   3. Generates unique secrets and API keys (official utils), merges our
#      non-secret settings, and locks .env to mode 600.
# It never starts the stack and never prints secrets. Fill SMTP_PASS and the
# KAKAO_* values in .env by hand, then run start.sh.
set -eu

SUPABASE_REF="self-hosted/v0.8.4"   # bump only after reading CHANGELOG.md
HERE="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:-$HOME/church/supabase}"

if [ -e "$TARGET/.env" ]; then
  echo "refusing: $TARGET/.env exists (secrets would be replaced)" >&2
  exit 1
fi
for bin in git docker node openssl jq; do
  command -v "$bin" >/dev/null || { echo "missing: $bin (brew install $bin)" >&2; exit 1; }
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git clone -q --depth 1 --branch "$SUPABASE_REF" --filter=blob:none --sparse \
  https://github.com/supabase/supabase.git "$work/src"
git -C "$work/src" sparse-checkout set docker >/dev/null

mkdir -p "$TARGET"
cp -R "$work/src/docker/." "$TARGET/"
printf '%s\n' "$SUPABASE_REF" > "$TARGET/.supabase-version"
cp "$HERE/docker-compose.church.yml" "$TARGET/docker-compose.church.yml"
cp "$TARGET/.env.example" "$TARGET/.env"
chmod 600 "$TARGET/.env"

cd "$TARGET"
# Official generators write unique values into .env (output discarded so
# secrets do not land in the terminal scrollback).
sh utils/generate-keys.sh --update-env >/dev/null
sh utils/add-new-auth-keys.sh --update-env >/dev/null
node "$HERE/merge-env.mjs" "$TARGET/.env" "$HERE/church.env"
chmod 600 "$TARGET/.env"
rm -f "$TARGET"/.env.old "$TARGET"/.env.bak

echo "installed $SUPABASE_REF into $TARGET"
echo "next: edit $TARGET/.env (SMTP_PASS, KAKAO_REST_API_KEY, KAKAO_CLIENT_SECRET), then:"
echo "  sh $HERE/start.sh $TARGET"
