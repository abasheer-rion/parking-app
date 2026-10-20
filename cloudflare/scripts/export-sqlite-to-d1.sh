#!/bin/bash
# Turns the Mac app's SQLite data into SQL that D1 can load.
# Usage: scripts/export-sqlite-to-d1.sh [path/to/data.db] [out.sql]
# Works on a copy: the live data.db is only opened read-only for sqlite3 .backup.
# QR files named in jobs.qr_path are read into jobs.qr_png as hex blobs.
# Output has rows only (friends, profiles, jobs). The tables come from migrations/.
set -euo pipefail

SRC="${1:-$HOME/parking-app/data.db}"
OUT="${2:-d1-import.sql}"
[[ -f "$SRC" ]] || { echo "No database at $SRC"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT      # the copy holds personal data, do not leave it behind
COPY="$TMP/copy.db"
sqlite3 -readonly "$SRC" ".backup '$COPY'"

# Older copies may lack columns the app added later. Add them so every row has the same shape.
for col in "confirmation TEXT" "qr_path TEXT" "who TEXT" "next_try REAL" "qr_png BLOB"; do
  sqlite3 "$COPY" "ALTER TABLE jobs ADD COLUMN $col" 2>/dev/null || true
done
# qr_path may be relative to the app folder, so read files from there.
(cd "$(dirname "$SRC")" && sqlite3 "$COPY" \
  "UPDATE jobs SET qr_png = readfile(qr_path) WHERE qr_path IS NOT NULL AND qr_path <> '' AND qr_png IS NULL")

# One INSERT per row, each on one line. Newlines inside text become char(10), so nothing
# depends on the sqlite3 version's .dump format (newer ones use unistr(), which D1 may lack).
# Only our three tables: sqlite_* tables, BEGIN/COMMIT and CREATE lines never appear.
: > "$OUT"
for t in friends profiles jobs; do
  cols="$(sqlite3 "$COPY" "SELECT group_concat(name, ',') FROM (SELECT name FROM pragma_table_info('$t') ORDER BY cid)")"
  [[ -n "$cols" ]] || { echo "Table $t is missing in $SRC"; exit 1; }
  vals="$(sqlite3 "$COPY" "SELECT group_concat(
      'replace(replace(quote(' || name || '), char(13), ''''''' || ' || char(13) || ' || '''''''), char(10), ''''''' || ' || char(10) || ' || ''''''')',
      ' || '','' || ') FROM (SELECT name FROM pragma_table_info('$t') ORDER BY cid)")"
  sqlite3 "$COPY" "SELECT 'INSERT INTO $t($cols) VALUES(' || $vals || ');' FROM $t ORDER BY rowid" >> "$OUT"
done

echo "Wrote $OUT"
for t in friends profiles jobs; do
  echo "  $t: $(sqlite3 "$COPY" "SELECT count(*) FROM $t") rows"
done
echo "  QR images: $(sqlite3 "$COPY" "SELECT count(*) FROM jobs WHERE qr_png IS NOT NULL")"
echo "The file holds personal data. Keep it out of git and delete it after the import."
