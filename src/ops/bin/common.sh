# Shared settings for the Mac mini scripts. Sourced, not executed.
# CHURCH_HOME holds: app.env, deploy.env, backup.env (all mode 600), repo/,
# releases/, current -> releases/<release>, previous, supabase/, backups/, logs/.
CHURCH_HOME="${CHURCH_HOME:-$HOME/church}"
# node@24 is keg-only in Homebrew, so its bin directory must come first.
# OPS_PATH_PREFIX exists only for rehearsals on a developer Mac (stand-ins for
# sudo/launchctl); it is never set on the Mac mini.
export PATH="${OPS_PATH_PREFIX:+$OPS_PATH_PREFIX:}/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
umask 077

# Read KEY=VALUE lines literally (no shell evaluation), so values may contain
# spaces, <, >, &, $ or # (e.g. MAIL_FROM=교회 지출청구 <no-reply@…>).
# Blank lines and lines starting with # are skipped. Matching surrounding
# quotes are removed.
load_env() {
  f="$1"
  [ -f "$f" ] || { echo "missing $f" >&2; exit 1; }
  [ "$(stat -f %Lp "$f")" = "600" ] || { echo "refusing: $f must be mode 600" >&2; exit 1; }
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    key=${line%%=*}
    val=${line#*=}
    case "$key" in *[!A-Za-z0-9_]*|'') echo "bad line in $f: ${key}" >&2; exit 1 ;; esac
    case "$val" in \"*\") val=${val#\"}; val=${val%\"} ;; \'*\') val=${val#\'}; val=${val%\'} ;; esac
    export "$key=$val"
  done < "$f"
}

# Optional dead man's switch (e.g. healthchecks.io): a missed ping alerts the
# tech contacts by email even when the Mac itself is down. "/fail" reports a
# failure at once.
ping_health() {
  url="$1"
  [ -n "$url" ] && curl -fsS -m 10 --retry 3 "$url" >/dev/null 2>&1 || true
}
