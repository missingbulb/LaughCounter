"""Tests for the local web dashboard (stdlib http.server)."""

import http.client
import json
import threading

from laughcounter.dashboard import build_stats, make_server
from laughcounter.events import LaughEvent
from laughcounter.storage import Storage


def _seed(db_path):
    store = Storage(db_path)
    store.add(LaughEvent(start=1000.0, end=1002.0, duration=2.0,
                         peak_score=0.9, mean_score=0.7, source="test"))
    store.close()


def test_build_stats(tmp_path):
    db = tmp_path / "l.db"
    _seed(db)
    payload = build_stats(db)
    assert payload["total"] == 1
    assert isinstance(payload["per_hour"], list)


def test_server_serves_page_and_api(tmp_path):
    db = tmp_path / "l.db"
    _seed(db)
    server = make_server(db, host="127.0.0.1", port=0)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)

        conn.request("GET", "/")
        resp = conn.getresponse()
        body = resp.read().decode()
        assert resp.status == 200
        assert "text/html" in resp.getheader("Content-Type")
        assert "LaughCounter" in body

        conn.request("GET", "/api/stats")
        resp = conn.getresponse()
        data = json.loads(resp.read())
        assert resp.status == 200
        assert data["total"] == 1

        conn.request("GET", "/nope")
        resp = conn.getresponse()
        resp.read()
        assert resp.status == 404
        conn.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_post_mark_and_label(tmp_path):
    db = tmp_path / "l.db"
    _seed(db)  # one row exists
    server = make_server(db, host="127.0.0.1", port=0)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        headers = {"Content-Type": "application/json"}

        # "I just laughed" with no recent detection → logs a missed laugh.
        conn.request("POST", "/api/mark", json.dumps({"who": "me"}), headers)
        resp = conn.getresponse()
        res = json.loads(resp.read())
        assert resp.status == 200
        assert res["action"] in ("missed", "confirmed")

        # Relabel the seeded row (id 1) as not-a-laugh.
        conn.request("POST", "/api/label", json.dumps({"id": 1, "action": "reject"}), headers)
        resp = conn.getresponse()
        res = json.loads(resp.read())
        assert resp.status == 200
        assert res["ok"] is True

        # Bad body → 400, not a crash.
        conn.request("POST", "/api/label", "{not json", headers)
        resp = conn.getresponse()
        resp.read()
        assert resp.status == 400

        # Unknown action → 400.
        conn.request("POST", "/api/label", json.dumps({"id": 1, "action": "zzz"}), headers)
        resp = conn.getresponse()
        resp.read()
        assert resp.status == 400

        # Wrong content type → 415 (basic CSRF protection).
        conn.request("POST", "/api/mark", json.dumps({"who": "me"}),
                     {"Content-Type": "text/plain"})
        resp = conn.getresponse()
        resp.read()
        assert resp.status == 415

        # A literal JSON null (or any non-object) → 400, never a hang.
        conn.request("POST", "/api/mark", "null", headers)
        resp = conn.getresponse()
        resp.read()
        assert resp.status == 400

        conn.request("POST", "/api/mark", "[1, 2, 3]", headers)
        resp = conn.getresponse()
        resp.read()
        assert resp.status == 400
        conn.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
