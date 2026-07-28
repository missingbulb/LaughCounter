# On-device privacy — the boundary the whole product is built around

An always-on microphone in someone's living room only earns its place if what it
hears stays on the machine. That promise is the product requirement
(`docs/DESIGN-AND-TRADEOFFS.md` §0/§6, README *Privacy*), the text of the mic and
speech prompts users actually see (`mac/Resources/Info.plist`), and the reason
several design choices look heavier than they need to. The checks in this pack
hold the mechanical half; what follows is the judgment half.

**What may cross the boundary: derived metadata, never audio.** A laugh is
persisted as time, duration, confidence, and a speaker label — that is what the
SQLite rows and the JSONL lines carry. Saved clips (`save_clips`, on by default
in the Python core) are the one place raw audio lands, and it lands on local
disk under the single home directory, never anywhere else. New persisted fields
follow the same split; if a feature wants audio, it belongs in `clips/`, under
the user's existing choice, not in a new location.

**Everything lives in one deletable directory.** `~/.laughcounter` for the Python
core (overridable via `LAUGHCOUNTER_HOME`), `~/Library/Application
Support/LaughCounter/` for the app. "Delete the folder and it's gone" is a
documented property — don't scatter state (caches, model files, logs) outside it.

**The one accepted egress is a model download in an optional extra.** The
`[yamnet]` extra fetches the TF-Hub handle in `detector/yamnet.py`, and the
`[speaker]` extra fetches ECAPA weights from Hugging Face — a one-time download,
made by the ML library, carrying no audio, in a stack the user opted into. The
always-on paths (the native app's Sound Analysis and Speech, the counting/logging
core) need no network at all. Adding a *new* egress means saying so in the README
Privacy section and here, and keeping it out of the capture path.

**There is no server.** The web dashboard was removed on purpose (the laugh log
is read via the CLI); the Python core neither listens on a socket nor speaks to
one. Reintroducing any listener — a dashboard, a metrics port, a remote-control
API — is a product decision about exposing the laugh log, not a feature to slip
in: it needs the owner's explicit sign-off, a loopback-only default, and a story
for authentication or CSRF before it lands.

**The disclosure must stay true.** `NSMicrophoneUsageDescription` and
`NSSpeechRecognitionUsageDescription` tell the user audio is analysed on-device
and not recorded. If the app's behaviour ever changes, those strings change with
it in the same commit — a stale privacy prompt is worse than a blunt one.
