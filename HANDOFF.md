# Handoff (as of 2026-10-20)

Read README.md first. This file is what is running, what is pending, and the decisions behind it.

## Running now

- On Ayan's MacBook Pro at `~/parking-app`, started with nohup. Not a launchd service yet, so it
  does not survive a reboot or a logout. Restart with `./start.sh`.
- Public access is a temporary Cloudflare quick tunnel. Its address changes on every restart.
  Get links with `.venv/bin/python3 app.py list` after setting BASE_URL.
- Ayan's link has three profiles: Ayan (TEST001, black BMW 3 Series, TX), Friend Two (TEST002, grey
  VW Jetta, TX, needs an email), Friend Three (needs a car and an email). TX was assumed for both plates.
- First real permit: TEST001, issued 2026-10-19 23:30, expires 2026-10-20 23:30. The first
  automatic renewal has not happened yet. Watch the inbox and `logs/app.log` after 23:30.
- Emails work (Gmail SMTP/IMAP with an app password). HTML styled to match the site.

## Open work, in order

1. Watch the first renewal. Fix `worker.py` if the Results page differs on renewal.
2. Permanent address `parking.endyland.com`:
   `cloudflared tunnel login` failed to save the cert twice ("Failed to write the certificate").
   Options: retry the login and click Authorize quickly, or use a Cloudflare API token to create a
   named tunnel and DNS record. Then run the tunnel and app as launchd agents.
3. endyland.com restructure (owner's plan):
   - `endyland.com`: new portfolio site (minimal layout, animations, 3D). Needs the owner's name as
     shown, LinkedIn, GitHub, projects and quick links.
   - `movie.endyland.com`: the existing P-Stream fork, today on Pages project `p-stream` in the
     owner@example.com Cloudflare account, with `api.endyland.com` and `proxy.endyland.com`.
   - `parking.endyland.com`: this app.
   Safe order: record current DNS and Pages domains, add `movie.` to `p-stream`, allow the new
   origin on the api and proxy, build and deploy the portfolio, then move the apex and www.
   Known cost: four movie sources are tied to a third party's domain allowlist and may stop working
   on `movie.` until that allowlist is updated.
4. Cloudflare API token for that account: the first full-access token was shown in a screenshot,
   so it must be deleted and a new one made. It was never stored.

## Credentials

Managed by `vault` on the Mac (`~/.claude/vault/vault.py`, linked as `vault`). Values live in the
macOS Keychain, details in `~/.claude/vault/index.json`, summary in `~/.claude/CREDENTIALS.md`.
Run `vault list`. Never put a value in this repo, a chat, or a log. Rules: `~/.claude/DEVBOX_SECURITY.md`.

## Owner preferences

Short replies. No em dashes, no exclamation points, plain language. Ask before DNS, tunnel, Pages
or credential changes. Real details only for registrations.

## Known limits

- Flask dev server, single machine, single worker. Fine for a handful of people.
- The Review step's checkbox is an attestation that the details are accurate. The app ticks it for
  each registration, so profiles must hold real data.
