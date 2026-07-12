"""Save a short audio clip of each detected laugh.

Why save audio at all, when the rest of LaughCounter is careful never to? Because
*you asked for it* — keeping a small library of your real laughs is what lets the
detector and the "who laughed" model get better over time without you ever having
to hand-label a training set. The trade-off is deliberate and local:

* Only a few seconds **around a detected laugh** are saved — never a continuous
  recording of the room. (A manually marked laugh records only its metadata; no
  audio is captured for it.)
* Clips live on your Mac mini under ``~/.laughcounter/clips`` and go nowhere else.
* Delete the folder any time and the audio is gone; the counts stay.

:class:`ClipRecorder` keeps a rolling in-memory buffer of the most recent audio
and, on request, writes the slice covering a laugh (plus padding) to a WAV file.
It uses only the standard library, so it is fully testable without a microphone.
"""

from __future__ import annotations

import array
import sys
import wave
from pathlib import Path
from typing import Optional, Sequence


def _to_float_list(waveform: Sequence[float]) -> list:
    tolist = getattr(waveform, "tolist", None)
    if callable(tolist):  # numpy array
        waveform = tolist()
    return [float(x) for x in waveform]


def floats_to_pcm16(samples: Sequence[float]) -> bytes:
    """Convert floats in [-1, 1] to little-endian 16-bit PCM bytes."""
    clipped = array.array(
        "h", (max(-32768, min(32767, int(round(x * 32767)))) for x in samples)
    )
    if sys.byteorder == "big":  # WAV is little-endian
        clipped.byteswap()
    return clipped.tobytes()


class ClipRecorder:
    """Rolling audio buffer that can dump a laugh's audio to a WAV file.

    Args:
        sample_rate: Samples per second of the incoming audio.
        out_dir: Directory to write clips into (created on demand).
        padding: Extra seconds kept on each side of a laugh.
        max_seconds: How much recent audio to retain in memory.
    """

    def __init__(self, sample_rate: int, out_dir: str | Path,
                 padding: float = 1.0, max_seconds: float = 12.0,
                 resync_tolerance: float = 0.5):
        self.sample_rate = sample_rate
        self.out_dir = Path(out_dir)
        self.padding = padding
        self._max_samples = int(max_seconds * sample_rate)
        self._resync_tolerance = resync_tolerance
        self._buf: list = []
        self._buf_start: Optional[float] = None  # ts of self._buf[0]

    def push(self, ts: float, waveform: Sequence[float]) -> None:
        """Add a freshly captured buffer that begins at time ``ts``.

        If ``ts`` diverges from what the accumulated sample count implies (dropped
        audio, an input overrun, or a clock step), the buffer is realigned to
        ``ts`` so later extraction windows stay anchored to real time.
        """
        samples = _to_float_list(waveform)
        if not samples:
            return
        if self._buf_start is None:
            self._buf_start = ts
        else:
            expected = self._buf_start + len(self._buf) / self.sample_rate
            if abs(ts - expected) > self._resync_tolerance:
                self._buf = []
                self._buf_start = ts
        self._buf.extend(samples)
        overflow = len(self._buf) - self._max_samples
        if overflow > 0:
            del self._buf[:overflow]
            self._buf_start += overflow / self.sample_rate

    def extract(self, start: float, end: float) -> Optional[list]:
        """Return the buffered samples overlapping ``[start-padding, end+padding]``.

        The span is clamped to whatever is currently in the rolling buffer, so at
        the very start of listening (or if padding reaches past the newest audio)
        the returned clip may be shorter than the full padded window. Returns
        ``None`` only when there is no overlap at all.
        """
        if self._buf_start is None or not self._buf:
            return None
        lo = int((start - self.padding - self._buf_start) * self.sample_rate)
        hi = int((end + self.padding - self._buf_start) * self.sample_rate)
        lo = max(0, min(lo, len(self._buf)))
        hi = max(0, min(hi, len(self._buf)))
        if hi <= lo:
            return None
        return self._buf[lo:hi]

    def save(self, start: float, end: float, name: Optional[str] = None) -> Optional[str]:
        """Write the buffered audio overlapping ``[start-padding, end+padding]``.

        Returns the file path, or ``None`` if none of that span is still buffered.
        The clip may be shorter than the full padded window at buffer edges (see
        :meth:`extract`).
        """
        chunk = self.extract(start, end)
        if not chunk:
            return None
        if name is None:
            name = f"laugh-{int(start)}-{int((start % 1) * 1000):03d}.wav"
        self.out_dir.mkdir(parents=True, exist_ok=True)
        path = self.out_dir / name
        write_wav(path, chunk, self.sample_rate)
        return str(path)


def write_wav(path: str | Path, samples: Sequence[float], sample_rate: int) -> None:
    """Write mono 16-bit PCM WAV from float samples in [-1, 1]."""
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(floats_to_pcm16(samples))


def read_wav(path: str | Path) -> tuple:
    """Read a mono 16-bit PCM WAV → ``(samples_as_floats, sample_rate)``.

    Multi-channel files are downmixed to mono by averaging channels.
    """
    with wave.open(str(path), "rb") as wf:
        n_channels = wf.getnchannels()
        if wf.getsampwidth() != 2:
            raise ValueError("read_wav expects 16-bit PCM")
        rate = wf.getframerate()
        frames = wf.readframes(wf.getnframes())
    ints = array.array("h")
    ints.frombytes(frames)
    if sys.byteorder == "big":
        ints.byteswap()
    floats = [s / 32768.0 for s in ints]
    if n_channels > 1:
        floats = [
            sum(floats[i:i + n_channels]) / n_channels
            for i in range(0, len(floats), n_channels)
        ]
    return floats, rate
