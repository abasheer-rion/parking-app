# Handoff (as of 2026-10-20)

Read README.md first. This file is what is running, what is pending, and the decisions behind it.

## Running now

- On Ayan's MacBook Pro at `~/parking-app`, currently started with nohup.
- Public address: https://parking.endyland.com through the named tunnel `parking-app`
  (id 17b16696-2dea-4e93-8e17-73595e0db5e8, ingress managed in Cloudflare). `run-tunnel.sh`
  fetches the tunnel token at start using the vault's Cloudflare token.
- Auto-start: `launchd/install.sh` installs login agents for the app and the tunnel. It must be run
  by the owner (an agent install was blocked for Claude). Until then a reboot stops everything.
- Links: `source .env.sh && .venv/bin/python3 app.py list`.
- Ayan's link has three profiles: Ayan (TEST001, black BMW 3 Series, TX), Friend Two (TEST002, grey
  VW Jetta, TX, needs an email), Friend Three (needs a car and an email). TX was assumed for both plates.
- First real permit: TEST001, issued 2026-10-19 23:30, expires 2026-10-20 23:30. The first
  automatic renewal has not happened yet. Watch the inbox and `logs/app.log` after 23:30.
- Emails work (Gmail SMTP/IMAP with an app password). HTML styled to match the site.

## Open work, in order

1. Watch the first renewal. Fix `worker.py` if the Results page differs on renewal.
2. Done: `parking.endyland.com` via named tunnel. Pending: owner runs `launchd/install.sh`.
3. endyland.com restructure (done 2026-10-20, apex now serves the portfolio,
   repo github.com/abasheer-rion/endyland-portfolio, Pages project `endyland-portfolio`):
   - `endyland.com`: new portfolio site (minimal layout, animations, 3D). Needs the owner's name as
     shown, LinkedIn, GitHub, projects and quick links.
   - `movie.endyland.com`: the existing P-Stream fork, today on Pages project `p-stream` in the
     owner@example.com Cloudflare account, with `api.endyland.com` and `proxy.endyland.com`.
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

- Flask dev server, single machine, single worker. Fine for a handful of people.
- The Review step's checkbox is an attestation that the details are accurate. The app ticks it for
  each registration, so profiles must hold real data.
