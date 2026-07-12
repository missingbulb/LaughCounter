"""Little real-time indications that a laugh was logged.

The point of these is your feedback loop: when you laugh and hear a soft blip (or
see a notification), you know it was caught. When you *don't*, that's your cue to
tap "I just laughed" so the miss becomes training data.

Everything here is best-effort and safe to call anywhere: on a Mac it uses the
built-in ``osascript`` (notifications) and ``afplay`` (a gentle system sound); on
anything else, or if those aren't present, it silently does nothing. It never
raises and never blocks for long.
"""

from __future__ import annotations

import shutil
import subprocess
import sys

# A short, unobtrusive built-in macOS sound.
_MAC_SOUND = "/System/Library/Sounds/Pop.aiff"


def _run(cmd: list[str]) -> None:
    try:
        subprocess.run(cmd, timeout=5, check=False,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:  # noqa: BLE001 - notifications must never break listening
        pass


def blip() -> None:
    """Play a soft confirmation sound if possible."""
    if sys.platform == "darwin" and shutil.which("afplay"):
        _run(["afplay", _MAC_SOUND])


def banner(title: str, message: str) -> None:
    """Show a desktop notification if possible (macOS)."""
    if sys.platform == "darwin" and shutil.which("osascript"):
        text = message.replace('"', "'")
        head = title.replace('"', "'")
        _run(["osascript", "-e",
              f'display notification "{text}" with title "{head}"'])


def laugh_logged(count: int, speaker: str = "unknown", sound: bool = True,
                 banner_notification: bool = False) -> None:
    """Signal that laugh number ``count`` was just logged."""
    if sound:
        blip()
    if banner_notification:
        who = "" if speaker == "unknown" else f" ({speaker})"
        banner("LaughCounter", f"😄 laugh #{count} logged{who}")
