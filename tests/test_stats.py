"""Tests for the pure statistics/aggregation layer."""

from datetime import datetime, timedelta

from laughcounter import stats


def row(dt: datetime, duration=2.0, peak=0.9, source="test"):
    ts = dt.timestamp()
    return {
        "start_ts": ts,
        "end_ts": ts + duration,
        "duration": duration,
        "peak_score": peak,
        "mean_score": peak - 0.1,
        "source": source,
    }


def test_empty():
    now = datetime(2026, 7, 12, 12, 0, 0)
    s = stats.compute([], now=now.timestamp())
    assert s["total"] == 0
    assert s["today"] == 0
    assert s["busiest_hour"] is None
    assert s["current_streak"] == 0
    assert s["longest_laugh"] == 0.0
    assert len(s["per_hour"]) == 24
    assert len(s["per_day"]) == 14


def test_today_and_week_counts():
    now = datetime(2026, 7, 12, 20, 0, 0)
    rows = [
        row(now - timedelta(hours=1)),   # today
        row(now - timedelta(hours=2)),   # today
        row(now - timedelta(days=1)),    # yesterday (this week)
        row(now - timedelta(days=6)),    # within week
        row(now - timedelta(days=9)),    # outside week
    ]
    s = stats.compute(rows, now=now.timestamp())
    assert s["today"] == 2
    assert s["week"] == 4
    assert s["total"] == 5


def test_busiest_hour_and_histogram():
    now = datetime(2026, 7, 12, 23, 30, 0)
    base = now.replace(hour=0, minute=0, second=0)
    rows = [
        row(base.replace(hour=21)),
        row(base.replace(hour=21, minute=30)),
        row(base.replace(hour=9)),
    ]
    s = stats.compute(rows, now=now.timestamp())
    assert s["busiest_hour"] == 21
    assert s["per_hour"][21] == 2
    assert s["per_hour"][9] == 1


def test_current_streak_counts_back_from_today():
    now = datetime(2026, 7, 12, 12, 0, 0)
    rows = [
        row(now),                       # today
        row(now - timedelta(days=1)),   # yesterday
        row(now - timedelta(days=2)),   # 2 days ago
        # gap on day 3
        row(now - timedelta(days=4)),
    ]
    s = stats.compute(rows, now=now.timestamp())
    assert s["current_streak"] == 3


def test_streak_survives_empty_today():
    # No laugh yet today, but a run through yesterday still counts.
    now = datetime(2026, 7, 12, 8, 0, 0)
    rows = [
        row(now - timedelta(days=1)),
        row(now - timedelta(days=2)),
    ]
    s = stats.compute(rows, now=now.timestamp())
    assert s["current_streak"] == 2


def test_longest_streak():
    now = datetime(2026, 7, 12, 12, 0, 0)
    rows = [
        row(now - timedelta(days=10)),
        row(now - timedelta(days=9)),
        row(now - timedelta(days=8)),
        row(now - timedelta(days=7)),  # 4-day run
        row(now - timedelta(days=1)),
        row(now),                       # 2-day run
    ]
    s = stats.compute(rows, now=now.timestamp())
    assert s["longest_streak"] == 4


def test_rejected_excluded_and_speaker_breakdown():
    now = datetime(2026, 7, 12, 12, 0, 0)
    rows = [
        row(now - timedelta(hours=1)),  # unknown, auto
        {**row(now - timedelta(hours=2)), "speaker": "me", "label": "confirmed"},
        {**row(now - timedelta(hours=3)), "speaker": "guest", "label": "auto"},
        {**row(now - timedelta(hours=4)), "speaker": "me", "label": "rejected"},
    ]
    s = stats.compute(rows, now=now.timestamp())
    assert s["total"] == 3  # the rejected one is dropped
    assert s["by_speaker"] == {"me": 1, "guest": 1, "unknown": 1}
    assert s["by_label"]["rejected"] == 1
    assert s["by_label"]["confirmed"] == 1


def test_recent_carries_speaker_and_label():
    now = datetime(2026, 7, 12, 12, 0, 0)
    rows = [{**row(now, source="mic"), "id": 7, "speaker": "me", "label": "confirmed"}]
    s = stats.compute(rows, now=now.timestamp())
    assert s["recent"][0]["id"] == 7
    assert s["recent"][0]["speaker"] == "me"
    assert s["recent"][0]["label"] == "confirmed"


def test_durations_and_recent():
    now = datetime(2026, 7, 12, 12, 0, 0)
    rows = [
        row(now - timedelta(hours=1), duration=1.0),
        row(now - timedelta(hours=2), duration=5.0),
        row(now - timedelta(hours=3), duration=3.0),
    ]
    s = stats.compute(rows, now=now.timestamp(), recent_n=2)
    assert s["longest_laugh"] == 5.0
    assert s["total_duration"] == 9.0
    assert s["average_duration"] == 3.0
    assert len(s["recent"]) == 2
    # Most recent first.
    assert s["recent"][0]["duration"] == 1.0
