"""Real laughter detection with YAMNet.

`YAMNet <https://tfhub.dev/google/yamnet/1>`_ is a lightweight, CPU-friendly
audio event classifier trained on Google's AudioSet.  Among its 521 classes are
several that are exactly what we care about — *Laughter*, *Baby laughter*,
*Giggle*, *Snicker*, *Belly laugh*, *Chuckle, chortle*.  We load the model,
find those classes by name (so we do not depend on brittle hard-coded indices),
and report the strongest laughter probability for each audio buffer.

This module imports TensorFlow only when instantiated, so the rest of
LaughCounter stays lightweight.  Install the extras to use it::

    pip install "laughcounter[yamnet]"
"""

from __future__ import annotations

import csv
import io
from typing import Sequence

from .base import Detector

# Substrings that identify AudioSet classes we count as "laughter".
LAUGHTER_KEYWORDS = ("laugh", "giggle", "chuckle", "chortle", "snicker")

_MODEL_HANDLE = "https://tfhub.dev/google/yamnet/1"


class YAMNetDetector(Detector):
    """Laughter probability from Google's YAMNet model.

    Args:
        sample_rate: Must be 16000 — YAMNet is trained at 16 kHz mono.
        window_seconds: Audio buffer length per :meth:`score` call.
        keywords: Class-name substrings to treat as laughter.
    """

    def __init__(
        self,
        sample_rate: int = 16000,
        window_seconds: float = 0.96,
        keywords: Sequence[str] = LAUGHTER_KEYWORDS,
    ):
        if sample_rate != 16000:
            raise ValueError("YAMNet requires a 16 kHz sample rate")

        # Heavy imports live here so `import laughcounter` stays cheap.
        try:
            import numpy as np  # noqa: F401
            import tensorflow as tf
            import tensorflow_hub as hub
        except ImportError as exc:  # pragma: no cover - depends on environment
            raise ImportError(
                "YAMNetDetector needs the optional ML dependencies. Install them "
                'with:  pip install "laughcounter[yamnet]"'
            ) from exc

        self._tf = tf
        self.sample_rate = sample_rate
        self.window_samples = int(round(sample_rate * window_seconds))

        self._model = hub.load(_MODEL_HANDLE)
        self._laughter_indices = self._find_laughter_indices(keywords)
        if not self._laughter_indices:
            raise RuntimeError("Could not locate any laughter classes in YAMNet")

    def _find_laughter_indices(self, keywords: Sequence[str]) -> list[int]:
        class_map_path = self._model.class_map_path().numpy().decode("utf-8")
        with self._tf.io.gfile.GFile(class_map_path) as fh:
            reader = csv.DictReader(io.StringIO(fh.read()))
            indices = []
            for row in reader:
                name = row["display_name"].lower()
                if any(k in name for k in keywords):
                    indices.append(int(row["index"]))
        return indices

    def score(self, waveform: Sequence[float]) -> float:
        import numpy as np

        wav = np.asarray(waveform, dtype=np.float32)
        # YAMNet expects a mono float32 waveform in [-1, 1].
        if wav.ndim > 1:
            wav = wav.mean(axis=1)
        peak = float(np.max(np.abs(wav))) if wav.size else 0.0
        if peak > 1.0:
            wav = wav / peak

        scores, _embeddings, _spectrogram = self._model(wav)
        scores = scores.numpy()  # shape: (frames, 521)
        # Strongest laughter class, averaged over the buffer's frames.
        laughter = scores[:, self._laughter_indices]
        per_frame = laughter.max(axis=1)  # best laughter class per frame
        return float(per_frame.mean()) if per_frame.size else 0.0
