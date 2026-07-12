"""Tests for the feedback loop: mark, relabel, speaker correction, migration."""

import sqlite3

import pytest

from laughcounter.events import LaughEvent
from laughcounter.storage import Storage, apply_label, apply_mark


def make_event(start, dur=1.0, speaker="unknown"):
    return LaughEvent(start=start, end=start + dur, duration=dur,
                      peak_score=0.8, mean_score=0.6, source="mic", speaker=speaker)


def test_mark_confirms_recent_detection(tmp_path):
    store = Storage(tmp_path / "l.db")
    now = 1000.0
    store.add(make_event(now - 2.0), label="auto")  # a fresh unconfirmed detection
    result = store.mark(now=now, who="me", window=8.0)
    assert result["matched"] is True
    row = store.get(result["id"])
    assert row["label"] == "confirmed"
    assert row["speaker"] == "me"
    store.close()


def test_mark_without_detection_logs_missed(tmp_path):
    store = Storage(tmp_path / "l.db")
    result = store.mark(now=1000.0, who="me", window=8.0)
    assert result["matched"] is False
    row = store.get(result["id"])
    assert row["label"] == "missed"
    assert row["source"] == "manual"
    store.close()


def test_mark_ignores_old_detection(tmp_path):
    store = Storage(tmp_path / "l.db")
    now = 1000.0
    store.add(make_event(now - 60.0), label="auto")  # too long ago
    result = store.mark(now=now, window=8.0)
    assert result["matched"] is False  # logged as missed instead
    store.close()


def test_mark_as_guest(tmp_path):
    store = Storage(tmp_path / "l.db")
    now = 1000.0
    rid = store.add(make_event(now - 1.0), label="auto")
    store.mark(now=now, who="guest")
    assert store.get(rid)["speaker"] == "guest"
    store.close()


def test_set_label_and_speaker_validation(tmp_path):
    store = Storage(tmp_path / "l.db")
    rid = store.add(make_event(1.0))
    assert store.set_label(rid, "rejected") is True
    assert store.get(rid)["label"] == "rejected"
    assert store.set_speaker(rid, "guest") is True
    with pytest.raises(ValueError):
        store.set_label(rid, "bogus")
    with pytest.raises(ValueError):
        store.set_speaker(rid, "nobody")
    assert store.set_label(9999, "rejected") is False  # no such row
    store.close()


def test_apply_helpers_are_standalone(tmp_path):
    db = tmp_path / "l.db"
    Storage(db).close()  # create schema
    res = apply_mark(db, who="me", now=1000.0)
    assert res["action"] == "missed"
    rid = res["id"]
    r2 = apply_label(db, rid, "reject")
    assert r2["ok"] is True
    r3 = apply_label(db, rid, "guest")
    assert r3["ok"] is True
    with pytest.raises(ValueError):
        apply_label(db, rid, "nonsense")


def test_rejected_excluded_from_counts(tmp_path):
    store = Storage(tmp_path / "l.db")
    a = store.add(make_event(1.0))
    store.add(make_event(2.0))
    store.set_label(a, "rejected")
    assert store.count() == 1               # default excludes rejected
    assert store.count(include_rejected=True) == 2
    store.close()


def test_migration_from_old_schema(tmp_path):
    # Simulate a v0.1 database that predates speaker/clip_path/label.
    db = tmp_path / "old.db"
    conn = sqlite3.connect(db)
    conn.executescript(
        """
        CREATE TABLE laughs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            start_ts REAL NOT NULL, end_ts REAL NOT NULL, duration REAL NOT NULL,
            peak_score REAL NOT NULL, mean_score REAL NOT NULL,
            source TEXT NOT NULL DEFAULT 'mic', created_at REAL NOT NULL
        );
        INSERT INTO laughs (start_ts,end_ts,duration,peak_score,mean_score,source,created_at)
        VALUES (1.0, 2.0, 1.0, 0.9, 0.7, 'mic', 5.0);
        """
    )
    conn.commit()
    conn.close()

    store = Storage(db)  # opening should migrate in the new columns
    rows = store.all()
    assert len(rows) == 1
    assert rows[0]["speaker"] == "unknown"
    assert rows[0]["label"] == "auto"
    assert rows[0]["clip_path"] is None
    # And it's usable for new writes/feedback.
    store.set_label(rows[0]["id"], "confirmed")
    assert store.get(rows[0]["id"])["label"] == "confirmed"
    store.close()
