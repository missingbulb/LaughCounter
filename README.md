# 😂 LaughCounter

<!-- claudinite:packs -->
![basics](../../../../../tmp/claudinite-canon-Kds8ZF/packs/basics/badge.svg "basics") ![barriers](../../../../../tmp/claudinite-canon-Kds8ZF/packs/barriers/badge.svg "barriers") ![git-github](../../../../../tmp/claudinite-canon-Kds8ZF/packs/git-github/badge.svg "git-github") ![grow_with_claudinite](../../../../../tmp/claudinite-canon-Kds8ZF/packs/grow_with_claudinite/badge.svg "grow_with_claudinite") ![tidy-repo](../../../../../tmp/claudinite-canon-Kds8ZF/packs/tidy-repo/badge.svg "tidy-repo") ![github-actions](../../../../../tmp/claudinite-canon-Kds8ZF/packs/github-actions/badge.svg "github-actions")<!-- /claudinite:packs -->

**A thing that listens and counts the laughs.** LaughCounter runs quietly on the
always-on Mac mini in your living room, listens through a USB/webcam mic, detects
when you laugh, counts each laugh, tells your laughs from the TV's, and logs it —
so you can see how much joy your days actually hold. It gets better over time from
a hands-free "I just laughed" whenever it misses one.

Everything runs locally. Your Google speaker keeps working as a Google speaker —
LaughCounter never touches it.

### ⬇️ Download

**[Get the latest macOS app → `LaughCounter.dmg`](https://github.com/missingbulb/LaughCounter/releases/latest/download/LaughCounter.dmg)** · [all releases](https://github.com/missingbulb/LaughCounter/releases)

A ready-made build, published automatically on every change to `main` — no Xcode. See [`mac/README.md`](mac/README.md) to install.

---

## What it is

A tiny **native macOS menu-bar app** that uses macOS's **built-in** laughter
detection — so there's **nothing to install** (no Python, no TensorFlow, no
Homebrew), nothing downloaded at runtime, and nothing left behind when you delete
it. Drag it to Applications, approve the mic, and a 😄 with today's count appears
in your menu bar.

Everything about installing, using, and building it lives in
**[`mac/README.md`](mac/README.md)**. For the reasoning behind the architecture —
why a native app, how misses become improvements, and the who-laughed plan — see
**[`docs/DESIGN-AND-TRADEOFFS.md`](docs/DESIGN-AND-TRADEOFFS.md)**.

## Does something like this already exist?

Sort of, but nothing that fits this setup:

- **Manual tap counters** ([LaughMeter](https://apps.apple.com/us/app/laughmeter-happiness-tracker/id6757206708),
  [Laughter Meter](https://play.google.com/store/apps/details?id=com.wejek.app&hl=en_US)) —
  *you* tap each time. Not automatic.
- **[Giggle Gauge](https://gigglegauge.com/)** — the closest: AI that auto-detects
  laughter, but built around phone apps + wearable pendants and cloud services,
  not an always-on box watching just your living room, and it can't learn from
  your corrections.

So LaughCounter is self-hosted and local, and leans on the **pretrained** classifier
already inside macOS, so you never have to hand-label a training set — and nothing
is ever fetched from the network.

---

## How it works

```
 USB/webcam mic ─► Sound Analysis ─► counter ─► JSONL log ─► menu bar
  (living room)    (built into      (distinct   (metadata     (😄 you
                    macOS)           laughs)     only)         📺 TV)
       │                                            ▲
       └──── "I just laughed" (voice or ⌘L) ────────┘
```

1. **Detection** — Apple's Sound Analysis reports, for each ~3s window, how
   strongly it hears laughter, plus what else it heard (music, dialogue, applause).
2. **Counting** turns that noisy stream into discrete laugh *episodes* — a fit of
   giggles is one laugh, a stray blip is none.
3. **You vs the TV** — a strong produced-audio context attributes the laugh to the
   TV, clean laughter to you. It's a hypothesis, logged with its reasoning, and
   only *your* laughs blip.
4. **Logging** appends one JSON line per laugh (time, length, confidence, origin,
   your feedback label). **No audio is recorded** — ever.
5. **Feedback** — a soft blip tells you it caught one; say **"I just laughed"**
   (or press ⌘L) and it logs the one it missed, blipping twice to confirm.

The app uses only built-in frameworks. Nothing is downloaded, at install time or
after.

---

## Setup on the Mac mini

Download the DMG, drag it to Applications, and approve **Microphone** and **Speech
Recognition** when prompted. Add it to **System Settings → General → Login Items**
to have it start with the Mac.

Full steps — including the first-launch Gatekeeper prompt, the laugh-log format,
and building it yourself — are in **[`mac/README.md`](mac/README.md)**.

---

## The feedback loop (how it gets better)

You don't need it perfect on day one. Two tiny habits improve it:

- **When you laugh and hear a blip** → it caught you, nothing to do.
- **When you laugh and *don't* hear a blip** → say **"I just laughed"** (or ⌘L
  from the menu). The miss is logged as a **false negative** — exactly the example
  the detector most needs.

Near-misses are recorded too: anything clearing a deliberately low bar but not the
counting threshold is logged as a `candidate` (uncounted), so later feedback can be
aligned to a nearby event. Every correction becomes the material to sharpen
detection later — threshold tuning now, a personalised Create ML model eventually —
without you ever labeling a dataset up front.

---

## Privacy

- Runs on your Mac mini; **your audio never leaves it** and your Google speaker is
  untouched. There is **no network access at all** — no model download, no
  telemetry, no sync. Detection and speech recognition are both built into macOS
  and run on-device.
- LaughCounter does **not** record the room, and **saves no audio whatsoever** —
  only metadata about each laugh (time, length, confidence, origin) as text.
- Everything it keeps lives in `~/Library/Application Support/LaughCounter/`.
  Delete that folder and it's gone.
- The mic hears only where you put it — placing it in the living room is what scopes
  LaughCounter to the living room.

---

## Development

```bash
cd mac
bash scripts/build-app.sh     # -> dist/LaughCounter.app
bash scripts/make-dmg.sh      # -> dist/LaughCounter.dmg
```

Requires the Swift toolchain (Xcode Command Line Tools); no third-party packages.
See [`mac/README.md`](mac/README.md) for the full build, signing, and release path.

## License

MIT
