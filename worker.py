"""Drives the registermyplate.com visitor wizard for one vehicle.

register(vehicle, email, dry_run=False) -> dict(ok, message, expires_hours)
dry_run stops at the Review step and does not submit anything.
Set WORKER=mock in the environment to skip the browser entirely.
"""
import os
import re
import time
import imaplib
from datetime import datetime
import email as emaillib

URL = "https://registermyplate.com/visitors/"
PROPERTY = os.environ.get("PROPERTY", "SAMPLE COURT")
UNIT = os.environ.get("UNIT", "101")
M = "ctl00$MainContent$"
LOGDIR = os.path.join(os.path.dirname(__file__), "logs")


def _next(pg, name):
    pg.click(f"input[name='{M}{name}']")
    pg.wait_for_load_state("networkidle")
    pg.wait_for_timeout(1500)


def _submits(pg):
    return pg.evaluate(
        "()=>[...document.querySelectorAll('input[type=submit]')]"
        ".filter(e=>e.offsetParent).map(e=>e.name.replace('ctl00$MainContent$','')+'='+e.value)"
    )


def _body(pg):
    return pg.evaluate(
        "()=>{const c=document.body.cloneNode(true);"
        "c.querySelectorAll('select,option,script,style').forEach(e=>e.remove());"
        "return c.innerText.replace(/\\s+/g,' ')}"
    )


def _read_code_from_inbox(since_ts, wait=90):
    """Poll the Gmail inbox for a numeric code or link sent by the site."""
    user, pw = os.environ.get("GMAIL_USER"), os.environ.get("GMAIL_APP_PASSWORD")
    if not user or not pw:
        raise RuntimeError("Gmail credentials not set, cannot read verification email")
    end = time.time() + wait
    while time.time() < end:
        box = imaplib.IMAP4_SSL("imap.gmail.com")
        box.login(user, pw)
        box.select("INBOX")
        _, data = box.search(None, "UNSEEN")
        for num in reversed(data[0].split()):
            _, msg = box.fetch(num, "(RFC822)")
            m = emaillib.message_from_bytes(msg[0][1])
            if "registermyplate" not in (m.get("From", "") + m.get("Subject", "")).lower() \
               and "wrecker" not in m.get("From", "").lower():
                continue
            body = ""
            for part in m.walk():
                if part.get_content_type() in ("text/plain", "text/html"):
                    body += part.get_payload(decode=True).decode(errors="ignore")
            code = re.search(r"\b(\d{4,8})\b", re.sub(r"<[^>]+>", " ", body))
            link = re.search(r"https://registermyplate\.com/\S+", body)
            box.store(num, "+FLAGS", "\\Seen")
            box.logout()
            return {"code": code.group(1) if code else None, "link": link.group(0).rstrip('">') if link else None}
        box.logout()
        time.sleep(5)
    raise RuntimeError("Verification email did not arrive in time")


QR_SEL = "#MainContent_img_QRC"


def _collect(pg, stamp):
    """Read the Results page: confirmation code, expiry and the QR image."""
    text = pg.inner_text("body")
    m = re.search(r"Confirmation Code\s*([A-Z0-9][A-Z0-9-]{5,})", text, re.I)
    code = m.group(1).strip() if m else None
    e = re.search(r"Expires\s*(\d{1,2}/\d{1,2}/\d{4}\s+\d{1,2}:\d{2}:\d{2}\s*[AP]M)", text, re.I)
    expires_ts = None
    if e:
        try:
            expires_ts = datetime.strptime(re.sub(r"\s+", " ", e.group(1).upper()), "%m/%d/%Y %I:%M:%S %p").timestamp()
        except ValueError:
            pass
    qr_path = None
    try:
        pg.locator(QR_SEL).first.wait_for(state="visible", timeout=5000)
        qr_path = os.path.join(LOGDIR, f"qr-{stamp}.png")
        pg.locator(QR_SEL).first.screenshot(path=qr_path)
    except Exception:
        qr_path = None
    pg.screenshot(path=os.path.join(LOGDIR, f"result-{stamp}.png"), full_page=True)
    return {"ok": bool(code), "message": "registered" if code else "no confirmation code found",
            "expires_ts": expires_ts, "confirmation": code, "qr_path": qr_path,
            "existing": "already exists" in text.lower(), "result_text": text[:1500]}


def register(v, email, dry_run=False):
    if os.environ.get("WORKER") == "mock":
        return {"ok": True, "message": "mock registration", "expires_ts": time.time() + 86400, "confirmation": "MOCK-1234", "qr_path": None, "existing": False}
    from playwright.sync_api import sync_playwright
    started = time.time()
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        try:
            pg.goto(URL, wait_until="networkidle", timeout=60000)
            pg.select_option("#MainContent_ddl_Property", label=PROPERTY)
            pg.wait_for_timeout(1200)
            _next(pg, "btn_Property_Next")
            pg.click("text=Guest Parking")
            pg.wait_for_timeout(600)
            _next(pg, "btn_Products_Next")
            pg.fill(f"input[name='{M}txt_Apartment']", UNIT)
            _next(pg, "btn_Apartment_Next")
            pg.fill(f"input[name='{M}txt_Plate']", v["plate"])
            pg.fill(f"input[name='{M}txt_Make']", v["make"])
            pg.fill(f"input[name='{M}txt_Model']", v["model"])
            pg.fill(f"input[name='{M}txt_Color']", v["color"])
            pg.select_option(f"select[name='{M}ddl_State']", value=v["state"])
            _next(pg, "btn_Vehicle_Next")
            if pg.locator(QR_SEL).count():
                return _collect(pg, int(started))
            pg.fill(f"input[name='{M}txt_Email']", email)
            if dry_run:
                return {"ok": True, "message": "dry run reached Contact step with email filled, nothing sent", "expires_hours": 0}
            _next(pg, "btn_Contact_Next")

            # Payment (free) then Review & Confirm. The review step asks for the plate again and a checkbox.
            submitted = False
            for _ in range(6):
                names = _submits(pg)
                low = _body(pg).lower()
                nxt = [n.split("=")[0] for n in names if "previous" not in n.lower()]
                if not nxt:
                    break
                if "review & confirm" in low or "re-enter plate" in low:
                    pg.locator("input[type=text]:visible").first.fill(v["plate"])
                    pg.locator("input[type=checkbox]:visible").first.check()
                    _next(pg, nxt[0])
                    submitted = True
                    break
                _next(pg, nxt[0])
            if not submitted:
                raise RuntimeError("Never reached the Review step")

            try:
                pg.wait_for_selector(QR_SEL, timeout=25000)
            except Exception:
                pass
            r = _collect(pg, int(started))
            if not r["ok"]:
                r["message"] = "site did not confirm: " + pg.inner_text("body")[-300:]
            return r
        except Exception as e:
            try:
                pg.screenshot(path=os.path.join(LOGDIR, f"fail-{int(started)}.png"), full_page=True)
            except Exception:
                pass
            return {"ok": False, "message": f"{type(e).__name__}: {e}", "expires_hours": 0}
        finally:
            b.close()
