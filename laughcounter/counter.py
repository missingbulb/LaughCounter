"""The laugh-counting state machine.

A detector produces a *laughter probability* (0..1) for each short frame of
audio, many times per second.  Turning that noisy stream into a sensible count
of "laughs" is the interesting part, and it is what :class:`LaughCounter` does.

The algorithm is a small hysteresis state machine:

* An episode **starts** when a frame's score rises to or above
  ``enter_threshold`` (a confident laugh, not a stray blip).
* Once started, the episode **stays alive** while scores remain at or above the
  lower ``exit_threshold``.  Using a separate, lower threshold to *continue*
  prevents a single dip from chopping one laugh into two (classic hysteresis).
* Brief silences are **bridged**: if laughter resumes within ``merge_gap``
  seconds it is treated as the same episode.  This is why a fit of giggles with
  little breaths in between counts as one laugh, not ten.
* An episode **ends** once there has been no laughter for longer than
  ``merge_gap``.  It is only *recorded* if it lasted at least ``min_duration``
  seconds, which discards momentary false positives.

The class is deterministic and has no I/O, so it is trivially unit-testable:
feed it ``(timestamp, score)`` pairs and inspect the events it returns.
"""

from __future__ import annotations

from typing import Optional

from .events import LaughEvent


class LaughCounter:
    """Collapse a stream of per-frame laughter scores into discrete events.

    Call :meth:`update` once per frame (silent frames included — they are how the
    machine learns an episode has ended).  It returns a :class:`LaughEvent` on
    the frame where an episode is finalised, otherwise ``None``.  Call
    :meth:`flush` when the stream ends to emit any episode still in progress.
    """

    def __init__(
        self,
        enter_threshold: float = 0.5,
        exit_threshold: float = 0.3,
        min_duration: float = 0.4,
        merge_gap: float = 1.0,
        frame_seconds: float = 0.48,
        source: str = "mic",
    ) -> None:
        if not 0.0 <= exit_threshold <= enter_threshold <= 1.0:
            raise ValueError(
                "thresholds must satisfy 0 <= exit_threshold <= enter_threshold <= 1 "
                f"(got exit={exit_threshold}, enter={enter_threshold})"
            )
        if min_duration < 0 or merge_gap < 0 or frame_seconds <= 0:
            raise ValueError("durations must be non-negative and frame_seconds > 0")

        self.enter_threshold = enter_threshold
        self.exit_threshold = exit_threshold
        self.min_duration = min_duration
        self.merge_gap = merge_gap
        self.frame_seconds = frame_seconds
        self.source = source

        self.count = 0  # episodes recorded so far (>= min_duration)
        self._last_ts: Optional[float] = None
        self._reset_episode()

    # -- public API ---------------------------------------------------------

    @property
    def active(self) -> bool:
        """True while an episode is open (including during a bridged silence)."""
        return self._start is not None

    def update(self, ts: float, score: float) -> Optional[LaughEvent]:
        """Feed one frame. Returns a finalised :class:`LaughEvent` or ``None``.

        Args:
            ts: Frame timestamp in epoch seconds. Must be non-decreasing across
                calls; a frame that goes backwards in time raises ``ValueError``.
            score: Laughter probability in ``[0, 1]``.
        """
        if self._last_ts is not None and ts < self._last_ts:
            raise ValueError(
                f"timestamps must be non-decreasing (got {ts} after {self._last_ts})"
            )
        self._last_ts = ts

        loud = score >= self.enter_threshold
        soft = score >= self.exit_threshold
        result: Optional[LaughEvent] = None

        if self._start is None:
            # No episode open. Only a confident frame may start one.
            if loud:
                self._begin(ts, score)
        elif soft:
            # Episode continues (or resumes within a bridged silence).
            self._extend(ts, score)
        elif ts - self._last_active > self.merge_gap:
            # Silence has outlasted the merge gap: the episode is over.
            result = self._finalize()

        return result

    def flush(self) -> Optional[LaughEvent]:
        """Finalise any episode still open. Call this when the stream ends."""
        if self._start is None:
            return None
        return self._finalize()

    # -- internals ----------------------------------------------------------

    def _reset_episode(self) -> None:
        self._start: Optional[float] = None
        self._last_active: float = 0.0
        self._peak: float = 0.0
        self._sum: float = 0.0
        self._n: int = 0

    def _begin(self, ts: float, score: float) -> None:
        self._start = ts
        self._last_active = ts
        self._peak = score
        self._sum = score
        self._n = 1

    def _extend(self, ts: float, score: float) -> None:
        self._last_active = ts
        self._peak = max(self._peak, score)
        self._sum += score
        self._n += 1

    def _finalize(self) -> Optional[LaughEvent]:
        assert self._start is not None
        start = self._start
        # Each score covers roughly ``frame_seconds`` of audio, so the episode
        # extends a little past the last active frame's timestamp.
        end = self._last_active + self.frame_seconds
        duration = end - start
        event: Optional[LaughEvent] = None
        if duration >= self.min_duration:
            event = LaughEvent(
                start=start,
                end=end,
                duration=duration,
                peak_score=self._peak,
                mean_score=self._sum / self._n if self._n else 0.0,
                source=self.source,
            )
            self.count += 1
        self._reset_episode()
        return event
