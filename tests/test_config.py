"""Tests for configuration loading, saving and env handling."""

import json

from laughcounter.config import Config, default_home


def test_defaults_and_paths(tmp_path):
    cfg = Config(home=str(tmp_path))
    assert cfg.sample_rate == 16000
    assert cfg.db_path == tmp_path / "laughs.db"
    assert cfg.jsonl_path == tmp_path / "laughs.jsonl"
    assert cfg.config_path == tmp_path / "config.json"


def test_save_and_load_roundtrip(tmp_path):
    cfg = Config(home=str(tmp_path))
    cfg.enter_threshold = 0.77
    cfg.dashboard_port = 9999
    path = cfg.save()
    assert path.exists()

    loaded = Config.load(home=tmp_path)
    assert loaded.enter_threshold == 0.77
    assert loaded.dashboard_port == 9999
    assert loaded.home == str(tmp_path)


def test_load_ignores_unknown_keys(tmp_path):
    (tmp_path / "config.json").write_text(json.dumps({"enter_threshold": 0.6, "bogus": 1}))
    cfg = Config.load(home=tmp_path)
    assert cfg.enter_threshold == 0.6
    assert not hasattr(cfg, "bogus")


def test_env_home(monkeypatch, tmp_path):
    monkeypatch.setenv("LAUGHCOUNTER_HOME", str(tmp_path / "custom"))
    assert default_home() == tmp_path / "custom"
    cfg = Config.load()
    assert cfg.home == str(tmp_path / "custom")


def test_make_counter_uses_config(tmp_path):
    cfg = Config(home=str(tmp_path))
    cfg.enter_threshold = 0.65
    cfg.merge_gap = 2.0
    counter = cfg.make_counter(source="mic")
    assert counter.enter_threshold == 0.65
    assert counter.merge_gap == 2.0
    assert counter.source == "mic"
