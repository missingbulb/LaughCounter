# 😂 LaughCounter

**A thing that listens and counts the laughs.** LaughCounter runs quietly on the
always-on Mac mini in your living room, listens through a USB/webcam mic, detects
when you laugh, counts each laugh, notes *who* laughed (you vs. a guest), and logs
it — so you can see how much joy your days actually hold. It gets better over time
from a one-tap "I just laughed" whenever it misses one.

Everything runs locally. Your Google speaker keeps working as a Google speaker —
LaughCounter never touches it.

### ⬇️ Download

**[Get the latest macOS app → `LaughCounter.dmg`](https://github.com/missingbulb/LaughCounter/releases/latest/download/LaughCounter.dmg)** · [all releases](https://github.com/missingbulb/LaughCounter/releases)

A ready-made build, published automatically on every change to `main` — no Xcode. See [`mac/README.md`](mac/README.md) to install.

---

## Two ways to run it

- **🍎 Native macOS app (recommended for the Mac mini)** — a tiny menu-bar app that
  uses macOS's **built-in** laughter detection, so there's **nothing to install**
  (no Python, no TensorFlow, no Homebrew) and nothing left behind when you delete
  it. Menu-bar count, a blip when a laugh is logged, and a hands-free "I just
  laughed" voice command. **⬇️ [Download the latest `LaughCounter.dmg`](https://github.com/missingbulb/LaughCounter/releases/latest/download/LaughCounter.dmg)**
  (a ready-made build from GitHub — no Xcode). **See [`mac/README.md`](mac/README.md).**
- **🐍 Python reference / simulator (this folder)** — a fully-tested,
  cross-platform implementation with a phone-friendly web dashboard, feedback
  commands, stats, and an offline `simulate` mode. Great for trying the whole
  pipeline anywhere. Documented below.

The two share the same simple JSONL log format. For the full reasoning behind the
architecture — deployment options, how misses become improvements, and the
who-laughed plan — see **[`docs/DESIGN-AND-TRADEOFFS.md`](docs/DESIGN-AND-TRADEOFFS.md)**.

## Does something like this already exist?

Sort of, but nothing that fits this setup:

- **Manual tap counters** ([LaughMeter](https://apps.apple.com/us/app/laughmeter-happiness-tracker/id6757206708),
  [Laughter Meter](https://play.google.com/store/apps/details?id=com.wejek.app&hl=en_US)) —
  *you* tap each time. Not automatic.
- **[Giggle Gauge](https://gigglegauge.com/)** — the closest: AI that auto-detects
  laughter, but built around phone apps + wearable pendants and cloud services,
  not an always-on box watching just your living room, and it can't tell you who
  laughed or learn from your corrections.

So LaughCounter is self-hosted and local, and leans on **pretrained** models so you
never have to hand-label a training set:

- **Laughter detection:** Google's [YAMNet](https://tfhub.dev/google/yamnet/1)
  (default) — runs in real time on the Mac mini's CPU and recognises many kinds of
  laughter (giggle, chuckle, belly laugh, snicker). For a heavier, noise-robust
  upgrade there's an adapter for
  [jrgillick/laughter-detection](https://github.com/jrgillick/laughter-detection)
  (Interspeech 2021), trained with augmentation so it generalises across laugh
  styles rather than overfitting one.
- **Who laughed:** speaker embeddings (ECAPA-TDNN). You *enroll* your own laugh
  from clips it saves — no dataset to build — and it improves as more of your
  laughs are added.

---

## How it works

```
 USB/webcam mic ─► detector ─► counter ─► storage ─► stats / dashboard
  (living room)   (YAMNet)    (state      (SQLite +   (CLI + phone-friendly
                              machine)     clips)      web page + feedback)
       │                                     ▲
       └──── short clip saved per laugh ──────┘  (to improve accuracy over time)
```

1. **Detector** reports, for each ~1s window, how strongly it hears laughter.
2. **Counter** — a [hysteresis state machine](laughcounter/counter.py) — turns that
   noisy stream into discrete laugh *episodes* (a fit of giggles = one laugh, a
   stray blip = none).
3. **Storage** writes one row per laugh (time, length, confidence, who, your
   feedback label) to SQLite + a JSONL log, and saves a short audio clip of the
   laugh.
4. **Feedback** — a soft blip tells you it caught one; if it missed, one tap logs
   the miss as training data.

The core (counting, storage, stats, dashboard, feedback, CLI) needs **only the
Python standard library**. TensorFlow, the mic, and the speaker model are optional
extras used only for live listening.

---

## Setup on the Mac mini

```bash
# 1. Install (with the mic + YAMNet detector)
pip install "laughcounter[yamnet]"
#    macOS also needs PortAudio for the mic:  brew install portaudio

# 2. Find your webcam/USB mic and note its index
laughcounter devices

# 3. Try it (Ctrl+C to stop). Laugh at it!
laughcounter listen --device "USB"    # index number or a name substring

# 4. See results, from the Mac or your phone
laughcounter stats
laughcounter serve --host 0.0.0.0     # open http://<mac-mini-ip>:8422 on your phone
```

**Run it always-on** with launchd:

```bash
laughcounter service > ~/Library/LaunchAgents/com.laughcounter.listen.plist
launchctl load ~/Library/LaunchAgents/com.laughcounter.listen.plist   # starts now + on login
```

### Try it right now without a mic

The whole pipeline runs offline with synthetic laughs (no installs needed):

```bash
python -m laughcounter simulate -n 30 --seed 1
python -m laughcounter stats
python -m laughcounter serve      # http://127.0.0.1:8422
```

---

## The feedback loop (how it gets better)

You don't need it perfect on day one. Two tiny habits improve it:

- **When you laugh and hear a blip** → it caught you, nothing to do.
- **When you laugh and *don't* hear a blip** → tap **“😂 I just laughed”** on the
  dashboard (or run `laughcounter mark`). If a detection was near, it's confirmed;
  if not, the miss is logged as a **false negative** — exactly the example the model
  most needs.
- **If it logs something that wasn't a laugh** → “not a laugh” on the dashboard, or
  `laughcounter reject <id>` (excluded from counts).
- **If it misattributes** → the “me/guest” buttons, or `laughcounter who <id> guest`.

Every correction, plus the saved clips, becomes the material to sharpen detection
and speaker attribution later — without you ever labeling a dataset up front.

### Teaching it your laugh (optional)

After it has saved some of your laughs:

```bash
pip install "laughcounter[speaker]"
laughcounter enroll --name me        # builds your voice profile from saved clips
```

From then on laughs are tagged **me** or **guest**. Because laughter varies so much,
your profile is a running average over many of your laughs, so it won't lock onto a
single giggle.

---

## Commands

| Command | What it does |
| --- | --- |
| `laughcounter listen [--device D]` | Listen to the mic and log laughs. |
| `laughcounter devices` | List input microphones. |
| `laughcounter mark [--guest]` | "I just laughed" — confirm a catch or log a miss. |
| `laughcounter reject <id>` | Mark a logged event as not a real laugh. |
| `laughcounter who <id> me\|guest` | Correct who a laugh belongs to. |
| `laughcounter enroll [--name me]` | Teach it your laugh (needs `[speaker]`). |
| `laughcounter stats [--json]` | Summary: today, week, streaks, who, hours. |
| `laughcounter log [-n N]` | Recent laughs with ids. |
| `laughcounter export --format csv\|json` | Export everything. |
| `laughcounter serve [--host H] [--port P]` | Local web dashboard. |
| `laughcounter service` | Print a launchd agent for always-on operation. |
| `laughcounter simulate -n N` | Generate synthetic laughs to try things out. |
| `laughcounter config [--init]` | Show or write configuration. |

Add `--home DIR` (or set `LAUGHCOUNTER_HOME`) to store data elsewhere than
`~/.laughcounter`.

---

## Configuration

`laughcounter config --init` writes `~/.laughcounter/config.json`. Useful knobs:

| Setting | Default | Meaning |
| --- | --- | --- |
| `enter_threshold` | `0.5` | Confidence needed to *start* counting a laugh. |
| `exit_threshold` | `0.3` | Confidence needed to *keep* a laugh going (hysteresis). |
| `min_duration` | `0.4` | Ignore laughs shorter than this (seconds). |
| `merge_gap` | `1.0` | Silence shorter than this joins two bursts into one laugh. |
| `save_clips` | `true` | Save a short audio clip of each laugh (to improve later). |
| `notify_sound` | `true` | Play a soft blip when a laugh is logged. |
| `speaker_threshold` | `0.55` | How close a laugh must be to your profile to count as you. |
| `detector` | `"yamnet"` | Live detector backend (`yamnet` or experimental `robust`). |

Raise `enter_threshold` if it counts non-laughs; lower it if it misses quiet chuckles.

---

## Privacy

- Runs on your Mac mini; **your audio never leaves it** and your Google speaker is
  untouched. The one exception is a **one-time model download** on first use
  (YAMNet from Google's TF Hub, and, if you enable it, the speaker model from
  Hugging Face); after that it runs fully offline. No audio is ever uploaded.
- LaughCounter does **not** record the room. It keeps only a **few seconds around
  each *detected* laugh** — because you asked it to, so it can improve — under
  `~/.laughcounter/clips`. (Tapping “I just laughed” logs the *event* for training
  signal but doesn't capture audio.) Delete that folder anytime; the counts remain.
  Set `save_clips = false` to keep none.
- The mic hears only where you put it — placing it in the living room is what scopes
  LaughCounter to the living room.
- The dashboard binds to `127.0.0.1` unless you pass `--host 0.0.0.0` to reach it
  from your phone on your home wifi.

---

## Development

```bash
pip install -e ".[dev]"
pytest
```

The whole test suite runs without any of the optional ML dependencies.

## License

MIT
