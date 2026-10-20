#!/bin/bash
# Copies the Gmail login from the Mac app's .env.sh into the Worker's secrets.
# Run it yourself: scripts/set-secrets.sh [path/to/.env.sh]
# Values go straight from the file into "wrangler secret put" through a pipe. Nothing is printed.
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE="${1:-../.env.sh}"
[[ -f "$ENV_FILE" ]] || { echo "No $ENV_FILE"; exit 1; }
: "${CLOUDFLARE_API_TOKEN:=$(vault get cloudflare-api-token)}"
export CLOUDFLARE_API_TOKEN
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-ba15337853352a33fd60d311715146c1}"

# NOTIFY_ALSO is optional. The app copies GMAIL_USER on every email when it is not set.
for name in GMAIL_USER GMAIL_APP_PASSWORD NOTIFY_ALSO; do
  if bash -c 'source "$1" >/dev/null 2>&1; [[ -n "${!2:-}" ]]' _ "$ENV_FILE" "$name"; then
    bash -c 'source "$1" >/dev/null 2>&1; printf "%s" "${!2}"' _ "$ENV_FILE" "$name" \
      | npx wrangler secret put "$name" >/dev/null
    echo "$name: set"
  else
    echo "$name: not in $ENV_FILE, skipped"
  fi
done
echo "Done. FROM_NAME, MAX_DAYS, PROPERTY and UNIT are plain settings in wrangler.jsonc."
