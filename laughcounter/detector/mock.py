"""A dependency-free detector for tests and demos.

:class:`ScriptedDetector` returns whatever scores you give it, in order.  It lets
the whole pipeline — counter, storage, stats, dashboard — run and be verified
without a microphone or TensorFlow.
"""

from __future__ import annotations

from typing import Iterable, Sequence

from .base import Detector


class ScriptedDetector(Detector):
    """Yields a predetermined sequence of scores, ignoring the audio itself.

    Args:
        scores: The scores to return, one per :meth:`score` call.
        sample_rate: Reported sample rate (defaults to 16 kHz).
        window_samples: Reported window size (defaults to ~0.96 s at 16 kHz).
        loop: If True, cycle through ``scores`` forever instead of raising when
            exhausted.
    """

    def __init__(
        self,
        scores: Iterable[float],
        sample_rate: int = 16000,
        window_samples: int = 15360,
        loop: bool = False,
    ):
        self._scores = list(scores)
        if not self._scores:
            raise ValueError("ScriptedDetector needs at least one score")
        self.sample_rate = sample_rate
        self.window_samples = window_samples
        self._loop = loop
        self._i = 0

    def score(self, waveform: Sequence[float]) -> float:
        if self._i >= len(self._scores):
            if not self._loop:
                raise StopIteration("ScriptedDetector ran out of scripted scores")
            self._i = 0
        value = self._scores[self._i]
        self._i += 1
        return float(value)
