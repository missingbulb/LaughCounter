"""Tests for the laugh-counting state machine — the heart of the app."""

import pytest

from laughcounter.counter import LaughCounter


def feed(counter, frames):
    """Feed (ts, score) frames; return the list of finalised events."""
    events = []
    for ts, score in frames:
        ev = counter.update(ts, score)
        if ev:
            events.append(ev)
    tail = counter.flush()
    if tail:
        events.append(tail)
    return events


def test_single_clear_laugh_counts_once():
    c = LaughCounter(enter_threshold=0.5, exit_threshold=0.3, min_duration=0.4,
                     merge_gap=1.0, frame_seconds=0.48)
    frames = [(0.0, 0.9), (0.48, 0.8), (0.96, 0.85), (1.44, 0.0),
              (1.92, 0.0), (2.4, 0.0), (2.88, 0.0)]
    events = feed(c, frames)
    assert len(events) == 1
    assert c.count == 1
    ev = events[0]
    assert ev.start == 0.0
    assert ev.peak_score == pytest.approx(0.9)
    assert ev.mean_score == pytest.approx((0.9 + 0.8 + 0.85) / 3)
    assert ev.duration == pytest.approx(0.96 + 0.48)


def test_brief_blip_below_min_duration_is_ignored():
    # One short spike shorter than min_duration should not count.
    c = LaughCounter(min_duration=1.0, frame_seconds=0.1)
    frames = [(0.0, 0.9), (0.1, 0.0), (2.0, 0.0)]
    events = feed(c, frames)
    assert events == []
    assert c.count == 0


def test_hysteresis_keeps_one_laugh_together():
    # A dip between the two thresholds must not split the laugh.
    c = LaughCounter(enter_threshold=0.6, exit_threshold=0.3, min_duration=0.4,
                     merge_gap=1.0, frame_seconds=0.48)
    frames = [(0.0, 0.9), (0.48, 0.35), (0.96, 0.8),  # dip stays >= exit
              (1.44, 0.0), (1.92, 0.0), (2.4, 0.0)]
    events = feed(c, frames)
    assert len(events) == 1


def test_merge_gap_bridges_short_silence():
    # Silence shorter than merge_gap → one laugh; longer → two.
    frames_close = [(0.0, 0.9), (0.48, 0.9), (0.96, 0.0),  # 0.5s gap < 1.0
                    (1.44, 0.9), (1.92, 0.9), (2.4, 0.0), (3.5, 0.0), (4.6, 0.0)]
    c = LaughCounter(merge_gap=1.0, frame_seconds=0.48, min_duration=0.4)
    assert len(feed(c, frames_close)) == 1

    frames_far = [(0.0, 0.9), (0.48, 0.9),
                  (1.0, 0.0), (2.5, 0.0),   # >1.0s of silence → finalises first
                  (3.0, 0.9), (3.48, 0.9), (4.0, 0.0), (5.5, 0.0), (6.6, 0.0)]
    c2 = LaughCounter(merge_gap=1.0, frame_seconds=0.48, min_duration=0.4)
    assert len(feed(c2, frames_far)) == 2


def test_soft_only_frames_never_start_a_laugh():
    # Frames between the thresholds should not, on their own, begin an episode.
    c = LaughCounter(enter_threshold=0.6, exit_threshold=0.3, frame_seconds=0.48)
    frames = [(0.0, 0.4), (0.48, 0.45), (0.96, 0.4), (2.0, 0.0), (3.1, 0.0)]
    assert feed(c, frames) == []


def test_flush_emits_in_progress_episode():
    c = LaughCounter(min_duration=0.4, frame_seconds=0.48)
    # No trailing silence; the laugh is still "open" when the stream ends.
    c.update(0.0, 0.9)
    c.update(0.48, 0.9)
    assert c.active
    ev = c.flush()
    assert ev is not None
    assert not c.active
    assert c.flush() is None  # nothing left


def test_non_decreasing_timestamps_enforced():
    c = LaughCounter()
    c.update(1.0, 0.1)
    with pytest.raises(ValueError):
        c.update(0.5, 0.1)


def test_invalid_thresholds_rejected():
    with pytest.raises(ValueError):
        LaughCounter(enter_threshold=0.2, exit_threshold=0.5)
    with pytest.raises(ValueError):
        LaughCounter(frame_seconds=0.0)


def test_loud_resume_after_long_gap_is_a_new_laugh():
    # Regression: a laugh resuming with a LOUD frame after a > merge_gap silence,
    # with no below-exit frame crossing the boundary, must be a second laugh.
    c = LaughCounter(enter_threshold=0.5, exit_threshold=0.3, min_duration=0.4,
                     merge_gap=1.0, frame_seconds=0.48)
    frames = [(0.0, 0.9), (0.48, 0.0), (0.96, 0.0),
              (1.44, 0.9),  # 1.44s after the last active frame (> merge_gap) AND loud
              (1.92, 0.0), (2.4, 0.0), (2.88, 0.0)]
    events = feed(c, frames)
    assert len(events) == 2
    assert c.count == 2


def test_dropped_frames_during_silence_do_not_merge():
    # Regression: if frames are dropped/batched during a long silence, the next
    # loud frame must not glue two distant laughs into one giant "laugh".
    c = LaughCounter(merge_gap=1.0, frame_seconds=0.48, min_duration=0.4)
    frames = [(0.0, 0.9), (0.48, 0.9),
              (30.0, 0.9), (30.48, 0.9),  # big time jump, no silent frame between
              (31.0, 0.0), (32.5, 0.0)]
    events = feed(c, frames)
    assert len(events) == 2
    assert all(ev.duration < 5 for ev in events)  # neither is a bogus 30s "laugh"


def test_two_well_separated_laughs():
    c = LaughCounter(merge_gap=1.0, frame_seconds=0.48, min_duration=0.4)
    frames = []
    # laugh at t=0..1
    frames += [(0.0, 0.8), (0.48, 0.8), (0.96, 0.8)]
    frames += [(1.44, 0.0), (1.92, 0.0), (2.5, 0.0)]  # finalise #1
    # laugh at t=10..11
    frames += [(10.0, 0.8), (10.48, 0.8), (10.96, 0.8)]
    frames += [(11.44, 0.0), (11.92, 0.0), (12.5, 0.0)]  # finalise #2
    events = feed(c, frames)
    assert len(events) == 2
    assert c.count == 2
