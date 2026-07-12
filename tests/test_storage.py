"""Tests for SQLite + JSONL storage."""

import json

from laughcounter.events import LaughEvent
from laughcounter.storage import Storage, read_rows


def make_event(start=100.0, dur=2.0, source="test"):
    return LaughEvent(start=start, end=start + dur, duration=dur,
                      peak_score=0.9, mean_score=0.7, source=source)


def test_add_and_read_back(tmp_path):
    db = tmp_path / "l.db"
    jsonl = tmp_path / "l.jsonl"
    store = Storage(db, jsonl)
    rowid = store.add(make_event(), created_at=123.0)
    assert rowid == 1
    assert store.count() == 1
    assert store.total_duration() == 2.0
    rows = store.all()
    assert rows[0]["source"] == "test"
    assert rows[0]["created_at"] == 123.0
    store.close()

    # JSONL mirror written with an ISO timestamp.
    line = json.loads(jsonl.read_text().strip())
    assert line["id"] == 1
    assert line["source"] == "test"
    assert "start_iso" in line


def test_recent_and_ordering(tmp_path):
    store = Storage(tmp_path / "l.db")
    for i in range(5):
        store.add(make_event(start=100.0 + i * 10))
    recent = store.recent(3)
    assert [r["start_ts"] for r in recent] == [140.0, 130.0, 120.0]
    all_rows = store.all()
    assert [r["start_ts"] for r in all_rows] == [100, 110, 120, 130, 140]
    store.close()


def test_between(tmp_path):
    store = Storage(tmp_path / "l.db")
    for i in range(5):
        store.add(make_event(start=i * 10.0))
    got = store.between(10.0, 30.0)  # [10, 30)
    assert [r["start_ts"] for r in got] == [10.0, 20.0]
    store.close()


def test_read_rows_missing_db_is_empty(tmp_path):
    # Fresh path, table never created → helper returns [] instead of raising.
    assert read_rows(tmp_path / "nope.db") == []


def test_read_rows_thread_safe_helper(tmp_path):
    store = Storage(tmp_path / "l.db")
    store.add(make_event())
    store.close()
    rows = read_rows(tmp_path / "l.db")
    assert len(rows) == 1
