# Version history

Records for `packs/claude-code-web-users-support/pack.mjs`'s `version` field, one row per version, newest first.
A version is cut on `main` after its changes land, so a row names the pull requests that
landed between the previous version and this one; the weekly history task writes the rows
a version is missing and leaves every row that already stands.

| Version | Date | What changed |
|---|---|---|
| 60902.1 | 2026-09-02 | `RULES.md` carries only the three rules that instruct a session; everything descriptive — what the pack is, the address-not-content design, fail-soft, local-first, the store's flatness — moves to the pack README and the module headers that own it. |
| 60823.1 | 2026-08-23 | Reads the pack entry from either settings-file name while the #1252 rename drains; the environment setup script finds a repo root by either. |
| 60822.1 | 2026-08-22 | The manifest stops restating its own tree (#1246): `id`, `prose`, `badge`, `skills`, `worldRules` and `workRules` are resolved from the pack directory and an absent `detect`/`marker` means no fingerprint. Coded rules move into `worldRules/`/`workRules/` and tests into `test/`, which no vendor set ships. `minEngineVersion` rises to the engine release that reads all of it. |
| 60821.2 | 2026-08-21 | Strip the web setup script's comments, quote its body into the handover issue (#1185) |
| 60821.1 | 2026-08-21 | Bootstrap: the executor routine is the session's work, and the human steps get an issue (#1168) |
| 60820.1 | 2026-08-20 | Engine and pack versions become date-anchored `<day>.<n>` (#1105) |
| 3 | 2026-08-20 | Pack reorganization: two collapses and two renames (#1081) |
| 2 | 2026-08-18 | Versioned updates Phase 1: version-gate migration fetching and tolerance (#778); Converge before reporting at session start, and weigh preferences in tokens (#878); Index every pack's rules and checks with words, severity and reason (#915); Point every live Sheepdog-repo reference at Shepherd (#957); Move the environment setup script into the web pack, and converge the clone's git config at session start (#956); Bump every pack whose content was edited without a version bump (#969) |
| 1 | 2026-08-12 | Personal preferences as a pack, and one general primitive: a pack's own session-start step (#567); Promote two store/seed checks from Sheepdog PR #110 to the canon (#755); Session start: state what loaded, in one line, every session (#771); Versioned updates Phase 0: version scaffolding (#769) |
