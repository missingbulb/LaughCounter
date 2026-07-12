# LaughCounter — Design & Tradeoffs

This document records the decisions behind LaughCounter and, honestly, what each
one costs. It's meant to be read before choosing how to run it.

**Goal.** Count and log every time you laugh at home (living room), running
always-on on your Mac mini, with a light indication when a laugh is caught and an
easy way to correct misses — without dirtying the Mac and without your audio
leaving the house. Nice-to-have: tell *your* laugh apart from guests'.

---

## 1. Deployment: how it runs on the Mac

We considered four shapes. The short version: **a small native menu-bar app is
the cleanest fit**, because macOS already contains a laughter detector, so the
whole heavyweight stack disappears.

| Option | What it is | Keeps the Mac clean? | Effort / risk | Verdict |
| --- | --- | --- | --- | --- |
| **A. Native menu-bar app** (chosen) | A tiny Swift app using macOS's built-in Sound Analysis + Speech + AVFoundation | ✅ Zero dependencies. Drag to Applications; trash to fully uninstall | Must be **built on a Mac** (we use CI so you don't) | **Chosen** |
| B. Bundled Python app (`.app` in a DMG) | The Python reference packaged with its own Python + TensorFlow | ✅ Nothing system-wide, but a big self-contained blob (100s of MB) | Bundling TensorFlow is fiddly; still a Mac build | Fallback |
| C. One-folder launcher | A folder with a "Start" script that sets up a local environment | ⚠️ Self-contained in one folder, but downloads libraries on first run | Low; deliverable without a Mac build | Quick-and-dirty |
| D. Docker container | Everything in a Linux container | ❌ **Can't reach the Mac microphone** (Docker on macOS runs in a Linux VM) | — | Ruled out |

### What a DMG actually is

A `.dmg` is just a disk image — a delivery envelope you double-click to reveal an
app you drag into **Applications**. It is *not* a runtime. The thing that made the
first plan "messy" wasn't the envelope; it was the contents (Python + TensorFlow +
Homebrew's PortAudio, which scatter files across the system). The native app has
**nothing** to scatter.

### Who builds the DMG

Building a macOS app must happen on a Mac, but **not yours** — we use **GitHub
Actions with macOS runners** (`.github/workflows/build-macos-dmg.yml`). On every
change to the app, GitHub compiles it and produces a downloadable `LaughCounter.dmg`
(as a build artifact, and attached to a GitHub Release when we tag a version). You
never open Xcode. (Free for public repos; private repos get limited free macOS
minutes. Alternatives if ever needed: Codemagic, Bitrise, or a Mac you own.)

### Auto-start & uninstall

- **Always-on:** add LaughCounter to **System Settings → General → Login Items**.
  No launchd files, no Terminal.
- **Uninstall:** quit it and drag the app to the Trash. Its data lives in
  `~/Library/Application Support/LaughCounter/` — delete that folder to erase
  history too.

---

## 2. Detecting laughter — and improving misses

### The engine

macOS's **Sound Analysis** framework ships a built-in sound classifier that
recognises hundreds of sounds, **including laughter**, running efficiently on the
Neural Engine. We use it directly: no model download, no TensorFlow. It emits a
laughter *confidence* several times a second; a small **hysteresis state machine**
(the same one proven out in the Python core) turns that into discrete laughs —
so a fit of giggles counts once and a stray blip counts as none.

We match several related classes (laughter, giggle, chuckle, snicker, …) rather
than one, so the counter doesn't overfit to a single style of laugh.

### Can we fix laughs it misses? Yes — in two layers.

**The built-in model is a black box: you cannot retrain it.** But the *system* is
improvable, and both layers stay on-device with no new dependencies:

1. **Tune the decision (immediate).** Many misses are "it heard the laughter, but
   just under the bar." Your feedback lowers/raises that bar (threshold, how long,
   smoothing) — and this can auto-adjust as you confirm laughs. Fixes the common
   near-misses right away.

2. **Train your own model (later).** For laughs the built-in model genuinely
   scores near zero, no threshold helps — that's the black box's ceiling. Apple's
   free **Create ML** trains a **custom on-device sound classifier** from your own
   labeled clips, and the same Sound Analysis API runs it. This both catches what
   Apple's model misses and **personalises to your laugh**. Uses transfer learning,
   so it needs dozens-to-hundreds of clips, not thousands.

**Requirement for layer 2:** a flagged miss is only trainable if the app kept the
*audio* around that moment. So (in a later phase) the app keeps a short rolling
buffer and, on "I missed one," saves those seconds as a labeled clip — accumulating
into the folder layout Create ML expects, making retraining roughly *drop folder →
train (minutes) → app loads the new model*.

> Compared to the Python/YAMNet route: same ceiling (YAMNet is also a fixed black
> box), but improving *there* means TensorFlow fine-tuning. Create ML is native and
> light, so the clean path is actually **more** improvable, not less.

---

## 3. Feedback: knowing it worked, and correcting it

- **Menu-bar indicator.** A 😄 icon with today's count sits in the menu bar the
  whole time the app runs — that *is* the "it's running" light. 🎙️ means it's
  still waiting for microphone permission; ⚠️ means access was denied.
- **Confirmation sound.** When a laugh is logged, a soft blip plays. That's your
  cue: heard it → caught. *Didn't* hear it → it missed one.
- **Tell it about a miss — hands-free.** An **on-device speech recogniser** (Apple's
  Speech framework) listens for you saying **"I just laughed"** (a few phrasings)
  and logs the miss. It plays the blip **twice** so you know your comment
  registered. A menu item ("I just laughed (log a miss)", shortcut ⌘L) does the
  same if you'd rather click.

### Voice-command tradeoffs (be aware)

- **On-device & private:** we set `requiresOnDeviceRecognition` when available, so
  speech never leaves the Mac. On older/unsupported setups it may be unavailable;
  the menu item remains as a fallback (the menu shows the current state).
- **Continuous listening:** the recogniser is restarted periodically and after each
  trigger — both to keep it alive (long single sessions can time out) and to clear
  the transcript so one phrase fires once. Triggers are debounced (~3s).
- **False triggers:** saying the phrase in conversation ("did you hear I just
  laughed at that?") can mark a laugh. It's cheap to over-count slightly, and you
  can reject stray entries; if it's annoying we can require a wake word.
- **Permissions:** needs Microphone *and* Speech Recognition permission (both
  prompt on first launch).

---

## 4. Who laughed? (me vs. guests)

Detection tells you *what* the sound is, not *who* made it — identity is a separate,
optional second stage, and it has real limits.

- **"Me vs. someone else" is the reliable, high-value version** and matches the
  original ask. **"Name each specific friend"** is possible but degrades for people
  rarely heard.
- **Two ways to build it**, both on-device:
  - *Create ML classifier with people as the classes* — cleanest; great for
    me-vs-guest and a small stable household; a stranger falls into "guest"; adding
    a named person means retraining with their clips.
  - *Voice-embedding + similarity* (the approach scaffolded in the Python version) —
    scales to add people without a full retrain and handles "unknown" better, but
    needs a voice-embedding model converted to Core ML (more moving parts).
- **Honest limits:** laughter is short and variable, so identity from it is *good,
  not perfect*; telling two rare guests apart is unreliable; each named person must
  be enrolled; accuracy grows with data. You (heard constantly) model best.
- The same **me/guest corrections** that fix attribution are the training labels —
  one feedback loop improves detection *and* identity.

This ceiling is roughly the same regardless of deployment — it's inherent to
laughter-based identification, not a Mac-vs-Python choice.

---

## 5. Roadmap (start simple, layer up)

- **v1 (now):** native menu-bar app — built-in laughter detection, distinct-laugh
  counting, JSONL log, running indicator, confirmation blip, voice "I just laughed"
  → double-blip, menu fallback. *The simplest thing that reliably tracks laughs.*
- **v2:** the phone-friendly dashboard (already built in the Python reference) wired
  to the same log; threshold auto-tuning from confirmations/misses.
- **v3:** rolling audio buffer → save clips on misses/confirmations → one-click
  Create ML retrain for a personalised laughter model.
- **v4:** who-laughed (me vs. guest) via Create ML, with enrollment.

---

## 6. Privacy

- Audio is analysed **on-device** and, in v1, **not stored at all** — only laugh
  metadata (time, length, confidence) goes to a local log.
- The one time anything leaves the Mac would be an *optional* future model download
  for the who-laughed feature; core laughter detection and the voice command need
  no download and no network.
- Your Google speaker is never touched.
- Everything lives in `~/Library/Application Support/LaughCounter/`; delete it and
  it's gone.

---

## 7. The Python reference (`laughcounter/`)

The repository also contains a fully-tested Python implementation with a web
dashboard, feedback commands, stats, clip-saving and speaker-attribution
scaffolding. It runs anywhere (great for trying the whole pipeline offline via
`simulate`) and is the reference for the counting/logging/stats logic the native
app mirrors. It uses the same JSONL format, so the two interoperate. See the root
`README.md`.
