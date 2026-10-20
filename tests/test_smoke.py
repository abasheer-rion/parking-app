"""Smoke tests. They use a temp database, send no email and never open a browser."""
import importlib
import os
import re
import subprocess
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest.fixture()
def env(tmp_path, monkeypatch):
    db = str(tmp_path / "test.db")
    monkeypatch.setenv("PARKING_DB", db)
    monkeypatch.setenv("WORKER", "mock")
    monkeypatch.setenv("BASE_URL", "http://test")
    for k in ("GMAIL_USER", "GMAIL_APP_PASSWORD", "NOTIFY_ALSO"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.syspath_prepend(ROOT)
    return db


@pytest.fixture()
def app_mod(env):
    sys.modules.pop("app", None)
    mod = importlib.import_module("app")
    assert mod.DB == env, "app must use the temp database"
    mod.init()
    return mod


@pytest.fixture()
def client(app_mod):
    app_mod.app.config["TESTING"] = True
    return app_mod.app.test_client()


def test_robots_disallows_all(client):
    r = client.get("/robots.txt")
    assert r.status_code == 200
    assert "Disallow: /" in r.get_data(as_text=True)


def test_unknown_token_is_404(client):
    assert client.get("/u/not-a-real-token").status_code == 404


def test_security_headers(client):
    r = client.get("/robots.txt")
    assert "noindex" in r.headers.get("X-Robots-Tag", "")
    assert "default-src 'self'" in r.headers.get("Content-Security-Policy", "")


def test_friend_page_loads(env, client):
    # Use the app's own add-friend command against the temp database.
    out = subprocess.run([sys.executable, os.path.join(ROOT, "app.py"), "add-friend", "Test Friend"],
                         env=os.environ.copy(), capture_output=True, text=True, timeout=60, check=True).stdout
    token = re.search(r"/u/(\S+)", out).group(1)
    r = client.get(f"/u/{token}")
    assert r.status_code == 200
    assert "Test Friend" in r.get_data(as_text=True)
    assert r.headers.get("Cache-Control") == "no-store"
    assert "noindex" in r.headers.get("X-Robots-Tag", "")
