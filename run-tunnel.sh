#!/bin/zsh
# Runs the named tunnel for parking.endyland.com. The tunnel token is fetched at start
# from Cloudflare using the vault's API token, so it is never written to disk.
ACCT=ba15337853352a33fd60d311715146c1
TID=17b16696-2dea-4e93-8e17-73595e0db5e8
export PATH=/opt/homebrew/bin:/usr/bin:/bin
TOKEN=$({ printf 'header = "Authorization: Bearer '; vault get cloudflare-api-token; printf '"\n'; } \
  | curl -s -m 30 -K - "https://api.cloudflare.com/client/v4/accounts/$ACCT/cfd_tunnel/$TID/token" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['result'])")
[ -z "$TOKEN" ] && { echo "could not fetch tunnel token"; exit 1; }
export TUNNEL_TOKEN="$TOKEN"
exec cloudflared tunnel --no-autoupdate run
