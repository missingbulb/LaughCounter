# on-device-privacy

LaughCounter's defining constraint as a local pack: an always-on living-room microphone whose audio
never leaves the machine. Distilled from this repo's own sources and requirements
(`docs/DESIGN-AND-TRADEOFFS.md` §0/§6, the README *Privacy* section, `laughcounter/`,
`mac/Sources/LaughCounter/`) — the promise was stated in three docs and enforced nowhere.

Local pack, declared by hand as `local/on-device-privacy` (no fingerprint). It spans both
implementations, because the boundary is the same on either side of them.

| Rule | How enforced |
| --- | --- |
| No outbound client in capture path | `no-network-client` check (`laughcounter/**.py`, `mac/Sources/**.swift`) |
| Dashboard binds loopback | `loopback-default` check (host defaults in `laughcounter/`) |
| Speech recognition on-device | `on-device-speech` check (`SFSpeechAudioBufferRecognitionRequest`) |
| Metadata persists, audio doesn't | `RULES.md` prose |
| One deletable home directory | `RULES.md` prose |
| Model download is the only egress | `RULES.md` prose |
| Usage strings stay true | `RULES.md` prose |

Fixtures: `pack.test.mjs` — `node --test .claudinite/local/packs/on-device-privacy/pack.test.mjs`.
Each check has a violating fixture it fires on and the repo's real files it stays quiet on. They sit
in the pack, not in `tests/`, because a consumer file may not reference into `.claudinite/`
(the `claudinite-isolation` barrier).
