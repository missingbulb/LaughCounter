"""Aggregate laugh events into the numbers people actually want to see.

:func:`compute` is a pure function over a list of row dicts, which makes it
deterministic and easy to test.  All bucketing is done in *local* time because
"how many times did I laugh today?" is a wall-clock question, not a UTC one.
"""

from __future__ import annotations

from datetime import datetime, date, timedelta
from typing import Optional


def _local_date(epoch: float) -> date:
    return datetime.fromtimestamp(epoch).date()


def _local_hour(epoch: float) -> int:
    return datetime.fromtimestamp(epoch).hour


def compute(
    rows: list[dict],
    now: float,
    day_window: int = 14,
    recent_n: int = 10,
) -> dict:
    """Summarise ``rows`` (as returned by :class:`~laughcounter.storage.Storage`).

    ``rejected`` events (your "that wasn't a laugh" feedback) are excluded from
    every count *except* ``by_label``, which tallies all labels (including
    ``rejected``) as a detection-health readout. All bucketing is in local time.

    Args:
        rows: Event dicts with at least ``start_ts`` and ``duration``. May carry
            ``label`` and ``speaker``; defaults are ``auto``/``unknown``.
        now: Current time in epoch seconds (injected so results are testable).
        day_window: How many days of the daily histogram to return.
        recent_n: How many recent events to include.

    Returns a JSON-serialisable dict of totals, histograms, streaks and recents.
    """
    today = _local_date(now)

    # Detection-health tally over *all* rows, before dropping rejected ones.
    by_label = {"auto": 0, "confirmed": 0, "missed": 0, "rejected": 0}
    for r in rows:
        lbl = r.get("label", "auto")
        by_label[lbl] = by_label.get(lbl, 0) + 1

    # Everything else is over valid (non-rejected) laughs only.
    rows = [r for r in rows if r.get("label", "auto") != "rejected"]
    durations = [float(r["duration"]) for r in rows]

    # Counts per local calendar day, and who laughed.
    per_day_counts: dict[date, int] = {}
    per_hour = [0] * 24
    by_speaker = {"me": 0, "guest": 0, "unknown": 0}
    for r in rows:
        d = _local_date(r["start_ts"])
        per_day_counts[d] = per_day_counts.get(d, 0) + 1
        per_hour[_local_hour(r["start_ts"])] += 1
        spk = r.get("speaker", "unknown")
        by_speaker[spk] = by_speaker.get(spk, 0) + 1

    today_count = per_day_counts.get(today, 0)

    # Rolling 7-day window (today and the previous six days).
    week_count = sum(
        per_day_counts.get(today - timedelta(days=i), 0) for i in range(7)
    )

    # Daily histogram for the dashboard, oldest first.
    per_day = []
    for i in range(day_window - 1, -1, -1):
        d = today - timedelta(days=i)
        per_day.append({"date": d.isoformat(), "count": per_day_counts.get(d, 0)})

    return {
        "generated_at": now,
        "total": len(rows),
        "today": today_count,
        "week": week_count,
        "total_duration": round(sum(durations), 2),
        "longest_laugh": round(max(durations), 2) if durations else 0.0,
        "average_duration": round(sum(durations) / len(durations), 2) if durations else 0.0,
        "busiest_hour": _busiest_hour(per_hour),
        "current_streak": _current_streak(per_day_counts, today),
        "longest_streak": _longest_streak(per_day_counts),
        "active_days": len(per_day_counts),
        "by_speaker": by_speaker,
        "by_label": by_label,
        "per_hour": per_hour,
        "per_day": per_day,
        "recent": _recent(rows, recent_n),
    }


def _busiest_hour(per_hour: list[int]) -> Optional[int]:
    if not any(per_hour):
        return None
    return max(range(24), key=lambda h: per_hour[h])


def _current_streak(per_day_counts: dict[date, int], today: date) -> int:
    """Consecutive days ending today (or yesterday) with at least one laugh.

    Today not having laughed *yet* should not reset a running streak, so if today
    is empty we start counting from yesterday.
    """
    streak = 0
    start = today if per_day_counts.get(today, 0) > 0 else today - timedelta(days=1)
    day = start
    while per_day_counts.get(day, 0) > 0:
        streak += 1
        day -= timedelta(days=1)
    return streak


def _longest_streak(per_day_counts: dict[date, int]) -> int:
    if not per_day_counts:
        return 0
    days = sorted(per_day_counts)
    longest = 1
    run = 1
    for prev, cur in zip(days, days[1:]):
        if cur - prev == timedelta(days=1):
            run += 1
            longest = max(longest, run)
        else:
            run = 1
    return longest


def _recent(rows: list[dict], n: int) -> list[dict]:
    ordered = sorted(rows, key=lambda r: r["start_ts"], reverse=True)[:n]
    out = []
    for r in ordered:
        out.append(
            {
                "id": r.get("id"),
                "start_ts": r["start_ts"],
                "start_iso": datetime.fromtimestamp(r["start_ts"]).isoformat(
                    timespec="seconds"
                ),
                "duration": round(float(r["duration"]), 2),
                "peak_score": round(float(r.get("peak_score", 0.0)), 3),
                "source": r.get("source", "mic"),
                "speaker": r.get("speaker", "unknown"),
                "label": r.get("label", "auto"),
                "has_clip": bool(r.get("clip_path")),
            }
        )
    return out


def summary(storage, now: float, **kwargs) -> dict:
    """Convenience wrapper: pull all rows from ``storage`` and :func:`compute`."""
    return compute(storage.all(), now=now, **kwargs)
