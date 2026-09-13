# LaughCounter — what this repo knows about itself

The lessons this project has paid for once. Portable macOS knowledge — the app
bundle, signing and notarization, and the device, sleep/wake and exit lifecycle
any Mac capture app must get right — is canon `macos`, which this repo declares;
read it there rather than looking for a second copy here.

## The privacy boundary — the whole product is built around it

An always-on microphone in someone's living room only earns its place if what it
hears stays on the machine. That promise is the product requirement
(`docs/DESIGN-AND-TRADEOFFS.md` §0/§6, README *Privacy*), the text of the mic and
speech prompts users actually see (`mac/Resources/Info.plist`), and the reason
several design choices look heavier than they need to. The checks below hold the
mechanical half; what follows is the judgment half. There is exactly one
implementation — the native app in `mac/Sources/`.

**What may cross the boundary: derived metadata, never audio.** A laugh is
persisted as time, duration, confidence, and an origin label — that is what the
JSONL lines carry, and `LaughStore` says so in its own header. **No audio is
stored at all** — the `no-audio-persistence` check holds this mechanically for
v1. A feature that wants to keep audio (the v3 roadmap's rolling buffer) changes
the mic prompt and this check together, in the same PR.

**Everything lives in one deletable directory.**
`~/Library/Application Support/LaughCounter/` holds the laugh log and the app's
own diagnostic log — the `single-storage-directory` check holds this mechanically,
by allowing `.applicationSupportDirectory` and nothing else as a search-path root.
The one path macOS dictates, not us, is a Login Item registration, which names no
directory of its own.

**There is no accepted egress — none.** Detection (Sound Analysis) and speech
recognition (`SFSpeechRecognizer` with on-device recognition required) are both
built into macOS; no model is downloaded, no telemetry is sent, and the app makes
no outbound connection of any kind. The `no-network-client` check is therefore
absolute rather than carve-out-shaped. Adding *any* egress — a model fetch, a
crash reporter, a sync feature — is a product decision that gets written here and
in the README *Privacy* section before a line of it is written in Swift.

`NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription` tell
the user audio is analysed on-device and not recorded.

## The microphone this app holds

The device lifecycle rules are canon `macos`'s (*Holding a device the user can
unplug*, *Sleep, wake, and deferred work*, *Exit paths*) — this repo is where they
came from, and they are not restated here. What stays local is which of this app's
types owns what, and what the case history measured.

**Read [`dev/procedures/mac-audio-lifecycle.md`](../../../../dev/procedures/mac-audio-lifecycle.md)
before touching engine start/stop, sleep/wake, exit handling, or `VoiceCommand`.**
It carries the case history — which release, which measurement, which theory
survived — behind every device rule canon now states in general terms. LaughCounter
has repeatedly left the owner's USB webcam mic **wedged**, dead system-wide until
physically re-plugged; the narrative of how stays there rather than being copied
into a rule.

**`AudioHub` is the sole owner of the engine, and `AudioDiagnostics` is the only
thing that answers questions about the device.** Nothing else builds an
`AVAudioEngine` or reaches `engine.inputNode` (the `engine-construction-confined`
and `input-node-confined` checks), because both open the default input;
`hasUsableInput` and `inputAvailability` answer from HAL property queries that open
nothing. `AudioHub.validatedFormat()` is where "presence is not usability" is
enforced for this app: both `inputFormat` and `outputFormat` must be nonzero and
must agree.

**The state the menu shows comes from `AudioDiagnostics.health`, and no-signal
names the one remedy that works.** `ok` / `stalled` / `noSignal` are measured from
arriving buffers, never from `engine.start()` having returned; the no-signal state
tells the owner to unplug the mic, because "Restart listening" was *measured* not
to recover it. (1)

**The HAL reads live in `AudioDiagnostics` rather than in a helper script,
deliberately.** The owner's Mac installs the DMG from CI and has no Xcode command
line tools, so anything needed to diagnose a live failure is either shell built
into macOS or compiled into the app by CI.

## Build, packaging and maintenance

**Ship a version the running app can state, and bump it whenever a build has to be
told apart from the last one.** The menu renders `LaughCounter v<version> (<build>)`
from `Bundle.main` rather than a constant in the source — `Info.plist` is already
where the version lives and where the release tag comes from, and a second copy
could disagree with the DMG it shipped in — and the **build number** is what
separates two builds that share a version string, so show it and raise it too. (2)

**Nothing in this repo runs on `pull_request`, so most PRs carry no checks at all
— and arming auto-merge on one is rejected every time.** `build-macos-dmg.yml`
and `release-macos-dmg.yml` trigger on `push` scoped to `mac/**` (plus their own
file), and `claudinite-scheduler.yml` only on `schedule`/`workflow_dispatch`; no
workflow here declares a `pull_request` trigger. A PR touching only
`.claudinite/`, `docs/` or `dev/` therefore starts nothing, is mergeable the
second it opens, and GitHub answers the auto-merge arm with *"already in clean
status — auto-merge only applies when checks are pending."* That is the repo's
shape, not a fault. Two corollaries: the maintenance PRs the Action opens land
**within seconds** of being armed, so by the time the agent stage starts there
is usually no open `claudinite/maintenance-*` PR left to continue on — the
first move is to fetch `main` and re-run the check against it. And "CI will
catch it" is simply false outside `mac/**`: nothing runs, so whatever a change
needed proving, prove it locally before it lands. (3)

**This repo's own placement convention is what makes a text-matching check
especially likely to flag the comment that documents the very idiom it bans.**
A trap gets written down as a comment beside the call it applies to, so the
closer a gotcha comment sits to the code, the more certainly a grep for that
gotcha lands on the warning instead of the offence. (4)

**Every scheduled session here takes a hit the executor doc doesn't mention —
expect it and spend nothing re-deriving it.** A second `<github-trigger-context>`
for the same issue arrives mid-run. It is the webhook echo of your own
`ready-for-agent` → `agent-running` swap, since a label change is itself a
labeling event. It is not a new dispatch and not a competing claim —
`resolve-dispatch.mjs` answers `exit 0 / not-mine` precisely because *you* are
the claimant — so change nothing, comment nothing, do not re-dispatch, and do
not read it as a lease you lost. (5)

**`verify-outcome.mjs` is a plain ESM module export (`verifyOutcome()`), not a
CLI — `--help` returns nothing.** `executor.md` gives `record-exec.mjs` an
explicit invocation snippet but never shows one for `verify-outcome.mjs`. The
`<engine>/scheduler/` prefix those snippets use is itself stale — the
vendored engine carries no `scheduler/` directory — so call it by its real
path directly: `node -e "import('./.claudinite/shared/packs/claudinite-tasks/verify-outcome.mjs')
  .then(m => console.log(JSON.stringify(m.verifyOutcome({outcome, openedPr, mergedPr}))))"`. (6)
