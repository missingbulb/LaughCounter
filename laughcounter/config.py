"""Configuration: tunable thresholds and where data lives.

Everything is persisted under a single *home* directory (default
``~/.laughcounter``, overridable with the ``LAUGHCOUNTER_HOME`` environment
variable or ``--home`` on the CLI): the SQLite database, the JSONL log and this
config file itself.  Defaults are chosen to work well with YAMNet at 16 kHz.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, fields
from pathlib import Path


def default_home() -> Path:
    """The data directory, honouring ``LAUGHCOUNTER_HOME`` if set."""
    env = os.environ.get("LAUGHCOUNTER_HOME")
    return Path(env) if env else Path.home() / ".laughcounter"


@dataclass
class Config:
    """Tunable parameters for detection, counting and the dashboard."""

    # Audio / model
    sample_rate: int = 16000        # YAMNet expects 16 kHz mono
    window_seconds: float = 0.96    # YAMNet analysis window
    hop_seconds: float = 0.48       # how often a score is produced

    # Counting (see laughcounter.counter for the meaning of each)
    enter_threshold: float = 0.5
    exit_threshold: float = 0.3
    min_duration: float = 0.4
    merge_gap: float = 1.0

    # Which real-time detector backend to use: "yamnet" or "robust".
    detector: str = "yamnet"

    # Saving short audio clips of laughs (to improve the model over time).
    save_clips: bool = True
    clip_padding: float = 1.0       # seconds kept on each side of a laugh
    clip_max_seconds: float = 12.0  # rolling audio buffer length

    # Real-time indication that a laugh was logged.
    notify_sound: bool = True
    notify_banner: bool = False

    # Who-laughed attribution.
    speaker_threshold: float = 0.55  # cosine similarity to count as "me"

    # How far back an "I just laughed" tap looks to confirm a detection.
    mark_window: float = 8.0

    # Dashboard — bound to localhost by default for privacy.
    dashboard_host: str = "127.0.0.1"
    dashboard_port: int = 8422

    # Data location (stored as a string so the dataclass stays JSON-friendly).
    home: str = ""

    def __post_init__(self) -> None:
        if not self.home:
            self.home = str(default_home())

    # -- derived paths ------------------------------------------------------

    @property
    def home_path(self) -> Path:
        return Path(self.home)

    @property
    def db_path(self) -> Path:
        return self.home_path / "laughs.db"

    @property
    def jsonl_path(self) -> Path:
        return self.home_path / "laughs.jsonl"

    @property
    def config_path(self) -> Path:
        return self.home_path / "config.json"

    @property
    def clips_dir(self) -> Path:
        return self.home_path / "clips"

    @property
    def speakers_path(self) -> Path:
        return self.home_path / "speakers.json"

    # -- persistence --------------------------------------------------------

    @classmethod
    def load(cls, home: str | os.PathLike | None = None) -> "Config":
        """Load config from ``<home>/config.json``, falling back to defaults."""
        home_path = Path(home) if home else default_home()
        cfg = cls(home=str(home_path))
        path = home_path / "config.json"
        if path.exists():
            data = json.loads(path.read_text())
            known = {f.name for f in fields(cls)}
            for key, value in data.items():
                if key in known and key != "home":
                    setattr(cfg, key, value)
        return cfg

    def save(self) -> Path:
        """Write config to ``<home>/config.json`` and return the path."""
        self.home_path.mkdir(parents=True, exist_ok=True)
        data = {f.name: getattr(self, f.name) for f in fields(self)}
        self.config_path.write_text(json.dumps(data, indent=2, sort_keys=True))
        return self.config_path

    def make_counter(self, source: str = "mic"):
        """Build a :class:`~laughcounter.counter.LaughCounter` from this config."""
        from .counter import LaughCounter

        return LaughCounter(
            enter_threshold=self.enter_threshold,
            exit_threshold=self.exit_threshold,
            min_duration=self.min_duration,
            merge_gap=self.merge_gap,
            frame_seconds=self.hop_seconds,
            source=source,
        )
