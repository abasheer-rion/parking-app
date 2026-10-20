# Park With Love

Guest parking registration for SAMPLE COURT, unit 101 (Austin), through the property's
visitor form at registermyplate.com/visitors/ (run by A & A Wrecker and Recovery).

Friends open a private link, pick a saved profile, choose how many days, and the app registers
their car with the property, then renews it every day until the stay ends. It emails the
confirmation code and QR code after each registration or renewal, and emails when a renewal fails.

See HANDOFF.md for current status and open work.

## How it works

- `app.py`: Flask site, SQLite (`data.db`), scheduler thread, emails.
- `worker.py`: Playwright drives the property's form in headless Chromium.
- Each friend link (`/u/<token>`) has profiles ("Who's coming"), active registrations with
  code and QR, and a one-off "New ride" form.
- The scheduler checks every 60 seconds. A permit lasts 24 hours. The site refuses a new permit
  while one is live, so renewal runs right after expiry (expect a gap of about a minute).
- Failed tries retry every 10 minutes, up to 5, then stop and email.

## The property's form, step by step

1. Property: dropdown, pick `SAMPLE COURT`.
2. Products: one option, "Guest Parking - Default", free, 24 hours.
3. Apartment: unit number.
4. Vehicle: plate, make, model, color, state (two-letter value).
5. Contact: email only. No verification email is actually sent.
6. Payment: $0.00, just Next.
7. Review: re-enter the plate and tick a box confirming the details are accurate, then Submit.
8. Results: "Confirmation Code", "Expires MM/DD/YYYY HH:MM:SS AM/PM", QR image `#MainContent_img_QRC`.

If the plate already has a live permit, step 4 jumps straight to Results with "Permit already exists".
The page is ASP.NET WebForms, so a plain HTTP replay is not practical. Note: `_body()` reads a
detached clone, which includes hidden validator text, so do not judge success from it. Use the
QR element and the confirmation code instead.

## Setup

    python3 -m venv .venv
    .venv/bin/pip install flask playwright
    .venv/bin/playwright install chromium
    brew install cloudflared

Create `.env.sh` (mode 600, git-ignored):

    export GMAIL_USER="..."            # sends alerts
    export GMAIL_APP_PASSWORD="..."    # Google app password
    export FROM_NAME="Park With Love (no reply)"
    export NOTIFY_ALSO="..."           # copied on every email, defaults to GMAIL_USER
    export BASE_URL="https://..."      # public address, used when printing links
    export MAX_DAYS=14
    # optional: PROPERTY, UNIT, PORT (default 8080), WORKER=mock for testing without the browser

## Run

    ./start.sh                                   # app + temporary tunnel, prints the public URL
    source .env.sh && .venv/bin/python3 app.py add-friend "Name"   # prints a private link
    .venv/bin/python3 app.py list
    .venv/bin/python3 app.py seed "Friend" "Name|email|PLATE|TX|Make|Model|Color" ...

## Testing tools

- `dryrun.py PLATE STATE MAKE MODEL COLOR EMAIL`: stops at the Contact step, submits nothing.
- `explore.py`: walks every step and stops before the final button, printing each page.
- `submit_test.py ...`: does a real registration. Use real details only.
- `WORKER=mock`: the app runs without touching the property's site.

## Rules

Real details only. No randomized fields. Respect MAX_DAYS. Stop if the property shows a guest-day limit.
