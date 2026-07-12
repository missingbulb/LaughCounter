"""Durable storage for laugh events.

Events go to a SQLite database (queryable, the source of truth) and are also
appended to a JSONL file (human-readable, easy to grep, trivially portable).

Each event carries:

* who laughed (``speaker``: ``me`` / ``guest`` / ``unknown``),
* an optional ``clip_path`` to a short saved audio snippet of the laugh (so the
  model can be improved over time — see :mod:`laughcounter.clips`), and
* a ``label`` recording your feedback:

  =========== =================================================================
  ``auto``    detected by the microphone, not yet reviewed by you
  ``confirmed`` you confirmed it (or your "I just laughed" tap matched it)
  ``missed``  you said you laughed but detection didn't catch it (false negative)
  ``rejected`` you said it wasn't a laugh / wasn't real (false positive)
  =========== =================================================================

``rejected`` events are excluded from all counts; the rest are what make the
feedback loop able to improve accuracy.

Connections are short-lived and thread-confined: reads and feedback writes from
the dashboard each open their own connection, which keeps SQLite happy across
threads without locking gymnastics.
"""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Iterable, Optional

from .events import LaughEvent, _iso, utcnow

_SCHEMA = """
CREATE TABLE IF NOT EXISTS laughs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    start_ts   REAL NOT NULL,
    end_ts     REAL NOT NULL,
    duration   REAL NOT NULL,
    peak_score REAL NOT NULL,
    mean_score REAL NOT NULL,
    source     TEXT NOT NULL DEFAULT 'mic',
    speaker    TEXT NOT NULL DEFAULT 'unknown',
    clip_path  TEXT,
    label      TEXT NOT NULL DEFAULT 'auto',
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_laughs_start ON laughs(start_ts);
"""

# Columns added after v0.1; migrated in on first open of an older database.
_ADDED_COLUMNS = {
    "speaker": "TEXT NOT NULL DEFAULT 'unknown'",
    "clip_path": "TEXT",
    "label": "TEXT NOT NULL DEFAULT 'auto'",
}

_COLUMNS = (
    "id, start_ts, end_ts, duration, peak_score, mean_score, "
    "source, speaker, clip_path, label, created_at"
)

VALID_LABELS = ("auto", "confirmed", "missed", "rejected")
VALID_SPEAKERS = ("me", "guest", "unknown")


class Storage:
    """A thin, safe wrapper over the SQLite laughs table."""

    def __init__(self, db_path: str | Path, jsonl_path: str | Path | None = None):
        self.db_path = str(db_path)
        self.jsonl_path = Path(jsonl_path) if jsonl_path else None
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.db_path)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(_SCHEMA)
        self._migrate()
        self._conn.commit()

    def _migrate(self) -> None:
        existing = {r["name"] for r in self._conn.execute("PRAGMA table_info(laughs)")}
        for name, decl in _ADDED_COLUMNS.items():
            if name not in existing:
                self._conn.execute(f"ALTER TABLE laughs ADD COLUMN {name} {decl}")

    # -- writing ------------------------------------------------------------

    def add(
        self,
        event: LaughEvent,
        label: str = "auto",
        created_at: Optional[float] = None,
    ) -> int:
        """Persist one event; returns its new row id."""
        if label not in VALID_LABELS:
            raise ValueError(f"unknown label {label!r}")
        created_at = time.time() if created_at is None else created_at
        cur = self._conn.execute(
            "INSERT INTO laughs "
            "(start_ts, end_ts, duration, peak_score, mean_score, source, "
            " speaker, clip_path, label, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                event.start,
                event.end,
                event.duration,
                event.peak_score,
                event.mean_score,
                event.source,
                event.speaker,
                event.clip_path,
                label,
                created_at,
            ),
        )
        self._conn.commit()
        rowid = int(cur.lastrowid)
        if self.jsonl_path is not None:
            self._append_jsonl(event, rowid, label, created_at)
        return rowid

    def _append_jsonl(self, event, rowid, label, created_at) -> None:
        self.jsonl_path.parent.mkdir(parents=True, exist_ok=True)
        record = event.to_dict()
        record["id"] = rowid
        record["label"] = label
        record["created_at"] = created_at
        record["created_at_iso"] = _iso(created_at)
        with self.jsonl_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record) + "\n")

    def set_label(self, rowid: int, label: str) -> bool:
        if label not in VALID_LABELS:
            raise ValueError(f"unknown label {label!r}")
        cur = self._conn.execute(
            "UPDATE laughs SET label = ? WHERE id = ?", (label, int(rowid))
        )
        self._conn.commit()
        return cur.rowcount > 0

    def set_speaker(self, rowid: int, speaker: str) -> bool:
        if speaker not in VALID_SPEAKERS:
            raise ValueError(f"unknown speaker {speaker!r}")
        cur = self._conn.execute(
            "UPDATE laughs SET speaker = ? WHERE id = ?", (speaker, int(rowid))
        )
        self._conn.commit()
        return cur.rowcount > 0

    def mark(self, now: Optional[float] = None, who: str = "me",
             window: float = 8.0) -> dict:
        """Record an "I just laughed" tap.

        If a recently auto-detected laugh (within ``window`` seconds and not yet
        confirmed or rejected) exists, confirm it and attribute it to ``who``.
        Otherwise record a *missed* laugh — a valuable false-negative signal.
        """
        now = utcnow() if now is None else now
        if who not in VALID_SPEAKERS:
            raise ValueError(f"unknown speaker {who!r}")
        row = self._conn.execute(
            "SELECT id FROM laughs WHERE label = 'auto' "
            "AND start_ts >= ? AND start_ts <= ? ORDER BY start_ts DESC LIMIT 1",
            (now - window, now + 1.0),
        ).fetchone()
        if row is not None:
            self.set_label(row["id"], "confirmed")
            self.set_speaker(row["id"], who)
            return {"matched": True, "id": int(row["id"]), "action": "confirmed"}
        event = LaughEvent(
            start=now - 0.5, end=now, duration=0.5,
            peak_score=0.0, mean_score=0.0, source="manual", speaker=who,
        )
        rowid = self.add(event, label="missed")
        return {"matched": False, "id": rowid, "action": "missed"}

    def add_many(self, events: Iterable[LaughEvent]) -> int:
        n = 0
        for ev in events:
            self.add(ev)
            n += 1
        return n

    # -- reading ------------------------------------------------------------

    def get(self, rowid: int) -> Optional[dict]:
        row = self._conn.execute(
            f"SELECT {_COLUMNS} FROM laughs WHERE id = ?", (int(rowid),)
        ).fetchone()
        return dict(row) if row else None

    def count(self, include_rejected: bool = False) -> int:
        sql = "SELECT COUNT(*) AS n FROM laughs"
        if not include_rejected:
            sql += " WHERE label != 'rejected'"
        return int(self._conn.execute(sql).fetchone()["n"])

    def total_duration(self) -> float:
        row = self._conn.execute(
            "SELECT COALESCE(SUM(duration), 0.0) AS d FROM laughs "
            "WHERE label != 'rejected'"
        ).fetchone()
        return float(row["d"])

    def recent(self, limit: int = 10, include_rejected: bool = True) -> list[dict]:
        sql = f"SELECT {_COLUMNS} FROM laughs"
        if not include_rejected:
            sql += " WHERE label != 'rejected'"
        sql += " ORDER BY start_ts DESC LIMIT ?"
        rows = self._conn.execute(sql, (int(limit),)).fetchall()
        return [dict(r) for r in rows]

    def all(self) -> list[dict]:
        rows = self._conn.execute(
            f"SELECT {_COLUMNS} FROM laughs ORDER BY start_ts ASC"
        ).fetchall()
        return [dict(r) for r in rows]

    def between(self, start_ts: float, end_ts: float) -> list[dict]:
        rows = self._conn.execute(
            f"SELECT {_COLUMNS} FROM laughs "
            "WHERE start_ts >= ? AND start_ts < ? ORDER BY start_ts ASC",
            (start_ts, end_ts),
        ).fetchall()
        return [dict(r) for r in rows]

    def close(self) -> None:
        self._conn.close()

    def __enter__(self) -> "Storage":
        return self

    def __exit__(self, *exc) -> None:
        self.close()


# -- thread-safe helpers (each opens its own connection) --------------------

def read_rows(db_path: str | Path) -> list[dict]:
    """Return all rows from ``db_path``, opening and closing a connection.

    Used by the dashboard so each HTTP request gets its own connection instead
    of sharing one across threads. Returns ``[]`` if the table does not exist.
    """
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            f"SELECT {_COLUMNS} FROM laughs ORDER BY start_ts ASC"
        ).fetchall()
        return [dict(r) for r in rows]
    except sqlite3.OperationalError:
        return []
    finally:
        conn.close()


def apply_mark(db_path: str | Path, who: str = "me", now: Optional[float] = None) -> dict:
    """Thread-safe "I just laughed" for the dashboard/CLI."""
    with Storage(db_path) as store:
        return store.mark(now=now, who=who)


def apply_label(db_path: str | Path, rowid: int, action: str) -> dict:
    """Thread-safe relabel for the dashboard/CLI.

    ``action`` is one of: ``reject`` (not a laugh), ``confirm``, ``me``,
    ``guest`` (speaker corrections).
    """
    with Storage(db_path) as store:
        if action == "reject":
            ok = store.set_label(rowid, "rejected")
        elif action == "confirm":
            ok = store.set_label(rowid, "confirmed")
        elif action in ("me", "guest"):
            ok = store.set_speaker(rowid, action)
        else:
            raise ValueError(f"unknown action {action!r}")
        return {"ok": bool(ok), "id": int(rowid), "action": action}
