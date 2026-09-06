# macos

Native macOS app development: assembling the app bundle, the TCC / Hardened Runtime pair, the
Developer ID → notarization → DMG lane, and the process-lifecycle facts a Mac app cannot get wrong.

Sibling packs on the same axis: `ios` (iPhone targets), `app-store-release` (the Mac/iOS App Store
lane, which this pack's Developer ID track deliberately is not), `git-github` (workflow YAML
mechanics for the CI that runs the lane).

## Rules (`RULES.md`)

| Rule | Severity | Reason | Enforcement |
|---|---|---|---|
| SwiftPM builds a binary, not a .app | high | correctness | prose: 49 words |
| Commit an icon master, generate .icns | low | complexity | prose: 44 words |
| Notarization requires the Hardened Runtime | critical | legal | prose: 64 words |
| SFSpeechRecognizer streams to Apple by default | critical | legal | prose: 70 words |
| On-device opt-in needs the locale's model | high | correctness | prose: 72 words |
| The unsigned path stays a working path | medium | complexity | prose: 57 words |
| An ad-hoc signature cannot be notarized. | high | legal | prose: 40 words |
| Notarize the distributed container, then staple it | high | legal | prose: 41 words |
| A CI identity joins the searchable keychain | medium | correctness | prose: 53 words |
| Annotate which signing lane ran | medium | complexity | prose: 27 words |
| A drag-install DMG is a staged folder | medium | complexity | prose: 55 words |
| Write the Gatekeeper bypass users actually have | medium | correctness | prose: 51 words |
| Diagnostics belong inside the shipped app | medium | complexity | prose: 33 words |
| NSApplication installs no signal handlers | high | correctness | prose: 50 words + check (`signal-teardown-routing`) |
| An uncaught Objective-C exception is an exit | high | correctness | prose: 63 words |
| There is no wake notification | high | correctness | prose: 57 words |
| Coalesce with an id, not a boolean. | high | correctness | prose: 50 words |
| asyncAfter fires immediately on wake | high | correctness | prose: 65 words |
| Measure a span across sleep with Date() | high | correctness | prose: 45 words |
| Release the device on every capture path | critical | correctness | prose: 52 words |
| Never build an engine to probe devices | high | correctness | prose: 104 words |
| Presence is not usability, at either layer. | high | correctness | prose: 121 words |
| A duration claims a span you observed | high | correctness | prose: 119 words |
| "Started" is not "working". | high | correctness | prose: 50 words |
| Compile-green is no gate for device code | high | correctness | prose: 81 words |

The bundle keys and the TCC/entitlement pair are skills the guard forces for the files they
govern (`Info.plist`, `Package.swift`, `*.entitlements`): [`macos-app-bundle`](skills/macos-app-bundle/SKILL.md)
and [`macos-entitlements-and-tcc`](skills/macos-entitlements-and-tcc/SKILL.md). A notarized build
should need no Gatekeeper bypass at all — a README whose manual-bypass section is the one users
actually follow is the sign the signing lane isn't running.

## Skills

| Skill | Trigger |
|---|---|
| [`macos-app-bundle`](skills/macos-app-bundle/SKILL.md) | any edit of `Info.plist` or `Package.swift` — held by the guard until loaded |
| [`macos-entitlements-and-tcc`](skills/macos-entitlements-and-tcc/SKILL.md) | any edit of an `.entitlements` file or `Info.plist` — held by the guard until loaded |

## Checks

| Check | Severity | Reason | Enforcement |
|---|---|---|---|
| `sudden-termination-vs-teardown` | high | correctness | check: blocking |
| `signal-teardown-routing` | high | correctness | check: blocking |
| `minimum-system-version-agrees` | high | correctness | check: blocking |
| `swift-toolchain-gate` | high | correctness | check: blocking |

Four checks, each on a rule whose static signature is false-positive-free *because the rule is
itself conditional*: each fires only where the tree already shows the posture the rule is about —
terminate-time teardown, an AppKit app that installs a capture tap, or a plist and a package
manifest that both state an OS floor. The rest stays prose: runtime device behaviour, a CI lane's
shape, or a plist/entitlement judgment call, none of which a scan can tell apart from a healthy
repo. The `Package.swift` fingerprint only **suspects** the pack — a Swift package can be a
library or an iOS-only target, so declaration stays the project's call.

**Provenance.** Distilled from `missingbulb/LaughCounter` — a SwiftPM menu-bar agent app published
as a notarized DMG through GitHub Actions, whose `mac/scripts/`, `mac/Resources/`, release workflow
and `dev/procedures/mac-audio-lifecycle.md` are the evidence behind every rule above. The
device-lifecycle detail, the two checks and the on-device-speech section come from that project's
own local packs (`macos-audio`, `on-device-privacy`), which held them as portable macOS knowledge
before this pack existed; what stays local there is what is genuinely about *that app* — which of
its types owns the engine, where its files live, and its no-egress product promise.
