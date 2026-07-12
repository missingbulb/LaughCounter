"""Who laughed? — attribute a laugh to *you* or to a *guest*.

This is deliberately split into two halves:

* The **decision logic** (:func:`cosine`, :func:`classify`, :class:`SpeakerProfiles`)
  is pure Python and fully tested. It compares a laugh's *embedding* — a vector
  that captures voice identity — against the profile you enrolled for yourself.
* The **embedding model** that turns audio into that vector is the heavy,
  pretrained part. It lives behind :class:`EmbeddingIdentifier` and is optional
  (:class:`EcapaEmbedder`, from SpeechBrain). Until you enroll and install it,
  the default :class:`NullIdentifier` simply reports ``"unknown"`` and nothing
  else changes.

You never hand-label a dataset: you *enroll* by giving a handful of your own
laughs (``laughcounter enroll``), and accuracy improves as more of your saved
clips are added to the profile. Because laughter varies so much, the profile is
a running average over many of your laughs rather than a single template — that
keeps it from overfitting to one giggle.
"""

from __future__ import annotations

import abc
import json
import math
import os
from pathlib import Path
from typing import Optional, Sequence

# Speaker labels understood by storage.
ME, GUEST, UNKNOWN = "me", "guest", "unknown"


def cosine(a: Sequence[float], b: Sequence[float]) -> float:
    """Cosine similarity of two equal-length vectors (0 if either is zero)."""
    if len(a) != len(b):
        raise ValueError("vectors must have equal length")
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def classify(embedding: Sequence[float], profiles: dict, threshold: float) -> tuple:
    """Return ``(speaker_label, score)`` for an embedding.

    * No enrolled profiles → ``("unknown", 0.0)`` (we can't tell anyone apart).
    * Best match at or above ``threshold`` → that person (``"me"`` if it's your
      profile).
    * Otherwise a laugh we heard but don't recognise → ``"guest"``.
    """
    if not profiles:
        return (UNKNOWN, 0.0)
    best_name, best_score = None, -1.0
    for name, centroid in profiles.items():
        score = cosine(embedding, centroid)
        if score > best_score:
            best_name, best_score = name, score
    if best_score >= threshold:
        label = ME if best_name == ME else GUEST
        return (label, best_score)
    return (GUEST, best_score)


class SpeakerProfiles:
    """Enrolled voice profiles, persisted as JSON (running-average centroids)."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.data: dict = {}
        if self.path.exists():
            try:
                loaded = json.loads(self.path.read_text() or "{}")
                if isinstance(loaded, dict):
                    self.data = loaded
            except (json.JSONDecodeError, OSError):
                # A corrupt/half-written profile file shouldn't block startup;
                # start empty and let the next save() overwrite it cleanly.
                self.data = {}

    def centroids(self) -> dict:
        return {name: prof["centroid"] for name, prof in self.data.items()}

    def add_embedding(self, name: str, embedding: Sequence[float]) -> None:
        """Fold a new embedding into ``name``'s running-average centroid."""
        vec = [float(x) for x in embedding]
        prof = self.data.get(name)
        if prof is None:
            self.data[name] = {"centroid": vec, "count": 1}
            return
        count = prof["count"]
        centroid = prof["centroid"]
        if len(centroid) != len(vec):
            raise ValueError("embedding dimension mismatch on enrollment")
        prof["centroid"] = [(c * count + v) / (count + 1) for c, v in zip(centroid, vec)]
        prof["count"] = count + 1

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # Write atomically so a crash mid-write can't corrupt the profile.
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_text(json.dumps(self.data, indent=2))
        os.replace(tmp, self.path)


class SpeakerIdentifier(abc.ABC):
    """Maps a laugh waveform to ``(speaker_label, score)``."""

    @abc.abstractmethod
    def identify(self, waveform: Sequence[float]) -> tuple: ...


class NullIdentifier(SpeakerIdentifier):
    """Default: we don't know who laughed."""

    def identify(self, waveform: Sequence[float]) -> tuple:
        return (UNKNOWN, 0.0)


class EmbeddingIdentifier(SpeakerIdentifier):
    """Combine an embedding model with enrolled profiles and a threshold.

    ``embedder`` is any callable ``waveform -> vector``; keeping it injectable is
    what lets the decision logic be tested with fake embeddings.
    """

    def __init__(self, embedder, profiles: SpeakerProfiles, threshold: float = 0.55):
        self.embedder = embedder
        self.profiles = profiles
        self.threshold = threshold

    def identify(self, waveform: Sequence[float]) -> tuple:
        embedding = self.embedder(waveform)
        return classify(embedding, self.profiles.centroids(), self.threshold)


class EcapaEmbedder:
    """Speaker embeddings via SpeechBrain's ECAPA-TDNN (optional, lazy).

    Install with ``pip install "laughcounter[speaker]"``. The model is downloaded
    once and cached. ECAPA embeddings carry speaker identity even for non-speech
    vocalisations like laughter, which is what makes "me vs guest" possible.
    """

    def __init__(self, sample_rate: int = 16000):
        try:
            import torch  # noqa: F401
            from speechbrain.pretrained import EncoderClassifier
        except ImportError as exc:  # pragma: no cover - depends on environment
            raise ImportError(
                "Speaker identification needs the optional dependencies. Install "
                'them with:  pip install "laughcounter[speaker]"'
            ) from exc
        self._torch = __import__("torch")
        self.sample_rate = sample_rate
        self._model = EncoderClassifier.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb",
            savedir=os.path.expanduser("~/.laughcounter/models/ecapa"),
        )

    def __call__(self, waveform: Sequence[float]) -> list:  # pragma: no cover - needs model
        torch = self._torch
        wav = torch.tensor([list(waveform)], dtype=torch.float32)
        emb = self._model.encode_batch(wav)
        return emb.reshape(-1).tolist()


def load_identifier(config) -> SpeakerIdentifier:
    """Build the best available identifier: ECAPA if enrolled + installed, else Null."""
    profiles = SpeakerProfiles(config.home_path / "speakers.json")
    if not profiles.data:
        return NullIdentifier()
    try:
        embedder = EcapaEmbedder(sample_rate=config.sample_rate)
    except ImportError:
        return NullIdentifier()
    return EmbeddingIdentifier(embedder, profiles, threshold=config.speaker_threshold)
