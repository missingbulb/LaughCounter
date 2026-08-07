# macos-audio

Holding a macOS microphone without damaging it. LaughCounter keeps an
`AVAudioEngine` input tap open for hours, and has repeatedly left a USB webcam mic
**wedged** — dead system-wide, no input meter anywhere, until physically
re-plugged. The rules distilled here come from that: `mac/Sources/LaughCounter/`
(`AudioHub`, `AudioDiagnostics`, `AppDelegate`'s restart machinery, `main.swift`),
`mac/Resources/Info.plist`, and the case history in
[`dev/procedures/mac-audio-lifecycle.md`](../../../../dev/procedures/mac-audio-lifecycle.md).

A distinct technology domain — CoreAudio/AVFoundation device lifecycle — that no
canon pack homes, and that the repo's other local packs deliberately don't own:
`local/on-device-privacy` owns the privacy boundary, `local/laughcounter` the
repo's general build/packaging and check-authoring lessons.

Local pack, declared by hand as `local/macos-audio` (no fingerprint).

| Rule | How enforced |
| --- | --- |
| Only `AudioHub` builds an `AVAudioEngine` | `engine-construction-confined` check (`mac/Sources/**.swift`) |
| Termination signals reach `applicationWillTerminate`, `SIG_IGN` before `resume()` | `signal-teardown-routing` check (`mac/Sources/**.swift`) |
| Never opt into sudden termination | `no-sudden-termination` check (`mac/Resources/*.plist`) |
| Never open the device to ask a question about it | `RULES.md` prose |
| Presence is not usability, at any layer | `RULES.md` prose |
| A duration is only as good as the observation behind it | `RULES.md` prose |
| Pick the clock by whether the span may contain a sleep | `RULES.md` prose |
| Deferred work must be generation-guarded | `RULES.md` prose |
| Never claim "listening" on `engine.start()` returning | `RULES.md` prose |
| Compile-green is not a gate for this code | `RULES.md` prose |
| Assume no toolchain on the machine that runs it | `RULES.md` prose |

The narrative — which release, which measurement, which theory survived — stays in
`dev/procedures/mac-audio-lifecycle.md` rather than being copied here; `RULES.md`
carries the invariants and points at it.

Fixtures: `pack.test.mjs` —
`node --test .claudinite/local/packs/macos-audio/pack.test.mjs`. Each
check has a violating fixture it fires on and the repo's real files it stays quiet
on. They sit in the pack, not alongside the app sources (`claudinite-isolation`).
