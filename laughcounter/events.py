"""The :class:`LaughEvent` value object.

A :class:`LaughEvent` describes one discrete *episode* of laughter — not a single
audio frame.  A burst of giggling that lasts a few seconds is one event, even
though the detector produced dozens of scores while it was happening.  See
:mod:`laughcounter.counter` for how a stream of per-frame scores is collapsed
into events.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Optional


@dataclass(frozen=True)
class LaughEvent:
    """One episode of detected laughter.

    Attributes:
        start: Epoch seconds when the laughter began.
        end: Epoch seconds when the laughter ended (inclusive of the trailing
            frame's coverage).
        duration: ``end - start`` in seconds, precomputed for convenience.
        peak_score: Highest laughter probability (0..1) seen during the episode.
        mean_score: Average laughter probability across the episode's frames.
        source: Where the audio came from (``"mic"``, ``"file"``,
            ``"simulate"`` ...).  Never audio itself — only a label.
        speaker: Who laughed, if known — ``"me"``, ``"guest"`` or ``"unknown"``.
            Filled in by a speaker identifier after detection.
        clip_path: Path to a saved short audio clip of this laugh, if clip
            saving is enabled (used to improve the model over time). ``None``
            otherwise.
    """

    start: float
    end: float
    duration: float
    peak_score: float
    mean_score: float
    source: str = "mic"
    speaker: str = "unknown"
    clip_path: Optional[str] = None

    def to_dict(self) -> dict:
        """Return a JSON-serialisable dict, enriched with a human ISO timestamp."""
        data = asdict(self)
        data["start_iso"] = _iso(self.start)
        data["end_iso"] = _iso(self.end)
        return data


def _iso(epoch: float) -> str:
    """Format epoch seconds as a local-time ISO-8601 string (seconds precision)."""
    return datetime.fromtimestamp(epoch).isoformat(timespec="seconds")


def utcnow() -> float:
    """Epoch seconds for 'now'. Wrapped so tests can monkeypatch a clock."""
    return datetime.now(timezone.utc).timestamp()
