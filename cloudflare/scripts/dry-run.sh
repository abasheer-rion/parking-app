#!/bin/bash
# Loads the property's start page once in Cloudflare Browser Run and reads the property dropdown.
# It fills nothing and clicks nothing. Runs the Worker with "wrangler dev --remote" and fires its
# cron handler once with DRY_RUN_ONCE set. Registrations stay paused during the run.
# Uses about 5 to 15 seconds of the 10 free browser minutes a day.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${CLOUDFLARE_API_TOKEN:=$(vault get cloudflare-api-token)}"
export CLOUDFLARE_API_TOKEN
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-ba15337853352a33fd60d311715146c1}"
PORT="${PORT:-8799}"
STAMP="dry-$(date +%s)"
LOG="$(mktemp)"

npx wrangler dev --remote --test-scheduled --ip 127.0.0.1 --port "$PORT" \
  --var "DRY_RUN_ONCE:$STAMP" --var "PAUSE_REGISTRATIONS:1" >"$LOG" 2>&1 &
DEV=$!
trap 'kill $DEV 2>/dev/null || true' EXIT

for _ in $(seq 1 90); do
  grep -q "Ready on" "$LOG" && break
  sleep 1
done
grep -q "Ready on" "$LOG" || { echo "wrangler dev did not start:"; tail -20 "$LOG"; exit 1; }

curl -s -m 120 "http://127.0.0.1:$PORT/__scheduled" >/dev/null || true
for _ in $(seq 1 60); do
  grep -q "\[dry run\]" "$LOG" && break
  sleep 1
done
grep "\[dry run\]" "$LOG" | sed 's/^.*\[dry run\] //' || { echo "No result. Log:"; tail -30 "$LOG"; exit 1; }
