# Handoff (as of 2026-10-29)

Read README.md first. This file is what is running, what is pending, and the decisions behind it.

## Running now (as of 2026-10-22)

- On the Cloudflare Worker `parking-app`, code in `cloudflare/`. Route `parking.endyland.com/*` is
  in `cloudflare/wrangler.jsonc`. Data is in D1 `parking-app` (copied from `data.db`: 1 friend,
  3 profiles, 2 jobs). Registrations are on.
- Deploys: push to `main`. The GitHub Actions "Deploy Worker" workflow does the rest (route went
  live in commit c1ec96a).
- Email: the Worker sends through Gmail SMTP with secrets `GMAIL_USER` and `GMAIL_APP_PASSWORD`.
- Backups: nightly D1 backups in GitHub Actions (`backup.yml`).
- The Mac app and its tunnel are off. The launchd jobs `com.endyland.parking-app` and
  `com.endyland.parking-tunnel` were booted out and their plists moved to `launchd/disabled/`.
- `app.py`, `worker.py` and `data.db` stay only as the rollback copy. `data.db` is no longer updated.
- Rollback: remove the `routes` entry from `cloudflare/wrangler.jsonc` and push (if you deleted the
  route in the dashboard, remove it from `wrangler.jsonc` too). Move the two plists back to
  `~/Library/LaunchAgents`, then run `launchctl bootstrap gui/$(id -u) <plist>` for each.
  D1 changes since the move are not in `data.db`.
- To add a friend: `cloudflare/scripts/add-friend.sh "Name" --remote`. Existing links stay the same. Do not paste them anywhere.
- Real profiles, plates and the owner's property are in `HANDOFF.local.md` (git-ignored, Mac only).

## Public sign-up (2026-10-29)

- `/` is a public form: name, property (exact registermyplate.com label), unit, and an accuracy box.
  It makes a page with its own property and unit and sends the person there. `/app.js` stores the
  page in the browser (localStorage), so that device goes straight to it next time.
- Cap: `MAX_NEW_PAGES` new pages a day (default 30). Every sign-up is logged as `[signup]`.
- Pages made before this have no property of their own and use the `PROPERTY` and `UNIT`
  Worker secrets. Those are not in the repo.
- The firewall rule "parking: only the app paths" must allow `/`, `/start` and `/app.js`.

## Open work, in order

1. Done: moved to the Cloudflare Worker on 2026-10-22. Watch the next renewal and the inbox.
2. Done: the Mac login agents and tunnel are switched off. `launchd/install.sh` is no longer part
   of the normal path.
3. endyland.com restructure (done 2026-10-20, apex now serves the portfolio,
   repo github.com/abasheer-rion/endyland-portfolio, Pages project `endyland-portfolio`):
   - `endyland.com`: new portfolio site (minimal layout, animations, 3D). Needs the owner's name as
     shown, LinkedIn, GitHub, projects and quick links.
   - `movie.endyland.com`: the existing P-Stream fork, today on Pages project `p-stream` in the
     owner's Cloudflare account, with `api.endyland.com` and `proxy.endyland.com`.
   - `parking.endyland.com`: this app.
   Safe order: record current DNS and Pages domains, add `movie.` to `p-stream`, allow the new
   origin on the api and proxy, build and deploy the portfolio, then move the apex and www.
   Known cost: four movie sources are tied to a third party's domain allowlist and may stop working
   on `movie.` until that allowlist is updated.
4. Done: Cloudflare tokens are in the vault (`cloudflare-api-token` for the account,
   `cloudflare-zone-dns-token` for DNS). Still open: CORS on api/proxy for `movie.` origin, and the
   `endyland-backend` tunnel (api.endyland.com) was down on 2026-10-20.

## Credentials

Managed by `vault` on the Mac (`~/.claude/vault/vault.py`, linked as `vault`). Values live in the
macOS Keychain, details in `~/.claude/vault/index.json`, summary in `~/.claude/CREDENTIALS.md`.
Run `vault list`. Never put a value in this repo, a chat, or a log. Rules: `~/.claude/DEVBOX_SECURITY.md`.

## Owner preferences

Short replies. No em dashes, no exclamation points, plain language. Ask before DNS, tunnel, Pages
or credential changes. Real details only for registrations.

## Known limits

- Fine for a handful of people.
- The Review step's checkbox is an attestation that the details are accurate. The app ticks it for
  each registration, so profiles must hold real data.
