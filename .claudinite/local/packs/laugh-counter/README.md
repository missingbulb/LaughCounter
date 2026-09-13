# laugh-counter

This repo's one local pack, named for the repo. It holds what LaughCounter knows
about *itself*: the on-device privacy boundary that is the product's defining
constraint, the microphone invariants that name this app's own types, and the
build, packaging, check-authoring and Claudinite-maintenance lessons the project
has paid for once.

Portable macOS knowledge — the app bundle, the TCC / Hardened Runtime pair, the
Developer ID → notarization → DMG lane, and the device, sleep/wake and exit
lifecycle rules — is canon [`macos`](../../../shared/packs/macos/RULES.md), which
this repo declares. This repo is where most of it was distilled from; what stayed
here is what is genuinely about this app.

Local pack, declared by hand as `local/laugh-counter` (no fingerprint). Not
versioned and not distributed — the commit and its PR are its record.

| Rule | How enforced |
| --- | --- |
| No outbound client in capture path | `no-network-client` check (`mac/Sources/**.swift`) |
| No telemetry/analytics/crash-reporting SDK imported | `no-telemetry-sdk` check (`mac/Sources/**.swift`) |
| Speech recognition on-device | `on-device-speech` check (`SFSpeechAudioBufferRecognitionRequest`) |
| Metadata persists, audio doesn't | `no-audio-persistence` check (`AVAudioFile`/`AVAudioRecorder`/`ExtAudioFileCreateWithURL`/`AudioFileCreateWithURL`) |
| One deletable directory | `single-storage-directory` check (only `.applicationSupportDirectory` as a search-path root) |
| No server / listener | `no-listener` check (`NWListener`/`NSXPCListener`/`CFSocket*`/`SocketPort`/`socket(2)`/an embedded HTTP-server import) |
| No egress at all | `RULES.md` prose |
| Usage strings stay true | `RULES.md` prose |
| Only `AudioHub` builds an `AVAudioEngine` | `engine-construction-confined` check (`mac/Sources/**.swift`) |
| Only `AudioHub` touches `engine.inputNode` | `input-node-confined` check (`mac/Sources/**.swift`) |
| Read the case history before touching the audio lifecycle | `RULES.md` prose |
| Menu state comes from measured health; no-signal names the one remedy | `RULES.md` prose |
| HAL reads live in the app, not a helper script | `RULES.md` prose |
| This app's restart latches reset together | `RULES.md` prose |
| Ship a stateable version + build number, and bump it per distinguishable build | `RULES.md` prose |
| Never hand-write a second `v<version> (<build>)` literal outside `AppDelegate` | `single-version-source` check (`mac/Sources/**.swift`) |
| Nothing runs on `pull_request` — the auto-merge arm is always rejected | `RULES.md` prose |
| A text-matching check hits the comment documenting the idiom it bans | `RULES.md` prose |
| Every scheduled session sees a webhook echo of its own label swap | `RULES.md` prose |
| `verify-outcome.mjs` is a module export, not a CLI | `RULES.md` prose |
| A pasted command block carries no trailing `#` comment | `RULES.md` prose |

The audio narrative — which release, which measurement, which theory survived —
stays in [`dev/procedures/mac-audio-lifecycle.md`](../../../../dev/procedures/mac-audio-lifecycle.md)
rather than being copied here; `RULES.md` points at it.

Fixtures: `pack.test.mjs` —
`node --test .claudinite/local/packs/laugh-counter/pack.test.mjs`. Each check has
a violating fixture it fires on and the repo's real files it stays quiet on. They
sit in the pack, not alongside the app sources (`claudinite-isolation`).
