# on-device-privacy

LaughCounter's defining constraint as a local pack: an always-on living-room microphone whose audio
never leaves the machine. Distilled from this repo's own sources and requirements
(`docs/DESIGN-AND-TRADEOFFS.md` §0/§6, the README *Privacy* section,
`mac/Sources/LaughCounter/`) — the promise was stated in three docs and enforced nowhere.

Local pack, declared by hand as `local/on-device-privacy` (no fingerprint). It covers the native
app, which since the Python reference was removed is the only implementation.

| Rule | How enforced |
| --- | --- |
| No outbound client in capture path | `no-network-client` check (`mac/Sources/**.swift`) |
| Speech recognition on-device | `on-device-speech` check (`SFSpeechAudioBufferRecognitionRequest`) |
| Metadata persists, audio doesn't | `RULES.md` prose |
| One deletable directory | `RULES.md` prose |
| No egress at all | `RULES.md` prose |
| No server / listener | `RULES.md` prose |
| Usage strings stay true | `RULES.md` prose |

Fixtures: `pack.test.mjs` — `node --test .claudinite/local/packs/on-device-privacy/pack.test.mjs`.
Each check has a violating fixture it fires on and the repo's real files it stays quiet on. They sit
in the pack, not alongside the app sources, because a consumer file may not reference into
`.claudinite/` (the `claudinite-isolation` barrier).
