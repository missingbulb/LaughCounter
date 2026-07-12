"""Tests for the rolling audio buffer and WAV clip saving."""

import pytest

from laughcounter.clips import ClipRecorder, floats_to_pcm16, read_wav, write_wav


def test_wav_roundtrip(tmp_path):
    samples = [0.0, 0.5, -0.5, 0.999, -1.0, 0.25]
    path = tmp_path / "c.wav"
    write_wav(path, samples, 8000)
    back, rate = read_wav(path)
    assert rate == 8000
    assert len(back) == len(samples)
    for a, b in zip(samples, back):
        assert a == pytest.approx(b, abs=1e-3)


def test_pcm16_clamps():
    # Values beyond [-1, 1] must not wrap around.
    data = floats_to_pcm16([2.0, -2.0])
    assert len(data) == 4  # two int16 samples


def test_recorder_extract_window():
    rec = ClipRecorder(sample_rate=10, out_dir="/unused", padding=0.0)
    rec.push(0.0, [i / 10 for i in range(10)])  # covers t=0.0..1.0
    chunk = rec.extract(0.2, 0.5)  # indices [2, 5)
    assert chunk == [0.2, 0.3, 0.4]


def test_recorder_trims_and_tracks_start():
    rec = ClipRecorder(sample_rate=10, out_dir="/unused", padding=0.0, max_seconds=1.0)
    rec.push(0.0, [0.0] * 10)      # 10 samples, buffer full
    rec.push(1.0, [0.9] * 10)      # overflow drops the first 10
    assert rec._buf_start == pytest.approx(1.0)
    chunk = rec.extract(1.0, 2.0)
    assert chunk == [0.9] * 10


def test_recorder_save_reads_back(tmp_path):
    rec = ClipRecorder(sample_rate=100, out_dir=tmp_path, padding=0.1)
    rec.push(0.0, [0.3] * 100)  # 1 second of audio
    path = rec.save(0.3, 0.6)   # with padding → [0.2, 0.7)
    assert path is not None
    samples, rate = read_wav(path)
    assert rate == 100
    assert len(samples) == pytest.approx(50, abs=2)


def test_recorder_save_outside_buffer_returns_none():
    rec = ClipRecorder(sample_rate=10, out_dir="/unused", padding=0.0)
    rec.push(0.0, [0.1] * 10)
    assert rec.save(100.0, 101.0) is None


def test_recorder_empty_extract_none():
    rec = ClipRecorder(sample_rate=10, out_dir="/unused")
    assert rec.extract(0.0, 1.0) is None


def test_recorder_resyncs_after_gap():
    # A large jump between wall-clock ts and the sample-count implied time should
    # realign the buffer, so extraction stays anchored to real time.
    rec = ClipRecorder(sample_rate=10, out_dir="/unused", padding=0.0,
                       max_seconds=100, resync_tolerance=0.5)
    rec.push(0.0, [0.0] * 10)     # t=0..1
    rec.push(100.0, [0.9] * 10)   # claims t=100 but count implies ~1.0 → resync
    assert rec._buf_start == pytest.approx(100.0)
    assert rec._buf == [0.9] * 10
    assert rec.extract(100.0, 101.0) == [0.9] * 10
