# On-device privacy — the boundary the whole product is built around

An always-on microphone in someone's living room only earns its place if what it
hears stays on the machine. That promise is the product requirement
(`docs/DESIGN-AND-TRADEOFFS.md` §0/§6, README *Privacy*), the text of the mic and
speech prompts users actually see (`mac/Resources/Info.plist`), and the reason
several design choices look heavier than they need to. The checks in this pack
hold the mechanical half; what follows is the judgment half.

There is now exactly one implementation — the native app in `mac/Sources/` — so
every rule below is about it.

**What may cross the boundary: derived metadata, never audio.** A laugh is
persisted as time, duration, confidence, and an origin label — that is what the
JSONL lines carry, and `LaughStore` says so in its own header. **No audio is
stored at all**: there is no clip directory, no buffer written to disk, nothing to
delete but a text log. A feature that wants to keep audio is not a new field, it
is a new promise to the user, and it changes the mic prompt with it.

**Everything lives in one deletable directory.**
`~/Library/Application Support/LaughCounter/` holds the laugh log and the app's
own diagnostic log, and nothing lands outside it (the one path macOS dictates, not
us, is a Login Item registration). "Delete the folder and it's gone" is a promise a
user *acts on* — someone who deletes it believes the mic's whole memory of them
went with it. So a feature needing somewhere new to keep things extends that
directory rather than earning a second one.

**There is no accepted egress — none.** Detection (Sound Analysis) and speech
recognition (`SFSpeechRecognizer` with on-device recognition required) are both
built into macOS; no model is downloaded, no telemetry is sent, and the app makes
no outbound connection of any kind. The `no-network-client` check is therefore
absolute rather than carve-out-shaped. Adding *any* egress — a model fetch, a
crash reporter, a sync feature — is a product decision that gets written here and
in the README *Privacy* section before a line of it is written in Swift.

**There is no server either.** The app listens on no socket. The web dashboard
that once existed in the Python reference was removed on purpose, along with the
reference itself. Reintroducing any listener — a dashboard, a metrics port, a
remote-control API — is a decision about exposing the laugh log, not a feature to
slip in: it needs the owner's explicit sign-off, a loopback-only default, and a
story for authentication or CSRF before it lands.

**The disclosure must stay true.** `NSMicrophoneUsageDescription` and
`NSSpeechRecognitionUsageDescription` tell the user audio is analysed on-device
and not recorded. If the app's behaviour ever changes, those strings change with
it in the same commit — a stale privacy prompt is worse than a blunt one.
