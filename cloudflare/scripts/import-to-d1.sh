#!/bin/bash
# Loads SQL from export-sqlite-to-d1.sh into the parking-app D1 database.
# Usage:
#   scripts/import-to-d1.sh d1-import.sql --local [--persist-to DIR]   # try it on a local copy first
#   scripts/import-to-d1.sh d1-import.sql --remote                     # the real D1, asks first
# Refuses if the target already has rows, unless FORCE=1 (ids would clash).
# Before --remote: delete the test friend (see README), and keep PAUSE_REGISTRATIONS=1 until cutover.
set -euo pipefail
cd "$(dirname "$0")/.."

FILE="${1:?usage: import-to-d1.sh file.sql --local|--remote [--persist-to DIR]}"
shift
[[ -f "$FILE" ]] || { echo "No file $FILE"; exit 1; }
MODE=("$@")
[[ ${#MODE[@]} -gt 0 ]] || MODE=(--local)

if [[ " ${MODE[*]} " == *" --remote "* ]]; then
  CLOUDFLARE_API_TOKEN="$(vault get cloudflare-deploy-token)"
  export CLOUDFLARE_API_TOKEN
  export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-ba15337853352a33fd60d311715146c1}"
  if [[ "${YES:-}" != "1" ]]; then
    read -r -p "Load $FILE into the live parking-app D1? Type import: " answer
    [[ "$answer" == "import" ]] || { echo "Stopped."; exit 1; }
  fi
fi

count() {
  npx wrangler d1 execute parking-app "${MODE[@]}" --json --command \
    "SELECT (SELECT count(*) FROM friends) AS friends, (SELECT count(*) FROM profiles) AS profiles, (SELECT count(*) FROM jobs) AS jobs, (SELECT count(*) FROM jobs WHERE qr_png IS NOT NULL) AS qr" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s)[0].results[0];console.log(JSON.stringify(r))})'
}

before="$(count)"
echo "Before: $before"
if [[ "$before" != '{"friends":0,"profiles":0,"jobs":0,"qr":0}' && "${FORCE:-}" != "1" ]]; then
  echo "The database is not empty. Clear it or set FORCE=1."
  exit 1
fi
npx wrangler d1 execute parking-app "${MODE[@]}" --file "$FILE" --yes >/dev/null
echo "After:  $(count)"
