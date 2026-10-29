# Park With Love on Cloudflare

The same parking app as `../app.py`, running as a Cloudflare Worker so it does not need the Mac.
Same pages, same forms, same emails, same renewal rules. The Mac app is still the live one until cutover.

- Site: Worker `parking-app`, now at https://parking-app.ayanbasheer.workers.dev (no preview URLs).
- Data: D1 database `parking-app` (friends, profiles, jobs, plus QR images as blobs).
- Renewals: a cron runs every minute and drives the property's form in Cloudflare Browser Run.
- Email: the owner's Gmail over SMTP on port 465, like the Mac app.

Registrations are paused (`PAUSE_REGISTRATIONS` is `"1"` in `wrangler.jsonc`) so the Worker and the Mac
never both register the same car. Only the cutover turns it on.

## Layout

- `src/routes.ts`: every `/u/<token>` route, `/robots.txt`, 404 elsewhere, the same security headers.
- `src/page.ts`, `src/emails.ts`: the page and email HTML, copied from the Flask app.
- `src/scheduler.ts`: the renewal rules from `app.py`.
- `src/browser.ts`: the form steps from `worker.py`, using `@cloudflare/playwright`.
- `src/gate.ts`: free plan browser limits (1 new browser per 20 seconds, daily minutes).
- `src/smtp.ts`, `src/mail.ts`: a small Gmail SMTP client.
- `src/time.ts`: all property times are America/Chicago, with daylight saving handled.
- `migrations/`: the D1 tables. `scripts/`: secrets, friends, dry run, data move.
- `test/`: runs in workerd with a local D1 and a fake browser. `test/setup.ts` swaps out the real
  browser binding, so no test can open the property's site. `test/golden/` holds pages and emails
  rendered by the Flask app; the tests check the Worker's output matches them exactly.

## How it differs from the Mac app

- A new registration from the page waits for the next cron run, up to a minute. The page shows
  "Saving your spot now" and refreshes itself, as before.
- QR images live in D1, not in `logs/`. No result screenshots are kept.
- Only one cron run drives the browser at a time (a lock in D1).
- A "Done staying" press while a registration is running is no longer undone by it.
- A registration counts as done only when the Results page shows both the code and the QR.
  The Mac app needed only the code. A code with no QR now retries in 10 minutes.
- If the free daily browser time runs out, renewals wait for 00:00 UTC (7 PM in Austin, 6 PM in winter)
  instead of counting as failures.
- To add a friend: `scripts/add-friend.sh "Name" --remote`. It prints the link.

## Free plan limits

- 10 ms CPU per request or cron run. Measured: pages 1 to 9 ms, an idle cron run 3 ms.
- 10 browser minutes a day, 3 browsers at once, 1 new browser per 20 seconds.
- Measured dry run (load the start page only): 7 seconds of browser time and 157 ms of CPU.
  Cloudflare let it finish, but it is well over 10 ms. A full registration has 8 steps and will use more.
  If renewals fail with "exceeded CPU" in the logs, move to Workers Paid ($5 a month, 30 s CPU).
  Nothing else needs to change.

## Develop and test

    npm ci --include=dev       # this Mac's npm config skips dev packages otherwise

Every package in `package-lock.json`, not only the ones in `package.json`, is at least 2 weeks old.
To change a package, keep it that way: `npm install --before=YYYY-MM-DD --include=dev`, with a date
2 weeks back.
    npx tsc --noEmit
    npx vitest run

To refresh the golden files after changing the Flask app's HTML or emails, use any Python with Flask:

    TZ=America/Chicago PYTHONDONTWRITEBYTECODE=1 python3 scripts/make-golden.py

## Deploy

A push to `main` that changes `cloudflare/` deploys it: `.github/workflows/deploy.yml` installs,
typechecks, tests, applies D1 migrations, then runs `wrangler deploy`. It needs `CLOUDFLARE_API_TOKEN`
(secret) and `CLOUDFLARE_ACCOUNT_ID` (variable) in the GitHub environment `cloudflare`. Until the
token is set it skips with a notice. The owner sets it with `platform/github/owner-set-secrets.sh`
in endyland-infra. Every deploy uses `wrangler.jsonc` as it is on `main`, routes included.

By hand, only if the pipeline is down:

    export CLOUDFLARE_ACCOUNT_ID=ba15337853352a33fd60d311715146c1
    export CLOUDFLARE_API_TOKEN="$(vault get cloudflare-api-token)"
    npx wrangler d1 migrations apply parking-app --remote
    npx wrangler deploy

## Secrets

Run once, yourself: `scripts/set-secrets.sh`. It reads `GMAIL_USER`, `GMAIL_APP_PASSWORD` and, if
present, `NOTIFY_ALSO` from `../.env.sh` and pipes each into `wrangler secret put`. Nothing is printed.
Without them the Worker logs "mail skipped" and carries on.

`FROM_NAME`, `MAX_DAYS` and `MAX_NEW_PAGES` are plain settings in `wrangler.jsonc`. `PROPERTY` and `UNIT` (fallback for
pages made before public sign-up) are Worker secrets: `npx wrangler secret put PROPERTY`.

## Dry run

`scripts/dry-run.sh` loads the property's start page once in Browser Run and lists the property
dropdown. It fills nothing and clicks nothing. It runs the Worker with `wrangler dev --remote` and
fires its cron handler with `DRY_RUN_ONCE` set. There is no public route for it.
Last result (2026-10-20): 97 options, the property was found, 2.4 browser seconds.

## Test friend

One test friend, "Worker Test (not a real person)", is in the remote D1. Its private link is in
`cloudflare/.test-token` (mode 600, not in git). Delete it before importing real data:

    npx wrangler d1 execute parking-app --remote --command "DELETE FROM friends WHERE name='Worker Test (not a real person)'"

## Moving the data

1. `scripts/export-sqlite-to-d1.sh ~/parking-app/data.db /tmp/parking.sql` copies `data.db` with
   `sqlite3 .backup` (the live file is opened read-only), reads each QR file into the row, and writes
   one INSERT per row. The file holds personal data. Delete it after the import.
2. Try it on a local D1 first:
   `npx wrangler d1 migrations apply parking-app --local` then
   `scripts/import-to-d1.sh /tmp/parking.sql --local`.
3. Then `scripts/import-to-d1.sh /tmp/parking.sql --remote`. It asks first and refuses a non-empty database.

## Cutover

Not before 23:35 on 2026-10-20.

1. Pick a time with no renewal due in the next 30 minutes (`scripts/update.sh` in the parent folder
   shows how to check).
2. Run `scripts/set-secrets.sh`.
3. Stop the Mac app and its tunnel. Both plists have `KeepAlive`, so killing the process is not enough:
   launchd starts it again. Unload both, then move the plists out so they do not come back at login:

       launchctl bootout gui/$(id -u)/com.endyland.parking-app
       launchctl bootout gui/$(id -u)/com.endyland.parking-tunnel
       mkdir -p ~/parking-app/launchd/disabled
       mv ~/Library/LaunchAgents/com.endyland.parking-app.plist \
          ~/Library/LaunchAgents/com.endyland.parking-tunnel.plist ~/parking-app/launchd/disabled/
       launchctl list | grep com.endyland.parking    # should print nothing

   Leave the app files, `data.db` and the tunnel config in place.
4. Move the data (above), after deleting the test friend.
5. In `wrangler.jsonc`, set `PAUSE_REGISTRATIONS` to `"0"` and add the route:

       "routes": [{ "pattern": "parking.endyland.com/*", "zone_name": "endyland.com" }]

   Commit and push to `main`. The Deploy Worker workflow deploys it. The route sends
   parking.endyland.com to the Worker instead of the tunnel.
   The route must live in `wrangler.jsonc`, not only in the dashboard: every auto-deploy applies the
   routes in `wrangler.jsonc`, so this keeps it in place.
   The firewall rules already allow `/u/*` and `/robots.txt`, so nothing else changes. Links stay the same.
6. Open a friend link and check it. Watch `npx wrangler tail parking-app` around the next renewal.

## Rollback

1. Remove the route from `wrangler.jsonc` and set `PAUSE_REGISTRATIONS` back to `"1"`. Commit and push
   to `main`. If the pipeline is slow or down, also delete the route in the dashboard
   (Workers, `parking-app`, Settings, Domains and Routes). Deleting it only in the dashboard is not
   enough: the next deploy from `main` puts it back if it is still in `wrangler.jsonc`.
2. Put the plists back and start both:

       mv ~/parking-app/launchd/disabled/com.endyland.parking-app.plist \
          ~/parking-app/launchd/disabled/com.endyland.parking-tunnel.plist ~/Library/LaunchAgents/
       launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.endyland.parking-app.plist
       launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.endyland.parking-tunnel.plist
       launchctl list | grep com.endyland.parking    # both listed

   The tunnel serves the site again once the route is gone.

Keep the Mac app stopped but in place for a week. Its data is frozen at the cutover, so after a
rollback, anything people changed on the Worker in between has to be entered again.

## Backups and restore

Nightly: `.github/workflows/backup.yml` runs at 08:15 UTC, exports D1 with
`wrangler d1 export parking-app --remote`, gzips it and keeps it as a private artifact for 30 days.
It needs `CLOUDFLARE_API_TOKEN` as a secret in the GitHub environment `cloudflare`
(a token with Account, D1, Edit). Until then it skips with a notice.
The owner sets it with `platform/github/owner-set-secrets.sh` in endyland-infra.

Time Travel (D1's built-in undo, 7 days on the free plan, 30 on paid):

    npx wrangler d1 time-travel info parking-app                         # current bookmark
    npx wrangler d1 time-travel info parking-app --timestamp=2026-10-20T18:00:00-05:00
    npx wrangler d1 time-travel restore parking-app --timestamp=UNIX_TIMESTAMP

A restore overwrites the database in place and prints the previous bookmark. To undo it:
`npx wrangler d1 time-travel restore parking-app --bookmark=PREVIOUS_BOOKMARK`.
Set `PAUSE_REGISTRATIONS` to `"1"` and deploy before restoring, so no renewal runs in between.

From a nightly artifact: download it from the Actions run, then

    gunzip parking-app-*.sql.gz
    npx wrangler d1 create parking-app-restore
    npx wrangler d1 execute parking-app-restore --remote --file parking-app-*.sql

Check the rows, then point `database_id` in `wrangler.jsonc` at the new database and deploy.
