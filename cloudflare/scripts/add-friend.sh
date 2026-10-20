#!/bin/bash
# Adds a friend to D1 and prints their private link, like "python app.py add-friend".
# Usage: scripts/add-friend.sh "Name" [--remote|--local] [--save FILE]
#   --save FILE writes the link to FILE (mode 600) instead of printing it.
set -euo pipefail
cd "$(dirname "$0")/.."
NAME="${1:?usage: add-friend.sh \"Name\" [--remote|--local] [--save FILE]}"
shift
MODE=(--local)
SAVE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --remote|--local) MODE=("$1") ;;
    --save) SAVE="$2"; shift ;;
    *) echo "Unknown option $1"; exit 1 ;;
  esac
  shift
done
if [[ "${MODE[0]}" == "--remote" ]]; then
  : "${CLOUDFLARE_API_TOKEN:=$(vault get cloudflare-api-token)}"
  export CLOUDFLARE_API_TOKEN
  export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-ba15337853352a33fd60d311715146c1}"
fi
TOKEN="$(node -e 'process.stdout.write(require("crypto").randomBytes(12).toString("base64url"))')"
SQL_NAME="${NAME//\'/\'\'}"
npx wrangler d1 execute parking-app "${MODE[@]}" --yes \
  --command "INSERT INTO friends(token,name) VALUES('$TOKEN','$SQL_NAME')" >/dev/null
LINK="${BASE_URL:-https://parking.endyland.com}/u/$TOKEN"
if [[ -n "$SAVE" ]]; then
  (umask 077; printf '%s\n' "$LINK" > "$SAVE")
  echo "$NAME: link saved to $SAVE"
else
  echo "$NAME: $LINK"
fi
