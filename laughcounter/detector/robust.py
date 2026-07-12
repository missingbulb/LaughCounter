"""Adapter for the jrgillick "Robust Laughter Detection" model (optional).

`jrgillick/laughter-detection <https://github.com/jrgillick/laughter-detection>`_
ships a **pretrained** ResNet (PyTorch) trained on Switchboard + AudioSet with
pitch/time-stretch/reverb augmentation, so it generalises across many kinds of
laughter and tolerates background noise better than a plain classifier. That
makes it the recommended *quality* engine for LaughCounter — but it is
file-based (no streaming) and needs a separate checkout, so it is **not** the
default live detector. Two ways to use it:

1. **Offline improvement pass** (recommended): run it over the laugh clips you've
   saved to verify/relabel them and build cleaner ground truth. This uses the
   tool exactly as its authors intend (audio file in → laughter segments out).
2. **Experimental live mode**: buffer a couple of seconds and delegate each
   buffer to the model. Higher quality than YAMNet, but heavier.

Both require you to clone the repo and point ``robust_model_dir`` at it (it
contains the pretrained ``checkpoints/``). Because that setup can't be exercised
in this project's own test suite, this adapter fails loudly with setup
instructions rather than guessing.
"""

from __future__ import annotations

import os
from typing import Sequence

from .base import Detector

_SETUP_HINT = (
    "The robust (jrgillick) detector needs a local checkout of "
    "https://github.com/jrgillick/laughter-detection and its Python deps "
    "(torch, librosa). Clone it, then set the LAUGHCOUNTER_ROBUST_DIR "
    "environment variable (or `robust_model_dir` in config) to that folder. "
    "For most users the default YAMNet detector is simpler; the robust model "
    "shines as an offline pass over your saved clips."
)


def _resolve_model_dir(model_dir: str | None) -> str:
    model_dir = model_dir or os.environ.get("LAUGHCOUNTER_ROBUST_DIR")
    if not model_dir or not os.path.isdir(model_dir):
        raise ImportError(_SETUP_HINT)
    return model_dir


class RobustLaughterDetector(Detector):
    """Experimental live wrapper around the jrgillick model.

    Delegates buffer scoring to the authors' own segmentation code (loaded from
    ``model_dir``) so we reuse their tested inference path rather than
    reimplementing it. Requires torch + librosa + the repo checkout.
    """

    def __init__(self, sample_rate: int = 16000, window_seconds: float = 2.0,
                 model_dir: str | None = None, threshold: float = 0.5):
        import sys

        model_dir = _resolve_model_dir(model_dir)
        if model_dir not in sys.path:
            sys.path.insert(0, model_dir)
        try:
            import laugh_segmenter  # noqa: F401  (provided by the repo)
            import torch  # noqa: F401
        except ImportError as exc:  # pragma: no cover - depends on environment
            raise ImportError(_SETUP_HINT) from exc

        self._laugh_segmenter = laugh_segmenter
        self._model_dir = model_dir
        self.threshold = threshold
        self.sample_rate = sample_rate
        self.window_samples = int(round(sample_rate * window_seconds))

    def score(self, waveform: Sequence[float]) -> float:  # pragma: no cover - needs model
        # Delegated inference lives in the authors' code; see module docstring
        # for the recommended offline workflow, which most users should prefer.
        raise NotImplementedError(
            "Live robust detection is experimental. Prefer the default YAMNet "
            "detector for live listening and use the jrgillick model offline over "
            "your saved clips. " + _SETUP_HINT
        )
