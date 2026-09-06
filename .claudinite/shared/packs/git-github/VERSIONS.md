# Version history

Records for `packs/git-github/pack.mjs`'s `version` field, one row per version, newest first.
A version is cut on `main` after its changes land, so a row names the pull requests that
landed between the previous version and this one; the weekly history task writes the rows
a version is missing and leaves every row that already stands.

| Version | Date | What changed |
|---|---|---|
| 60906.1 | 2026-09-06 | Declared checks at every moment: schema rung, work and action scopes, skill triggers, and the creation path (#1711) |
| 60903.1 | 2026-09-03 | A skill's `SKILL.md` opens on what to do, not on what the skill is: the self-describing framing and the pointers to prose the reader already holds are gone. |
| 60902.1 | 2026-09-02 | Eight of the `gha/*` checks scan `packs/<pack>/stubs/workflows/` as well as `.github/workflows/`. A stub is copied verbatim into every adopting repo, so a defect there shipped fleet-wide while being visible in no repo until after seeding — which is how `claudinite-dashboard`'s Pages stub carried a piped `run:` with no bash default until a member re-seeded it. `gha/no-scheduled-fleet-executor` and `gha/scheduled-failure-escalation` stay repo-only: each asserts a fact about an adopting repo rather than about the file (#1596). |
| 60901.1 | 2026-09-01 | Adds `references.md`: the four workflow checks #552 converted out of `git-github-advanced` now record the GitHub behaviour each encodes and what would retire it, and `merge-to-main` records why the capture step runs in-session (#1576). |
| 60822.2 | 2026-08-22 | The manifest stops restating its own tree (#1246): `id`, `prose`, `badge`, `skills`, `worldRules` and `workRules` are resolved from the pack directory and an absent `detect`/`marker` means no fingerprint. Coded rules move into `worldRules/`/`workRules/` and tests into `test/`, which no vendor set ships. `minEngineVersion` rises to the engine release that reads all of it. |
| 60822.1 | — | Contributes the repo's stars to the dashboard (#1194) — `dashboard.json`, a descriptor and no code, off the `repo-stars` source the page already reads. A member declaring this pack shows a star count on both dashboard pages; one that does not, no longer shows one anywhere, since the dashboard stopped drawing it itself. |
| 60821.1 | 2026-08-21 | This pack's inline version-history comments moved out of `pack.mjs` into this file. |
| 60820.2 | — | Merge-to-main step 7 is named as verify-in-production's only trigger (#1128). |
| 60820.1 | 2026-08-20 | Engine and pack versions become date-anchored `<day>.<n>` (#1105) |
| 8 | 2026-08-20 | The tick becomes the scheduler run, and the janitor stops parking finished work (#1108) |
| 7 | 2026-08-20 | basics: a change proven only in production files its own verification (#1092) |
| 6 | — | The github-actions pack is absorbed here — its skill, its nine `gha/` checks, and the routing that used to name it as the neighbour. |
| 5 | 2026-08-19 | Collapse chrome-extension-release into chrome-extension, and stop packs discussing each other (#1060) |
| 4 | 2026-08-19 | Rename core → claudinite-lifecycle, grow_with_claudinite → claudinite-growth, and move the scheduled-task contract between them (#1029) |
| 3 | 2026-08-18 | Promote 4 lessons from EdFringeNow and TLDR (#985) |
| 2 | 2026-08-18 | Promote eleven fleet lessons into the canon (#853); Growth promote: 20 lessons from 8 members' local packs (#949); Bump every pack whose content was edited without a version bump (#969) |
| 1 | 2026-08-12 | Vendored-mount surface shrink: engine/ consolidation, skills into packs, no CI stub, minimal CLAUDE.md + .gitignore (#384); Phase 4 step 2: retire run_daily/ and delete the central fleet routine (#473); Growth: promote 5 lessons from the fleet's local packs (#497); Pack badges: a mark per pack, and a README row bootstrap and baselining maintain (#525); Growth promote: 10 lessons from 7 members into the canon (#541); prose-to-checks: add the deletion test and sweep the canon with it (#552); Pack manifest as the single source: routing guidance, skills, scoped rules (#555); Growth extract: one task over both sources, driven by skills; prose-to-checks sweep goes weekly (#622); Move engineering-practices from a skill into basics/RULES.md (#661); baselining: land this cycle's PR when the arm could not — and the rule that says why (#669); growth-promote: dedupe PR #740's rule additions and cut the language (#751); Versioned updates Phase 0: version scaffolding (#769) |
