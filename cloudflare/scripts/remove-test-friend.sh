#!/bin/bash
# Removes the one seeded test friend (token in .test-token) and its rows from the remote D1 database.
# Touches nothing else: every statement is scoped to that friend's id.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .test-token ]] || { echo "No .test-token, nothing to remove"; exit 0; }
TOKEN=$(sed -E 's#.*/u/##; s#[^A-Za-z0-9_-]##g' .test-token | head -1)
[[ ${#TOKEN} -ge 8 ]] || { echo "Test token looks wrong, stopping"; exit 1; }
CLOUDFLARE_API_TOKEN="$(vault get cloudflare-deploy-token)"
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-ba15337853352a33fd60d311715146c1}"
F="(SELECT id FROM friends WHERE token = '$TOKEN')"
npx wrangler d1 execute parking-app --remote --command "DELETE FROM jobs WHERE friend_id = $F; DELETE FROM profiles WHERE friend_id = $F; DELETE FROM friends WHERE token = '$TOKEN';" >/dev/null
echo "test friend removed"
npx wrangler d1 execute parking-app --remote --json --command "SELECT (SELECT COUNT(*) FROM friends) f, (SELECT COUNT(*) FROM profiles) p, (SELECT COUNT(*) FROM jobs) j" | python3 -c 'import json,sys; r=json.load(sys.stdin)[0]["results"][0]; print("remaining: friends", r["f"], "profiles", r["p"], "jobs", r["j"])'
