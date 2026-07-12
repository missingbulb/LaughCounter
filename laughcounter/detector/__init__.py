"""Laughter detectors: turn a buffer of audio into a laughter probability.

The :class:`~laughcounter.detector.base.Detector` interface is intentionally
tiny so backends are easy to swap.  The real one (:class:`YAMNetDetector`) needs
TensorFlow and is imported lazily; the :class:`ScriptedDetector` needs nothing
and is used by the tests and the ``simulate`` command.
"""

from .base import Detector
from .mock import ScriptedDetector

__all__ = ["Detector", "ScriptedDetector", "load_default"]


def load_default(config):
    """Instantiate the configured detector from a :class:`~laughcounter.config.Config`.

    ``config.detector`` selects the backend (``"yamnet"`` by default, or the
    experimental ``"robust"`` jrgillick adapter). Imported lazily so that
    importing this package never drags in TensorFlow or Torch.
    """
    choice = getattr(config, "detector", "yamnet")
    if choice == "robust":
        from .robust import RobustLaughterDetector

        return RobustLaughterDetector(sample_rate=config.sample_rate)
    from .yamnet import YAMNetDetector

    return YAMNetDetector(
        sample_rate=config.sample_rate,
        window_seconds=config.window_seconds,
    )
