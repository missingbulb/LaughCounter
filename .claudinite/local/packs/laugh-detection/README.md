# laugh-detection

The decision layer between Apple's built-in sound classifier and a number on the
menu bar. The model is a **black box** — it cannot be retrained, so everything that
makes the count right or wrong lives after it: the thresholds and the hysteresis
that turn overlapping analysis windows into one laugh, the class-identifier
matching, where an episode's timing comes from, the you-vs-TV attribution, and the
shape of the laugh log. Distilled from `mac/Sources/LaughCounter/`
(`LaughCounter.swift`, `LaughDetector.swift`, `Store.swift`),
`docs/DESIGN-AND-TRADEOFFS.md` §2/§3, the README's *How it works*, and issues
#5 (log overhaul, real durations) and #7 (TV de-confliction).

A distinct domain that no canon pack homes, and that the repo's other local packs
deliberately don't own: `local/macos-audio` owns getting audio out of the device,
`local/on-device-privacy` the boundary that audio never crosses, and
`local/laughcounter` the repo's build, packaging and check-authoring lessons.

Local pack, declared by hand as `local/laugh-detection` (no fingerprint).

| Rule | How enforced |
| --- | --- |
| The counting core reads no clock and imports no capture framework | `counting-core-clock-free` check (`LaughCounter.swift`) |
| Sound-class keywords are lowercase stems | `classifier-keywords-lowercase` check (`mac/Sources/**.swift`) |
| `exit < enter <= count`, and `mergeGap` beats the window hop | `hysteresis-contract` check (`LaughCounter.swift`) |
| Improve the decision, not the call into the model | `RULES.md` prose |
| Match sound classes as stems, never whole words | `RULES.md` prose |
| An episode is a laugh; a window is not | `RULES.md` prose |
| Never drop a sub-threshold episode — log it as a candidate | `RULES.md` prose |
| Attribution labels an event, it never suppresses one | `RULES.md` prose |
| The laugh log is a fixed-order, hand-rendered JSONL record | `RULES.md` prose |

Fixtures: `pack.test.mjs` —
`node --test .claudinite/local/packs/laugh-detection/pack.test.mjs`. Each check has
a violating fixture it fires on and the repo's real files it stays quiet on. They
sit in the pack, not alongside the app sources (`claudinite-isolation`).
