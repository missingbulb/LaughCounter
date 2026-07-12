"""LaughCounter — listen for laughter at home, count it, and log it.

The core of this package (counting, storage, statistics, the web dashboard and
the command line interface) depends only on the Python standard library, so it
runs and is fully testable without installing anything.  The pieces that need
heavy dependencies — real microphone capture and the YAMNet laughter model —
live behind small interfaces and are imported lazily, so they are only required
when you actually listen to a microphone (``pip install "laughcounter[yamnet]"``).
"""

from .events import LaughEvent
from .counter import LaughCounter
from .config import Config

__all__ = ["LaughEvent", "LaughCounter", "Config", "__version__"]

__version__ = "0.1.0"
