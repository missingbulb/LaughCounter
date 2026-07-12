"""The detector interface."""

from __future__ import annotations

import abc
from typing import Sequence


class Detector(abc.ABC):
    """Maps a mono audio buffer to a laughter probability in ``[0, 1]``.

    Implementations declare the ``sample_rate`` they expect and the number of
    samples (``window_samples``) they want per :meth:`score` call.  Callers feed
    buffers of that size; how the score is derived is up to the backend.
    """

    sample_rate: int
    window_samples: int

    @abc.abstractmethod
    def score(self, waveform: Sequence[float]) -> float:
        """Return the probability that ``waveform`` contains laughter."""

    def close(self) -> None:  # pragma: no cover - optional hook
        """Release any resources. Optional; default is a no-op."""
