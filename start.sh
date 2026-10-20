#!/usr/bin/env bash
# Starts the app and a temporary Cloudflare tunnel. Sets up the venv on first run.
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  python3 -m venv .venv
  .venv/bin/pip install -q flask playwright
  .venv/bin/playwright install chromium
fi
mkdir -p logs
[ -f .env.sh ] && source .env.sh
command -v cloudflared >/dev/null || { echo "Install cloudflared first: brew install cloudflared"; exit 1; }
nohup .venv/bin/python3 app.py > logs/app.log 2>&1 &
sleep 2
nohup cloudflared tunnel --url "http://localhost:${PORT:-8080}" > logs/tunnel.log 2>&1 &
sleep 10
grep -Eo "https://[a-z0-9-]+\.trycloudflare\.com" logs/tunnel.log | head -1
