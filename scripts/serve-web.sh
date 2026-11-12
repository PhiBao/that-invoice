#!/usr/bin/env bash
# Serve the production build of the web app (expects the API on :8787).
cd "$(dirname "$0")/../apps/web" || exit 1
export API_URL="${API_URL:-http://localhost:8787}"
exec pnpm exec next start -p "${PORT:-3000}"
