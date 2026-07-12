# LaughCounter — Design & Tradeoffs

This document records the decisions behind LaughCounter and, honestly, what each
one costs. It's meant to be read before choosing how to run it.

**Goal.** Count and log every time you laugh at home (living room), running
always-on on your Mac mini, with a light indication when a laugh is caught and an
easy way to correct misses — without dirtying the Mac and without your audio
leaving the house. Nice-to-have: tell *your* laugh apart from guests'.

---

## 0. Requirements (captured from the conversation)

Every requirement gathered while scoping this, and where each is handled.

| Requirement | How it's addressed |
| --- | --- |
| One-bedroom apartment; **only living-room laughs** | The mic is placed in the living room — physical placement is what scopes detection to that room (§1, §6). |
| **Google speaker must keep working** as a Google speaker | LaughCounter never touches it; it uses its own microphone. Nothing is installed on or intercepted from the speaker (§6). |
| Runs on the **always-on Mac mini** (in the living room) | Native menu-bar app; add to Login Items to auto-start (§1). |
| **No built-in mic** on the Mac mini; prefer not to buy one | Use a **USB/webcam mic you already own**, plugged into the mini in the living room. (The Google speaker's mic is locked to Google and can't be tapped; the mini has no mic of its own — so some mic is required, but not a purchase.) |
| Doesn't need to be **100% correct at release**; improve over time | Feedback loop tunes detection now and trains a personalised model later (§2, §3). |
| **Indication** when a laugh is logged; a way to say **it missed one** | Menu-bar count + a soft blip on each log; "I just laughed" logs a miss (§3). |
| **Voice** feedback: hear "I just laughed" and mark it; confirm it registered | On-device speech recognition + a **double blip** on trigger (§3). |
| **Menu-bar** running indicator | The 😄 status item is present whenever the app runs (§3). |
| Tell **who laughed** — me vs. others; possibly multiple people | Optional second stage: me-vs-guest is reliable; named people possible with limits (§4). |
| **Save laugh samples** to improve quality; **avoid hand-labeling**; reuse existing algorithms | Built-in pretrained detector (no data needed); saved clips + Create ML transfer learning later (§2, §5). |
| **Many ways to laugh** — don't overfit one style | Matches several laughter classes; Create ML uses transfer learning; a who-profile is a running average over many laughs (§2, §4). |
| Tell me if an **existing product** already does this | Surveyed in the root `README.md` ("Does something like this already exist?") — nothing fits, hence self-hosted. |
| **Keep the Mac clean**; no unfamiliar installers | Native app uses only built-in frameworks — no Python/TensorFlow/Homebrew; trash the app to uninstall (§1). |
| **Don't build the DMG myself** — use a service | GitHub Actions macOS runners build and package the `.dmg` for download (§1). |

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
