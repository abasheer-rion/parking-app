"""Renders pages and emails with the Flask app, so the Worker tests can compare against them.

Run from anywhere with a Python that has Flask installed:
    TZ=America/Chicago PYTHONDONTWRITEBYTECODE=1 python3 cloudflare/scripts/make-golden.py
Uses a temp database and a fake mail sender. It never opens a browser or sends mail.
"""
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(os.path.dirname(HERE), "test", "golden")
FIXTURE = os.path.join(os.path.dirname(HERE), "test", "fixture.json")

tmp = tempfile.mkdtemp()
os.environ["PARKING_DB"] = os.path.join(tmp, "golden.db")
os.environ["WORKER"] = "mock"
for k in ("GMAIL_USER", "GMAIL_APP_PASSWORD", "NOTIFY_ALSO", "MAX_DAYS", "PROPERTY", "UNIT"):
    os.environ.pop(k, None)
sys.dont_write_bytecode = True
sys.path.insert(0, ROOT)
import app  # noqa: E402

fx = json.load(open(FIXTURE))
app.init()
with app.db() as c:
    for f in fx["friends"]:
        c.execute("INSERT INTO friends(id,token,name) VALUES(?,?,?)", (f["id"], f["token"], f["name"]))
    for p in fx["profiles"]:
        c.execute("INSERT INTO profiles(id,friend_id,name,email,plate,state,make,model,color) VALUES(?,?,?,?,?,?,?,?,?)",
                  tuple(p[k] for k in ("id", "friend_id", "name", "email", "plate", "state", "make", "model", "color")))
    for j in fx["jobs"]:
        cols = [k for k in j if k != "qr"]
        vals = [j[k] for k in cols]
        if j.get("qr"):
            cols.append("qr_path")
            vals.append("/nonexistent/qr.png")
        c.execute(f"INSERT INTO jobs({','.join(cols)}) VALUES({','.join('?' * len(cols))})", vals)

os.makedirs(OUT, exist_ok=True)
client = app.app.test_client()
for f in fx["friends"]:
    html = client.get(f"/u/{f['token']}").get_data(as_text=True)
    open(os.path.join(OUT, f"page-{f['id']}.html"), "w").write(html)
html = client.post(f"/u/{fx['friends'][0]['token']}/register", data={"days": "abc"}).get_data(as_text=True)
open(os.path.join(OUT, "page-error-days.html"), "w").write(html)
html = client.get("/nope").get_data(as_text=True)
open(os.path.join(OUT, "404.html"), "w").write(html)

sent = []
app.send_mail = lambda to, subject, body, html=None, image_path=None, cc=None: sent.append(
    {"to": to, "subject": subject, "body": body, "html": html, "image": bool(image_path)})
with app.db() as c:
    rows = {r["id"]: r for r in c.execute("SELECT * FROM jobs")}
mails = {}
for case in fx["mails"]:
    sent.clear()
    j = rows[case["job"]]
    if case["kind"] == "success":
        app.notify_success(j, case["first"])
    else:
        app.notify_failure(j, case["first"], case["fails"], case["reason"], case["gave_up"])
    mails[case["name"]] = sent[0]
json.dump(mails, open(os.path.join(OUT, "mails.json"), "w"), indent=1, sort_keys=True)
print("wrote", OUT)
