#!/usr/bin/env bash
# Starts the Rust API, waits until it answers, then starts the web server on the public port.
# Fly wakes a stopped machine on the first request; the public port only opens once the API is warm.
set -euo pipefail

PORT=8787 /app/that-invoice-api &
API=$!

for _ in $(seq 1 80); do
  if curl -fsS http://127.0.0.1:8787/healthz >/dev/null 2>&1; then break; fi
  if ! kill -0 "$API" 2>/dev/null; then echo "API exited during startup" >&2; exit 1; fi
  sleep 0.25
done

cd /app/web
PORT=3000 HOSTNAME=0.0.0.0 node apps/web/server.js &
WEB=$!

# Exit (and let Fly restart the machine) if either process dies.
wait -n "$API" "$WEB"
exit 1
