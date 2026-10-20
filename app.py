"""Guest parking registration app for SAMPLE COURT, unit 101.

Run:   python app.py                      (starts the site and the renewal job)
Admin: python app.py add-friend "Name"    (prints that friend's private link)
       python app.py list
"""
import os
import secrets
import smtplib
import sqlite3
import sys
import threading
import time
from datetime import datetime, timedelta
from email.message import EmailMessage
from email.utils import formataddr

from flask import Flask, abort, redirect, render_template_string, request, send_file, url_for

import worker

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "data.db")
MAX_DAYS = int(os.environ.get("MAX_DAYS", "14"))
BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080")
RENEW_WITHIN = 2 * 3600          # renew when under 2 hours of coverage remain
CHECK_EVERY = 60                 # scheduler tick, seconds
LOCK = threading.Lock()          # one browser run at a time

app = Flask(__name__)


def db():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    return c


def init():
    with db() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS friends(
            id INTEGER PRIMARY KEY, token TEXT UNIQUE, name TEXT);
        CREATE TABLE IF NOT EXISTS profiles(
            id INTEGER PRIMARY KEY, friend_id INTEGER, name TEXT, email TEXT,
            plate TEXT, state TEXT, make TEXT, model TEXT, color TEXT);
        CREATE TABLE IF NOT EXISTS jobs(
            id INTEGER PRIMARY KEY, friend_id INTEGER, plate TEXT, state TEXT,
            make TEXT, model TEXT, color TEXT, email TEXT,
            start_ts REAL, end_ts REAL, expires_ts REAL, last_ok_ts REAL,
            status TEXT, fails INTEGER DEFAULT 0, error TEXT);
        """)
        for col in ("confirmation TEXT", "qr_path TEXT", "who TEXT", "next_try REAL"):
            try:
                c.execute("ALTER TABLE jobs ADD COLUMN " + col)
            except sqlite3.OperationalError:
                pass


def now():
    return time.time()


def fmt(ts):
    return datetime.fromtimestamp(ts).strftime("%a %b %d, %I:%M %p") if ts else "n/a"


def send_mail(to, subject, body, html=None, image_path=None, cc=None):
    user, pw = os.environ.get("GMAIL_USER"), os.environ.get("GMAIL_APP_PASSWORD")
    if not user or not pw or not to:
        print(f"[mail skipped] {to}: {subject}")
        return False
    m = EmailMessage()
    m["From"] = formataddr((os.environ.get("FROM_NAME", "Park With Love (no reply)"), user))
    m["To"], m["Subject"] = to, subject
    cc = cc or os.environ.get("NOTIFY_ALSO", user)
    if cc and cc.lower() != to.lower():
        m["Cc"] = cc
    m.set_content(body)
    if html:
        m.add_alternative(html, subtype="html")
    if image_path and os.path.exists(image_path):
        data = open(image_path, "rb").read()
        if html:
            m.get_payload()[1].add_related(data, "image", "png", cid="<qr>")
        m.add_attachment(data, maintype="image", subtype="png", filename="parking-qr.png")
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as s:
            s.login(user, pw)
            s.send_message(m)
        return True
    except Exception as e:
        print("[mail error]", e)
        return False


def vehicle(job):
    return {k: job[k] for k in ("plate", "state", "make", "model", "color")}


def car_line(j):
    return f"{j['plate']} ({j['color']} {j['make']} {j['model']})"


def pink_email(status, ok, who, lead, rows, code=None, qr=False, note=""):
    """HTML email in the same pink pixel look as the site. Inline styles only, so mail apps keep it."""
    ink, hot, pink, cream = "#5b2a45", "#ff4f8b", "#ff8fb8", "#fff3f8"
    mono = "'Press Start 2P','Courier New',Courier,monospace"
    body = "'Courier New',Courier,monospace"
    colour = "#0d8a62" if ok else "#c0143c"
    rows_html = "".join(
        f"<tr><td style=\"padding:6px 0;border-top:2px dashed {pink}\">"
        f"<div style=\"font:12px {body};color:{ink};opacity:.75;text-transform:uppercase;letter-spacing:1px\">{k}</div>"
        f"<div style=\"font:bold 16px {body};color:{ink}\">{v}</div></td></tr>" for k, v in rows)
    code_html = (f"<div style=\"margin:16px 0 4px;font:12px {body};color:{ink};text-transform:uppercase;letter-spacing:1px\">Confirmation code</div>"
                 f"<div style=\"background:#fff;border:3px solid {ink};padding:12px;font:bold 20px {body};color:{hot};"
                 f"word-break:break-all;letter-spacing:1px\">{code}</div>") if code else ""
    qr_html = (f"<div style=\"margin:16px 0 0\"><span style=\"display:inline-block;background:#fff;border:3px solid {ink};padding:10px\">"
               f"<img src=\"cid:qr\" width=\"220\" height=\"220\" alt=\"QR code\" style=\"display:block\"></span></div>") if qr else ""
    return f"""<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:{pink}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{pink}"><tr><td align="center" style="padding:24px 12px">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px">
  <tr><td align="center" style="padding:6px 0 16px;font:15px/1.6 {mono};color:#fff;text-shadow:3px 3px 0 {hot}">&hearts; PARK WITH LOVE &hearts;</td></tr>
  <tr><td style="background:{hot};padding:0 7px 7px 0">
   <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{cream};border:3px solid {ink}"><tr><td style="padding:20px">
    <div style="font:12px/1.6 {mono};color:{colour}">{status}</div>
    <p style="margin:12px 0 4px;font:17px/1.5 {body};color:{ink}">Hi {who},</p>
    <p style="margin:0 0 14px;font:17px/1.5 {body};color:{ink}">{lead}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">{rows_html}</table>
    {code_html}{qr_html}
    <p style="margin:18px 0 0;font:15px/1.5 {body};color:{ink}">{note}</p>
   </td></tr></table>
  </td></tr>
  <tr><td align="center" style="padding:14px 0 0;font:13px {body};color:#fff">Sent by Park With Love. Replies are not read.</td></tr>
 </table>
</td></tr></table></body></html>"""


def notify_success(j, first):
    """Email the confirmation code and QR after a registration or a renewal."""
    with db() as c:
        j = c.execute("SELECT * FROM jobs WHERE id=?", (j["id"],)).fetchone()
    who = j["who"] or "there"
    more = (j["end_ts"] - (j["expires_ts"] or 0)) > 1800
    nxt = ("The app will try to renew right after this permit ends, and you will get another email with the result."
           if more else "This covers the last day of the stay, so no renewal is planned.")
    subject = (f"Parking confirmed for {j['plate']}, code {j['confirmation']}" if first
               else f"Parking renewed for {j['plate']}, new code {j['confirmation']}")
    lead = "Your guest parking is confirmed." if first else "Your guest parking was renewed for the next day."
    body = (f"Hi {who},\n\n{lead}\n\nProperty: {worker.PROPERTY.title()}, unit {worker.UNIT}\n"
            f"Car: {car_line(j)}\nConfirmation code: {j['confirmation']}\n"
            f"Covered until: {fmt(j['expires_ts'])}\nStay ends: {fmt(j['end_ts'])}\n\n"
            f"The QR code is attached. Show it or the code if anyone asks.\n\n{nxt}\n")
    html = pink_email(
        "&hearts; YOU ARE ALL SET" if first else "&hearts; RENEWED FOR THE NEXT DAY", True, who, lead,
        [("Property", f"{worker.PROPERTY.title()}, unit {worker.UNIT}"), ("Car", car_line(j)),
         ("Covered until", fmt(j["expires_ts"])), ("Stay ends", fmt(j["end_ts"]))],
        code=j["confirmation"], qr=bool(j["qr_path"]), note=nxt)
    send_mail(j["email"], subject, body, html=html, image_path=j["qr_path"])


def notify_failure(j, first_try, fails, reason, gave_up):
    who = j["who"] or "there"
    if first_try:
        subject = f"Could not register parking for {j['plate']}"
        lead = f"The app could not register {car_line(j)} for guest parking."
    else:
        subject = f"Could not renew parking for {j['plate']}"
        lead = f"The app could not renew parking for {car_line(j)} for the next day."
    tail = ("It has stopped trying. Open your link to register again, or register by hand on the property's site."
            if gave_up else "It will try again in about 10 minutes and email you if that works.")
    cover = f"\nCoverage ran until: {fmt(j['expires_ts'])}\n" if (j["expires_ts"] and not first_try) else ""
    body = f"Hi {who},\n\n{lead}\n{cover}\nReason: {reason[:300]}\n\n{tail}\n"
    rows = [("Car", car_line(j))]
    if j["expires_ts"] and not first_try:
        rows.append(("Coverage ran until", fmt(j["expires_ts"])))
    rows.append(("What happened", reason[:200].replace("<", "").replace(">", "")))
    html = pink_email("NEEDS A LOOK", False, who, lead, rows, note=tail)
    send_mail(j["email"], subject, body, html=html)


def run_registration(job_id):
    """Register once for a job, update the row, and email the result."""
    with LOCK:
        with db() as c:
            j = c.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        if not j or j["status"] not in ("pending", "active"):
            return
        if j["expires_ts"] and now() < j["expires_ts"]:
            return                                    # still covered, nothing to do
        first = j["last_ok_ts"] is None
        r = worker.register(vehicle(j), j["email"])
        t = now()
        with db() as c:
            if r["ok"]:
                c.execute("UPDATE jobs SET status='active', fails=0, error=NULL, next_try=NULL, last_ok_ts=?, "
                          "expires_ts=?, confirmation=?, qr_path=? WHERE id=?",
                          (t, r.get("expires_ts") or t + 86400, r.get("confirmation"), r.get("qr_path"), job_id))
            else:
                fails = j["fails"] + 1
                gave_up = fails >= 5
                status = "failed" if gave_up else ("active" if j["last_ok_ts"] else "pending")
                c.execute("UPDATE jobs SET fails=?, error=?, status=?, next_try=? WHERE id=?",
                          (fails, r["message"], status, t + 600, job_id))
        if r["ok"]:
            notify_success(j, first)
        elif j["fails"] + 1 in (1, 5):
            notify_failure(j, first, j["fails"] + 1, r["message"], j["fails"] + 1 >= 5)


def scheduler():
    while True:
        try:
            with db() as c:
                jobs = c.execute("SELECT * FROM jobs WHERE status IN ('pending','active')").fetchall()
            t = now()
            for j in jobs:
                exp = j["expires_ts"]
                more_days = exp is None or (j["end_ts"] - exp) > 1800   # a permit lasts 24h; ignore a short tail
                if exp is not None and t >= exp and not more_days:
                    with db() as c:
                        c.execute("UPDATE jobs SET status='done' WHERE id=?", (j["id"],))
                elif more_days and (exp is None or t >= exp) and t >= (j["next_try"] or 0):
                    run_registration(j["id"])
        except Exception as e:
            print("[scheduler error]", e)
        time.sleep(CHECK_EVERY)


PAGE = """
<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Guest parking</title>
{% if any_pending %}<meta http-equiv="refresh" content="6">{% endif %}
<link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap" rel="stylesheet">
<style>
 :root{--pink:#ff8fb8;--hot:#ff4f8b;--cream:#fff3f8;--ink:#5b2a45;--mint:#6fdcb6}
 *{box-sizing:border-box;image-rendering:pixelated}
 body{font-family:'VT323',monospace;font-size:21px;background:var(--pink);color:var(--ink);margin:0;
  background-image:radial-gradient(#ffb3cf 2px,transparent 2px);background-size:22px 22px}
 main{max-width:460px;margin:0 auto;padding:22px 14px 70px}
 h1{font-family:'Press Start 2P',monospace;font-size:17px;line-height:1.5;margin:6px 0 6px;color:#fff;
  text-shadow:3px 3px 0 var(--hot);text-align:center}
 p.sub{margin:0 0 18px;text-align:center;color:#fff;text-shadow:1px 1px 0 var(--hot)}
 .card{background:var(--cream);padding:16px;margin:16px 0;border:4px solid var(--ink);
  box-shadow:6px 6px 0 var(--hot)}
 .card>b,.card b.t{font-family:'Press Start 2P',monospace;font-size:11px;color:var(--hot);display:block;margin-bottom:6px}
 label{display:block;margin:10px 0 3px}
 input,select{width:100%;font-family:'VT323',monospace;font-size:22px;padding:8px 10px;color:var(--ink);
  background:#fff;border:3px solid var(--ink);border-radius:0;outline:none}
 input:focus,select:focus{border-color:var(--hot);box-shadow:3px 3px 0 var(--pink)}
 button{width:100%;font-family:'Press Start 2P',monospace;font-size:11px;padding:14px 8px;margin-top:14px;
  background:var(--hot);color:#fff;border:3px solid var(--ink);border-radius:0;box-shadow:4px 4px 0 var(--ink);cursor:pointer}
 button:active{transform:translate(3px,3px);box-shadow:1px 1px 0 var(--ink)}
 button.alt{background:#fff;color:var(--ink);margin-top:10px}
 .row{display:flex;gap:10px}.row>div{flex:1}
 .ok{color:#0d8a62}.bad{color:#c0143c}.mut{opacity:.75}
 .who{border-top:3px dashed var(--pink);padding-top:12px;margin-top:12px}.who:first-of-type{border-top:0;padding-top:0;margin-top:0}
 .name{font-family:'Press Start 2P',monospace;font-size:12px}
 details{margin-top:10px}summary{cursor:pointer;color:var(--hot)}
 .heart{display:inline-block;animation:beat 1.2s steps(2) infinite}
 @keyframes beat{50%{transform:scale(1.25)}}
</style></head><body><main>
<h1><span class="heart">♥</span> Park With Love <span class="heart">♥</span></h1><p class="sub">Hi {{friend.name}}, saving you a spot at {{prop}}, unit {{unit}}</p>

{% if notice %}<div class="card"><span class="ok">{{notice}}</span></div>{% endif %}
{% if error %}<div class="card"><span class="bad">{{error}}</span></div>{% endif %}

<div class="card"><b class="t">♥ Who's coming</b>
{% for p in profiles %}
 <div class="who">
  <span class="name">{{p.name}}</span><br>
  <span class="mut">{% if p.plate %}{{p.plate}} {{p.state}} · {{p.color}} {{p.make}} {{p.model}}{% else %}No car saved yet{% endif %}</span>
  {% if p.plate and p.email %}
  <form method="post" action="{{url_for('profile_go',token=friend.token,pid=p.id)}}">
   <div class="row"><div style="max-width:110px"><label>Days</label><input name="days" type="number" min="1" max="{{max_days}}" value="1"></div>
   <div><button>Save my spot ♥</button></div></div></form>
  {% else %}<br><span class="bad">Open Edit and add a car and an email to register.</span>{% endif %}
  <details><summary>Edit</summary>
   <form method="post" action="{{url_for('profile_save',token=friend.token,pid=p.id)}}">
    <label>Name</label><input name="name" required value="{{p.name}}">
    <label>Email, for problem alerts</label><input name="email" type="email" value="{{p.email}}">
    <div class="row"><div><label>Plate</label><input name="plate" autocapitalize="characters" value="{{p.plate}}"></div>
    <div><label>State</label><select name="state">{% for s in states %}<option {{'selected' if s==p.state}}>{{s}}</option>{% endfor %}</select></div></div>
    <div class="row"><div><label>Make</label><input name="make" value="{{p.make}}"></div><div><label>Model</label><input name="model" value="{{p.model}}"></div></div>
    <label>Color</label><input name="color" value="{{p.color}}">
    <button>Save changes</button></form>
   <form method="post" action="{{url_for('profile_delete',token=friend.token,pid=p.id)}}"><button class="alt">Remove {{p.name}}</button></form>
  </details>
 </div>
{% endfor %}
 <details><summary>Add someone</summary>
  <form method="post" action="{{url_for('profile_new',token=friend.token)}}">
   <label>Name</label><input name="name" required>
   <label>Email, for problem alerts</label><input name="email" type="email">
   <div class="row"><div><label>Plate</label><input name="plate" autocapitalize="characters"></div>
   <div><label>State</label><select name="state">{% for s in states %}<option>{{s}}</option>{% endfor %}</select></div></div>
   <div class="row"><div><label>Make</label><input name="make"></div><div><label>Model</label><input name="model"></div></div>
   <label>Color</label><input name="color">
   <button>Add</button></form>
 </details>
</div>

{% for j in active %}
<div class="card">
 <b class="t" style="font-size:13px">{{j.plate}}</b> <span class="mut">{{j.make}} {{j.model}}</span><br>
 {% if j.status=='pending' and not j.last_ok_ts %}<span class="mut">Saving your spot now, this page updates on its own.</span>
 {% elif j.status=='failed' %}<span class="bad">Failed: {{j.error}}</span>
 {% else %}<span class="ok">♥ You are all set</span><br>
  <span class="mut">Spot saved until {{fmt(j.expires_ts)}}. Stay ends {{fmt(j.end_ts)}}.</span>
  {% if j.confirmation %}<br><label>Confirmation code</label><b style="word-break:break-all">{{j.confirmation}}</b>{% endif %}
  {% if j.qr_path %}<br><img src="{{url_for('qr',token=friend.token,job=j.id)}}" alt="QR code" style="width:200px;max-width:100%;margin-top:8px;border:3px solid var(--ink);background:#fff">{% endif %}
  {% endif %}
 <form method="post" action="{{url_for('stop',token=friend.token,job=j.id)}}"><button class="alt">Done staying</button></form>
</div>
{% endfor %}


<div class="card"><b class="t">♥ New ride</b>
<form method="post" action="{{url_for('register',token=friend.token)}}">
 <label>Your email, for problem alerts</label><input name="email" type="email" required value="{{last_email}}">
 <div class="row"><div><label>Plate</label><input name="plate" required autocapitalize="characters"></div>
 <div><label>State</label><select name="state" required>{% for s in states %}<option>{{s}}</option>{% endfor %}</select></div></div>
 <div class="row"><div><label>Make</label><input name="make" required></div><div><label>Model</label><input name="model" required></div></div>
 <label>Color</label><input name="color" required>
 <label>Days staying (up to {{max_days}})</label><input name="days" type="number" min="1" max="{{max_days}}" value="1" required>
 <button>Save my spot ♥</button></form></div>
</main></body></html>
"""

STATES = ["TX", "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY",
          "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH",
          "OK", "OR", "PA", "RI", "SC", "SD", "TN", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC"]


def friend_or_404(token):
    with db() as c:
        f = c.execute("SELECT * FROM friends WHERE token=?", (token,)).fetchone()
    if not f:
        abort(404)
    return f


def page(f, notice=None, error=None):
    with db() as c:
        active = c.execute("SELECT * FROM jobs WHERE friend_id=? AND status IN ('pending','active','failed') "
                           "ORDER BY id DESC", (f["id"],)).fetchall()
        recents = c.execute("SELECT * FROM jobs WHERE id IN (SELECT MAX(id) FROM jobs WHERE friend_id=? "
                            "GROUP BY plate) ORDER BY id DESC LIMIT 5", (f["id"],)).fetchall()
        profiles = c.execute("SELECT * FROM profiles WHERE friend_id=? ORDER BY id", (f["id"],)).fetchall()
    last_email = recents[0]["email"] if recents else ""
    any_pending = any(j["status"] == "pending" and not j["last_ok_ts"] for j in active)
    return render_template_string(PAGE, profiles=profiles, friend=f, active=active, recents=recents, last_email=last_email,
                                  any_pending=any_pending, fmt=fmt, notice=notice, error=error, states=STATES,
                                  max_days=MAX_DAYS, unit=worker.UNIT, prop=worker.PROPERTY.title())


def start_job(f, data, days):
    days = max(1, min(MAX_DAYS, days))
    t = now()
    end = t + days * 86400
    with db() as c:
        c.execute("UPDATE jobs SET status='stopped' WHERE friend_id=? AND plate=? AND status IN ('pending','active')",
                  (f["id"], data["plate"].strip().upper()))
        cur = c.execute("INSERT INTO jobs(friend_id,plate,state,make,model,color,email,start_ts,end_ts,status,who) "
                        "VALUES(?,?,?,?,?,?,?,?,?,'pending',?)",
                        (f["id"], data["plate"].strip().upper(), data["state"], data["make"].strip(),
                         data["model"].strip(), data["color"].strip(), data["email"].strip(), t, end,
                         (data.get("name") or f["name"])))
        jid = cur.lastrowid
    threading.Thread(target=run_registration, args=(jid,), daemon=True).start()


@app.route("/u/<token>")
def home(token):
    return page(friend_or_404(token))


@app.route("/u/<token>/register", methods=["POST"])
def register(token):
    f = friend_or_404(token)
    d = request.form
    try:
        days = int(d.get("days", "1"))
    except ValueError:
        return page(f, error="Days must be a number.")
    start_job(f, d, days)
    return redirect(url_for("home", token=token))


@app.route("/u/<token>/again/<int:job>", methods=["POST"])
def again(token, job):
    f = friend_or_404(token)
    with db() as c:
        j = c.execute("SELECT * FROM jobs WHERE id=? AND friend_id=?", (job, f["id"])).fetchone()
    if not j:
        abort(404)
    try:
        days = int(request.form.get("days", "1"))
    except ValueError:
        return page(f, error="Days must be a number.")
    start_job(f, dict(j), days)
    return redirect(url_for("home", token=token))


FIELDS = ("name", "email", "plate", "state", "make", "model", "color")


def clean(form):
    d = {k: form.get(k, "").strip() for k in FIELDS}
    d["plate"] = d["plate"].upper().replace(" ", "")
    d["state"] = d["state"] or "TX"
    return d


@app.route("/u/<token>/profile/new", methods=["POST"])
def profile_new(token):
    f = friend_or_404(token)
    d = clean(request.form)
    if not d["name"]:
        return page(f, error="Add a name.")
    with db() as c:
        c.execute("INSERT INTO profiles(friend_id,name,email,plate,state,make,model,color) VALUES(?,?,?,?,?,?,?,?)",
                  (f["id"],) + tuple(d[k] for k in FIELDS))
    return redirect(url_for("home", token=token))


@app.route("/u/<token>/profile/<int:pid>/save", methods=["POST"])
def profile_save(token, pid):
    f = friend_or_404(token)
    d = clean(request.form)
    if not d["name"]:
        return page(f, error="A profile needs a name.")
    with db() as c:
        c.execute("UPDATE profiles SET name=?,email=?,plate=?,state=?,make=?,model=?,color=? WHERE id=? AND friend_id=?",
                  tuple(d[k] for k in FIELDS) + (pid, f["id"]))
    return redirect(url_for("home", token=token))


@app.route("/u/<token>/profile/<int:pid>/delete", methods=["POST"])
def profile_delete(token, pid):
    f = friend_or_404(token)
    with db() as c:
        c.execute("DELETE FROM profiles WHERE id=? AND friend_id=?", (pid, f["id"]))
    return redirect(url_for("home", token=token))


@app.route("/u/<token>/profile/<int:pid>/go", methods=["POST"])
def profile_go(token, pid):
    f = friend_or_404(token)
    with db() as c:
        p = c.execute("SELECT * FROM profiles WHERE id=? AND friend_id=?", (pid, f["id"])).fetchone()
    if not p:
        abort(404)
    if not (p["plate"] and p["make"] and p["model"] and p["color"] and p["email"]):
        return page(f, error=f"{p['name']} needs a plate, make, model, color and email first. Use Edit.")
    try:
        days = int(request.form.get("days", "1"))
    except ValueError:
        return page(f, error="Days must be a number.")
    start_job(f, dict(p), days)
    return redirect(url_for("home", token=token))


@app.route("/u/<token>/qr/<int:job>")
def qr(token, job):
    f = friend_or_404(token)
    with db() as c:
        j = c.execute("SELECT qr_path FROM jobs WHERE id=? AND friend_id=?", (job, f["id"])).fetchone()
    if not j or not j["qr_path"] or not os.path.exists(j["qr_path"]):
        abort(404)
    return send_file(j["qr_path"], mimetype="image/png")


@app.route("/u/<token>/stop/<int:job>", methods=["POST"])
def stop(token, job):
    f = friend_or_404(token)
    with db() as c:
        c.execute("UPDATE jobs SET status='stopped' WHERE id=? AND friend_id=?", (job, f["id"]))
    return redirect(url_for("home", token=token))


if __name__ == "__main__":
    init()
    if len(sys.argv) > 1 and sys.argv[1] == "add-friend":
        name = " ".join(sys.argv[2:]) or "Friend"
        tok = secrets.token_urlsafe(12)
        with db() as c:
            c.execute("INSERT INTO friends(token,name) VALUES(?,?)", (tok, name))
        print(f"{name}: {BASE_URL}/u/{tok}")
    elif len(sys.argv) > 2 and sys.argv[1] == "seed":
        # python app.py seed "Friend name" "Name|email|plate|state|make|model|color" ...
        with db() as c:
            f = c.execute("SELECT * FROM friends WHERE name=?", (sys.argv[2],)).fetchone()
            if not f:
                sys.exit("no friend with that name")
            for row in sys.argv[3:]:
                v = (row.split("|") + [""] * 7)[:7]
                if not c.execute("SELECT 1 FROM profiles WHERE friend_id=? AND name=?", (f["id"], v[0])).fetchone():
                    c.execute("INSERT INTO profiles(friend_id,name,email,plate,state,make,model,color) VALUES(?,?,?,?,?,?,?,?)",
                              (f["id"], *v))
                    print("added", v[0])
    elif len(sys.argv) > 1 and sys.argv[1] == "list":
        with db() as c:
            for f in c.execute("SELECT * FROM friends"):
                print(f"{f['name']}: {BASE_URL}/u/{f['token']}")
    else:
        threading.Thread(target=scheduler, daemon=True).start()
        app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "8080")))
