#!/bin/sh
# One command to run on the host: install if needed, build the UI if needed, preflight, start.
#   ./scripts/run.sh          (then open http://localhost:4771/)
set -e
cd "$(dirname "$0")/.."
[ -d node_modules ] || npm ci
[ -f web/dist/index.html ] || npm run build
npm run doctor
exec npm start
