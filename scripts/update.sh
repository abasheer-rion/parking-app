#!/bin/zsh
# Deploy on the Mac: pull the latest code, install deps, check it compiles, restart the app.
# Refuses if the folder has local changes, or if a renewal is running or due in the next 10 minutes.
set -euo pipefail
cd "$(dirname "$0")/.."

LABEL="com.endyland.parking-app"
TARGET="gui/$(id -u)/$LABEL"
# Load the same settings the app uses, so PORT and PARKING_DB match.
[[ -f .env.sh ]] && source .env.sh
URL="http://127.0.0.1:${PORT:-8080}/robots.txt"
DBFILE="${PARKING_DB:-data.db}"

# PIDs of this folder's app.py only. Other projects may also run an app.py.
app_pids() {
  local p
  for p in $(pgrep -f "Python app.py" || true); do
    [[ "$(lsof -a -p "$p" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')" == "$PWD" ]] && echo "$p"
  done
  return 0
}

# Jobs the app will try to register in the next 10 minutes, or is registering now.
# Mirrors the scheduler in app.py: it runs once a permit has expired, more days remain,
# and the retry time has come. A job with no expiry yet is a first registration in progress.
renewal_busy() {
  if [[ ! -f "$DBFILE" ]]; then
    # No database yet is fine on a fresh install. A set PARKING_DB that points nowhere is not.
    [[ -z "${PARKING_DB:-}" ]] && return 1
    echo "PARKING_DB is set but $DBFILE does not exist, not restarting to be safe."
    return 0
  fi
  local soon=$(( $(date +%s) + 600 ))
  local rows
  if ! rows=$(sqlite3 -readonly "$DBFILE" "SELECT id, plate, status, COALESCE(datetime(expires_ts,'unixepoch','localtime'),'not yet')
      FROM jobs WHERE status IN ('pending','active')
      AND (expires_ts IS NULL OR (expires_ts <= $soon AND end_ts - expires_ts > 1800))
      AND COALESCE(next_try, 0) <= $soon;"); then
    echo "Could not read $DBFILE, not restarting to be safe."
    return 0
  fi
  [[ -z "$rows" ]] && return 1
  echo "Not restarting: a renewal is running or due within 10 minutes."
  echo "Jobs (id|plate|status|expires):"
  echo "$rows"
  echo "Try again after it finishes."
  return 0
}

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing: the folder has local changes. Commit or stash them first."
  git status --short
  exit 1
fi

renewal_busy && exit 1

git pull --ff-only
.venv/bin/pip install -r requirements.txt -q
# A new playwright needs its matching browser, or every registration fails.
.venv/bin/playwright install chromium
.venv/bin/python3 -m py_compile *.py

# Check again, in case one became due while installing.
renewal_busy && { echo "Code is updated but the app was not restarted."; exit 1; }

mkdir -p logs
if launchctl print "$TARGET" >/dev/null 2>&1; then
  echo "Restarting with launchd"
  launchctl kickstart -k "$TARGET"
else
  echo "Restarting by hand (no launchd agent loaded)"
  old=($(app_pids))
  (( ${#old} )) && kill "${old[@]}" 2>/dev/null || true
  for _ in {1..20}; do
    [[ -z "$(app_pids)" ]] && break
    sleep 1
  done
  if [[ -n "$(app_pids)" ]]; then
    echo "Old app did not stop. Not starting a second copy."
    exit 1
  fi
  nohup .venv/bin/python3 app.py >> logs/app.log 2>&1 &
fi

for _ in {1..20}; do
  if [[ "$(curl -s -o /dev/null -w '%{http_code}' "$URL" || true)" == "200" ]]; then
    echo "App is up: $URL"
    exit 0
  fi
  sleep 1
done
echo "App did not answer within 20 seconds. Check logs/app.log"
exit 1
