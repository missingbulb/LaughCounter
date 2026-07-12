"""Command-line interface for LaughCounter.

Subcommands:
    listen    Listen to the microphone and log laughs (needs the [yamnet] extra).
    simulate  Generate synthetic laughs to try out the whole pipeline offline.
    stats     Print a summary of your laughter.
    log       Show the most recent laughs.
    export    Dump all events as CSV or JSON.
    serve     Launch the local web dashboard.
    config    Show or initialise configuration.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import random
import sys
from dataclasses import replace
from datetime import datetime

from . import __version__, stats
from .config import Config
from .events import LaughEvent, utcnow
from .storage import Storage

_SPARK = "▁▂▃▄▅▆▇█"


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _fmt_duration(seconds: float) -> str:
    seconds = float(seconds)
    if seconds >= 60:
        minutes, rem = divmod(seconds, 60)
        return f"{int(minutes)}m {rem:.0f}s"
    return f"{seconds:.1f}s"


def _sparkline(values: list[int]) -> str:
    if not values:
        return ""
    hi = max(values)
    if hi == 0:
        return _SPARK[0] * len(values)
    return "".join(_SPARK[min(len(_SPARK) - 1, int(v / hi * (len(_SPARK) - 1)))] for v in values)


def _render_stats(summary: dict) -> str:
    lines = []
    lines.append("😂  LaughCounter")
    lines.append("─" * 40)
    lines.append(f"  Today:          {summary['today']}")
    lines.append(f"  This week:      {summary['week']}")
    lines.append(f"  All-time:       {summary['total']}")
    lines.append(f"  Total laughter: {_fmt_duration(summary['total_duration'])}")
    lines.append(f"  Longest laugh:  {_fmt_duration(summary['longest_laugh'])}")
    lines.append(f"  Current streak: {summary['current_streak']} day(s)")
    lines.append(f"  Longest streak: {summary['longest_streak']} day(s)")
    busiest = summary["busiest_hour"]
    lines.append(f"  Busiest hour:   {'—' if busiest is None else f'{busiest:02d}:00'}")
    sp = summary["by_speaker"]
    lines.append(f"  You / guests:   {sp['me']} / {sp['guest']}"
                 f"  ({sp['unknown']} unattributed)")
    hl = summary["by_label"]
    lines.append(f"  Feedback:       {hl['confirmed']} confirmed · "
                 f"{hl['missed']} missed · {hl['rejected']} rejected")
    lines.append("")
    lines.append("  By hour (00→23):")
    lines.append("    " + _sparkline(summary["per_hour"]))
    lines.append("")
    days = summary["per_day"][-14:]
    lines.append(f"  Last {len(days)} days:")
    lines.append("    " + _sparkline([d["count"] for d in days]))
    lines.append(f"    {days[0]['date']} … {days[-1]['date']}")
    if summary["recent"]:
        lines.append("")
        lines.append("  Recent:")
        for r in summary["recent"][:5]:
            when = datetime.fromtimestamp(r["start_ts"]).strftime("%m-%d %H:%M")
            lines.append(
                f"    {when}  {_fmt_duration(r['duration']):>7}  "
                f"{int(r['peak_score'] * 100):>3}%  {r['source']}"
            )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# simulate — exercise the full pipeline without a microphone
# ---------------------------------------------------------------------------

def _synth_frames(intervals, hop, merge_gap, rng, enter):
    """Yield (ts, score) frames for a list of (start, duration) laugh intervals.

    Loud frames span each interval; a short tail of silent frames after each one
    pushes the counter past ``merge_gap`` so the episode is finalised before the
    next interval begins.  Frame counts are computed as integers (rather than by
    accumulating a float from a large epoch base) so the synthetic pattern is
    reproducible for a given seed regardless of the wall-clock anchor.
    """
    lo = min(enter + 0.1, 0.98)
    n_silent = int(merge_gap / hop) + 1  # first frame whose gap exceeds merge_gap
    for start, dur in intervals:
        n_loud = max(1, math.ceil(dur / hop))
        for k in range(n_loud):
            yield start + k * hop, rng.uniform(lo, 0.98)
        last = start + (n_loud - 1) * hop
        for m in range(1, n_silent + 1):
            yield last + m * hop, 0.0  # last one has gap > merge_gap → finalise


def _make_intervals(count, days, now, rng, min_duration, merge_gap, hop):
    window = max(1.0, days * 86400.0)
    start = now - window
    slot = window / count
    intervals = []
    for i in range(count):
        slot_start = start + i * slot
        dur = rng.uniform(min_duration + 0.5, min(6.0, max(min_duration + 0.6, slot * 0.4)))
        room = max(0.0, slot - dur - 3 * hop - merge_gap)
        laugh_start = slot_start + rng.uniform(0, room)
        intervals.append((laugh_start, dur))
    return intervals


def cmd_simulate(args, cfg: Config) -> int:
    rng = random.Random(args.seed)
    now = utcnow()
    counter = cfg.make_counter(source="simulate")
    intervals = _make_intervals(
        args.count, args.days, now, rng, cfg.min_duration, cfg.merge_gap, cfg.hop_seconds
    )
    storage = Storage(cfg.db_path, cfg.jsonl_path)
    made = 0

    def _store(event):
        # Give the demo some variety so the who/health views are meaningful.
        speaker = "guest" if rng.random() < 0.2 else "me"
        label = "confirmed" if rng.random() < 0.3 else "auto"
        storage.add(replace(event, speaker=speaker), label=label)

    for ts, score in _synth_frames(intervals, cfg.hop_seconds, cfg.merge_gap, rng, cfg.enter_threshold):
        event = counter.update(ts, score)
        if event:
            _store(event)
            made += 1
    tail = counter.flush()
    if tail:
        _store(tail)
        made += 1
    print(f"Simulated {made} laugh(s) over the last {args.days} day(s) → {cfg.db_path}")
    print()
    print(_render_stats(stats.summary(storage, now=now)))
    storage.close()
    return 0


# ---------------------------------------------------------------------------
# listen — the real thing
# ---------------------------------------------------------------------------

def cmd_listen(args, cfg: Config) -> int:
    try:
        from . import notify
        from .audio import MicrophoneSource
        from .clips import ClipRecorder
        from .detector import load_default
        from .speaker import load_identifier
    except ImportError as exc:  # pragma: no cover
        print(f"error: {exc}", file=sys.stderr)
        return 2

    try:
        detector = load_default(cfg)
    except Exception as exc:  # noqa: BLE001 - surface any load failure clearly
        print(f"error: could not load the laughter model: {exc}", file=sys.stderr)
        print('Install the model dependencies with:  pip install "laughcounter[yamnet]"',
              file=sys.stderr)
        return 2

    identifier = load_identifier(cfg)
    recorder = (
        ClipRecorder(cfg.sample_rate, cfg.clips_dir, cfg.clip_padding, cfg.clip_max_seconds)
        if cfg.save_clips else None
    )
    source = MicrophoneSource(cfg.sample_rate, detector.window_samples, device=args.device)
    counter = cfg.make_counter(source="mic")
    storage = Storage(cfg.db_path, cfg.jsonl_path)

    print("😂  Listening for laughter…  (Ctrl+C to stop)")
    print(f"    logging to {cfg.db_path}")
    if recorder:
        print(f"    saving laugh clips to {cfg.clips_dir}")
    try:
        for ts, waveform in source:  # pragma: no cover - realtime
            if recorder is not None:
                recorder.push(ts, waveform)
            score = detector.score(waveform)
            event = counter.update(ts, score)
            if event:
                clip_path = recorder.save(event.start, event.end) if recorder else None
                speaker = "unknown"
                laugh_audio = recorder.extract(event.start, event.end) if recorder else None
                if laugh_audio:
                    try:
                        speaker, _ = identifier.identify(laugh_audio)
                    except Exception:  # noqa: BLE001 - never let ID break listening
                        speaker = "unknown"
                event = replace(event, speaker=speaker, clip_path=clip_path)
                storage.add(event)
                notify.laugh_logged(counter.count, speaker,
                                    sound=cfg.notify_sound,
                                    banner_notification=cfg.notify_banner)
                when = datetime.fromtimestamp(event.start).strftime("%H:%M:%S")
                who = "" if speaker == "unknown" else f" [{speaker}]"
                print(f"  😄 laugh #{counter.count} at {when} "
                      f"({_fmt_duration(event.duration)}, {int(event.peak_score * 100)}%){who}")
    except KeyboardInterrupt:  # pragma: no cover - interactive
        pass
    finally:
        tail = counter.flush()
        if tail:
            storage.add(tail)
        detector.close()
        storage.close()
        print("\nStopped. Run 'laughcounter stats' to see your day.")
    return 0


# ---------------------------------------------------------------------------
# stats / log / export / serve / config
# ---------------------------------------------------------------------------

def cmd_stats(args, cfg: Config) -> int:
    storage = Storage(cfg.db_path, cfg.jsonl_path)
    summary = stats.summary(storage, now=utcnow())
    if args.json:
        print(json.dumps(summary, indent=2))
    else:
        print(_render_stats(summary))
    storage.close()
    return 0


def cmd_log(args, cfg: Config) -> int:
    storage = Storage(cfg.db_path, cfg.jsonl_path)
    rows = storage.recent(args.number)
    if not rows:
        print("No laughs recorded yet.")
    else:
        for r in rows:
            when = datetime.fromtimestamp(r["start_ts"]).strftime("%Y-%m-%d %H:%M:%S")
            clip = " 🎧" if r.get("clip_path") else ""
            print(f"#{r['id']:<4} {when}  {_fmt_duration(r['duration']):>7}  "
                  f"peak {int(r['peak_score'] * 100):>3}%  "
                  f"{r['speaker']:<7} {r['label']:<9} {r['source']}{clip}")
    storage.close()
    return 0


def cmd_export(args, cfg: Config) -> int:
    storage = Storage(cfg.db_path, cfg.jsonl_path)
    rows = storage.all()
    storage.close()
    if args.format == "json":
        text = json.dumps(rows, indent=2)
    else:
        buf = io.StringIO()
        writer = csv.writer(buf)
        cols = ["id", "start_ts", "end_ts", "duration", "peak_score", "mean_score",
                "source", "speaker", "clip_path", "label", "created_at"]
        writer.writerow(cols)
        for r in rows:
            writer.writerow([r.get(c) for c in cols])
        text = buf.getvalue()
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text)
        print(f"Exported {len(rows)} event(s) → {args.out}")
    else:
        sys.stdout.write(text)
    return 0


def cmd_serve(args, cfg: Config) -> int:
    from .dashboard import serve

    host = args.host or cfg.dashboard_host
    port = args.port or cfg.dashboard_port
    # Ensure the database exists so the first page load has a table to read.
    Storage(cfg.db_path, cfg.jsonl_path).close()
    serve(cfg.db_path, host=host, port=port)
    return 0


def cmd_mark(args, cfg: Config) -> int:
    who = "guest" if args.guest else "me"
    store = Storage(cfg.db_path, cfg.jsonl_path)
    result = store.mark(now=utcnow(), who=who, window=cfg.mark_window)
    store.close()
    if result["matched"]:
        print(f"✓ Confirmed detected laugh #{result['id']} as {who}.")
    else:
        print(f"✓ Logged a laugh we missed (#{result['id']}, {who}). "
              "Thanks — that becomes training data.")
    return 0


def cmd_reject(args, cfg: Config) -> int:
    store = Storage(cfg.db_path, cfg.jsonl_path)
    ok = store.set_label(args.id, "rejected")
    store.close()
    if ok:
        print(f"✓ Marked #{args.id} as not-a-laugh (excluded from counts).")
        return 0
    print(f"✗ No laugh with id #{args.id}.", file=sys.stderr)
    return 1


def cmd_who(args, cfg: Config) -> int:
    store = Storage(cfg.db_path, cfg.jsonl_path)
    ok = store.set_speaker(args.id, args.speaker)
    store.close()
    if ok:
        print(f"✓ Attributed #{args.id} to {args.speaker}.")
        return 0
    print(f"✗ No laugh with id #{args.id}.", file=sys.stderr)
    return 1


def cmd_devices(args, cfg: Config) -> int:
    try:
        import sounddevice as sd
    except ImportError:
        print('Listing devices needs the audio deps: pip install "laughcounter[yamnet]"',
              file=sys.stderr)
        return 2
    print("Input devices (pass the index or name to `listen --device`):")
    for i, dev in enumerate(sd.query_devices()):
        if dev.get("max_input_channels", 0) > 0:
            print(f"  [{i}] {dev['name']} — {dev['max_input_channels']} channel(s)")
    return 0


def cmd_enroll(args, cfg: Config) -> int:
    from pathlib import Path

    from .clips import read_wav
    from .speaker import EcapaEmbedder, SpeakerProfiles

    src = Path(args.from_dir) if args.from_dir else cfg.clips_dir
    wavs = sorted(Path(src).glob("*.wav"))
    if not wavs:
        print(f"No .wav clips found in {src}. Let LaughCounter listen for a while "
              "first (so it saves your laughs), or pass --from DIR.", file=sys.stderr)
        return 1
    try:
        embedder = EcapaEmbedder(sample_rate=cfg.sample_rate)
    except ImportError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    profiles = SpeakerProfiles(cfg.speakers_path)
    n = 0
    for wav in wavs:
        try:
            samples, _rate = read_wav(wav)
            profiles.add_embedding(args.name, embedder(samples))
            n += 1
        except Exception as exc:  # noqa: BLE001 - skip unreadable clips, keep going
            print(f"  skip {wav.name}: {exc}", file=sys.stderr)
    profiles.save()
    print(f"✓ Enrolled {n} clip(s) into profile '{args.name}' → {cfg.speakers_path}")
    print("  New laughs will now be attributed to you vs guests.")
    return 0


_PLIST_TEMPLATE = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>{label}</string>
    <key>ProgramArguments</key>
    <array>
{args_xml}
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>{log}</string>
    <key>StandardErrorPath</key><string>{log}</string>
</dict>
</plist>
"""


def cmd_service(args, cfg: Config) -> int:
    import html

    label = "com.laughcounter.listen"
    argv = [sys.executable, "-m", "laughcounter", "--home", str(cfg.home_path), "listen"]
    args_xml = "\n".join(f"        <string>{html.escape(a)}</string>" for a in argv)
    log = str(cfg.home_path / "listen.log")
    plist = _PLIST_TEMPLATE.format(label=label, args_xml=args_xml, log=log)
    print(plist, end="")
    dest = f"~/Library/LaunchAgents/{label}.plist"
    print(
        f"\n# To run LaughCounter always-on on this Mac mini:\n"
        f"#   laughcounter service > {dest}\n"
        f"#   launchctl load {dest}\n"
        f"# It will start on login and restart if it ever exits.\n"
        f"# Stop it with:  launchctl unload {dest}",
        file=sys.stderr,
    )
    return 0


def cmd_config(args, cfg: Config) -> int:
    if args.init:
        path = cfg.save()
        print(f"Wrote default config → {path}")
    from dataclasses import fields

    print("Configuration:")
    for f in fields(cfg):
        print(f"  {f.name:16} = {getattr(cfg, f.name)}")
    print(f"  {'db_path':16} = {cfg.db_path}")
    print(f"  {'jsonl_path':16} = {cfg.jsonl_path}")
    return 0


# ---------------------------------------------------------------------------
# argument parsing
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="laughcounter",
        description="Listen for laughter at home, count it, and log it.",
    )
    p.add_argument("--version", action="version", version=f"laughcounter {__version__}")
    p.add_argument("--home", help="data directory (overrides LAUGHCOUNTER_HOME)")
    sub = p.add_subparsers(dest="command", required=True)

    s = sub.add_parser("listen", help="listen to the mic and log laughs")
    s.add_argument("--device", help="input device index or name")
    s.set_defaults(func=cmd_listen)

    s = sub.add_parser("simulate", help="generate synthetic laughs to try things out")
    s.add_argument("-n", "--count", type=int, default=25, help="how many laughs")
    s.add_argument("--days", type=int, default=7, help="spread across the last N days")
    s.add_argument("--seed", type=int, default=None, help="random seed")
    s.set_defaults(func=cmd_simulate)

    s = sub.add_parser("mark", help="record that you just laughed (confirms or logs a miss)")
    s.add_argument("--guest", action="store_true", help="attribute it to a guest, not you")
    s.set_defaults(func=cmd_mark)

    s = sub.add_parser("reject", help="mark a logged event as not a real laugh")
    s.add_argument("id", type=int, help="the laugh id (see `log`)")
    s.set_defaults(func=cmd_reject)

    s = sub.add_parser("who", help="correct who a laugh belongs to")
    s.add_argument("id", type=int, help="the laugh id (see `log`)")
    s.add_argument("speaker", choices=["me", "guest"], help="who actually laughed")
    s.set_defaults(func=cmd_who)

    s = sub.add_parser("enroll", help="teach it your laugh (needs the [speaker] extra)")
    s.add_argument("--name", default="me", help="profile name (default: me)")
    s.add_argument("--from", dest="from_dir", help="directory of .wav clips (default: saved clips)")
    s.set_defaults(func=cmd_enroll)

    s = sub.add_parser("devices", help="list input microphones")
    s.set_defaults(func=cmd_devices)

    s = sub.add_parser("service", help="print a launchd agent to run always-on (macOS)")
    s.set_defaults(func=cmd_service)

    s = sub.add_parser("stats", help="show a summary of your laughter")
    s.add_argument("--json", action="store_true", help="emit JSON instead of text")
    s.set_defaults(func=cmd_stats)

    s = sub.add_parser("log", help="show recent laughs")
    s.add_argument("-n", "--number", type=int, default=20, help="how many to show")
    s.set_defaults(func=cmd_log)

    s = sub.add_parser("export", help="export all events")
    s.add_argument("--format", choices=["csv", "json"], default="csv")
    s.add_argument("--out", help="output file (default: stdout)")
    s.set_defaults(func=cmd_export)

    s = sub.add_parser("serve", help="run the local web dashboard")
    s.add_argument("--host", help="bind address (default 127.0.0.1)")
    s.add_argument("--port", type=int, help="port (default 8422)")
    s.set_defaults(func=cmd_serve)

    s = sub.add_parser("config", help="show or initialise configuration")
    s.add_argument("--init", action="store_true", help="write a default config file")
    s.set_defaults(func=cmd_config)

    return p


def main(argv=None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    cfg = Config.load(home=args.home)
    return args.func(args, cfg)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
