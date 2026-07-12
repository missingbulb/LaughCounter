"""Tests for the who-laughed decision logic (model-free parts)."""

import math

import pytest

from laughcounter.speaker import (
    EmbeddingIdentifier,
    NullIdentifier,
    SpeakerProfiles,
    classify,
    cosine,
)


def test_cosine():
    assert cosine([1, 0], [1, 0]) == pytest.approx(1.0)
    assert cosine([1, 0], [0, 1]) == pytest.approx(0.0)
    assert cosine([1, 1], [2, 2]) == pytest.approx(1.0)
    assert cosine([0, 0], [1, 1]) == 0.0
    with pytest.raises(ValueError):
        cosine([1, 2], [1])


def test_classify_no_profiles_is_unknown():
    assert classify([1, 0], {}, 0.5) == ("unknown", 0.0)


def test_classify_matches_me():
    label, score = classify([1.0, 0.1], {"me": [1.0, 0.0]}, 0.5)
    assert label == "me"
    assert score > 0.9


def test_classify_below_threshold_is_guest():
    label, score = classify([0.0, 1.0], {"me": [1.0, 0.0]}, 0.5)
    assert label == "guest"
    assert score < 0.5


def test_profiles_running_average_and_persistence(tmp_path):
    path = tmp_path / "speakers.json"
    profiles = SpeakerProfiles(path)
    profiles.add_embedding("me", [0.0, 0.0])
    profiles.add_embedding("me", [2.0, 4.0])
    assert profiles.data["me"]["count"] == 2
    assert profiles.centroids()["me"] == [1.0, 2.0]
    profiles.save()

    reloaded = SpeakerProfiles(path)
    assert reloaded.centroids()["me"] == [1.0, 2.0]


def test_profiles_dimension_mismatch():
    profiles = SpeakerProfiles("/unused")
    profiles.add_embedding("me", [1.0, 2.0])
    with pytest.raises(ValueError):
        profiles.add_embedding("me", [1.0, 2.0, 3.0])


def test_profiles_tolerate_corrupt_file(tmp_path):
    path = tmp_path / "s.json"
    path.write_text("{ this is not valid json")
    profiles = SpeakerProfiles(path)  # must not raise
    assert profiles.data == {}
    profiles.add_embedding("me", [1.0, 2.0])
    profiles.save()
    assert SpeakerProfiles(path).centroids()["me"] == [1.0, 2.0]


def test_null_identifier():
    assert NullIdentifier().identify([0.1, 0.2]) == ("unknown", 0.0)


def test_embedding_identifier_with_fake_embedder(tmp_path):
    profiles = SpeakerProfiles(tmp_path / "s.json")
    profiles.add_embedding("me", [1.0, 0.0, 0.0])

    def fake_embedder(_waveform):
        return [0.9, 0.1, 0.0]  # close to the "me" centroid

    ident = EmbeddingIdentifier(fake_embedder, profiles, threshold=0.5)
    label, score = ident.identify([0.0] * 16)
    assert label == "me"
    assert score > 0.5
