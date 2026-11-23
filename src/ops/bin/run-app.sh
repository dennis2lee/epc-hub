#!/bin/sh
# launchd entry point for the Next.js server (org.epcsj-hub.app.plist).
set -eu
. "$(dirname "$0")/common.sh"
load_env "$CHURCH_HOME/app.env"
cd "$CHURCH_HOME/current"
exec node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000
