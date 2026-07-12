"""Audio sources: where the waveforms fed to a detector come from.

An audio *source* is just an iterable of ``(timestamp, waveform)`` buffers.  The
microphone source needs ``sounddevice`` (and, under the hood, PortAudio) and is
imported lazily; the WAV source needs only the standard library and is handy for
testing against recorded clips.
"""

from __future__ import annotations

import time
import wave
from pathlib import Path
from typing import Iterator, Tuple

Buffer = Tuple[float, list]


class MicrophoneSource:
    """Yield fixed-length buffers from the default input device.

    Args:
        sample_rate: Capture rate in Hz (16000 for YAMNet).
        window_samples: Samples per yielded buffer.
        device: Optional sounddevice input device index or name.
    """

    def __init__(self, sample_rate: int, window_samples: int, device=None):
        self.sample_rate = sample_rate
        self.window_samples = window_samples
        self.device = device

    def __iter__(self) -> Iterator[Buffer]:
        try:
            import queue

            import numpy as np
            import sounddevice as sd
        except ImportError as exc:  # pragma: no cover - depends on environment
            raise ImportError(
                "Listening to a microphone needs the optional audio dependencies. "
                'Install them with:  pip install "laughcounter[yamnet]"'
            ) from exc

        q: "queue.Queue" = queue.Queue()

        def callback(indata, frames, time_info, status):  # pragma: no cover - realtime
            if status:
                # Overflows are non-fatal; drop and keep going.
                pass
            q.put(indata.copy())

        blocksize = self.window_samples
        with sd.InputStream(
            samplerate=self.sample_rate,
            channels=1,
            dtype="float32",
            blocksize=blocksize,
            device=self.device,
            callback=callback,
        ):
            while True:  # pragma: no cover - realtime loop
                block = q.get()
                waveform = np.asarray(block, dtype=np.float32).reshape(-1)
                yield time.time(), waveform


class WavFileSource:
    """Yield buffers from a 16-bit PCM mono WAV file (stdlib only).

    The file must already be mono at the detector's ``sample_rate`` (no
    resampling is performed here).  Timestamps advance in real audio time from
    ``start_ts`` so the counter's timing logic behaves as it would live.
    """

    def __init__(
        self,
        path: str | Path,
        window_samples: int,
        start_ts: float | None = None,
    ):
        self.path = str(path)
        self.window_samples = window_samples
        self.start_ts = time.time() if start_ts is None else start_ts

    def __iter__(self) -> Iterator[Buffer]:
        with wave.open(self.path, "rb") as wf:
            if wf.getnchannels() != 1:
                raise ValueError("WavFileSource expects a mono file")
            if wf.getsampwidth() != 2:
                raise ValueError("WavFileSource expects 16-bit PCM")
            rate = wf.getframerate()
            ts = self.start_ts
            step = self.window_samples / rate
            while True:
                frames = wf.readframes(self.window_samples)
                if not frames:
                    break
                waveform = _pcm16_to_float(frames)
                yield ts, waveform
                ts += step


def _pcm16_to_float(frames: bytes) -> list:
    """Convert little-endian 16-bit PCM bytes to floats in [-1, 1] (no numpy)."""
    import array

    samples = array.array("h")  # signed short
    samples.frombytes(frames)
    if array.array("h").itemsize != 2:  # pragma: no cover - exotic platforms
        raise RuntimeError("unexpected short size")
    import sys

    if sys.byteorder == "big":  # WAV is little-endian
        samples.byteswap()
    return [s / 32768.0 for s in samples]
