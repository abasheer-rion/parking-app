#!/bin/zsh
# Installs the app and tunnel as login agents so they start on boot and restart if they crash.
set -e
pkill -f "parking-app/.venv/bin/python3 app.py" 2>/dev/null || pkill -f "Python app.py" 2>/dev/null || true
pkill -f "cloudflared tunnel --url" 2>/dev/null || true
pkill -f "cloudflared tunnel --no-autoupdate run" 2>/dev/null || true
for n in parking-app parking-tunnel; do
  cp "$(dirname "$0")/com.endyland.$n.plist" ~/Library/LaunchAgents/
  launchctl bootout gui/$(id -u)/com.endyland.$n 2>/dev/null || true
  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.endyland.$n.plist
done
sleep 20
launchctl list | grep com.endyland
curl -s -o /dev/null -w "parking.endyland.com -> %{http_code}\n" https://parking.endyland.com/u/none
