# Working in this repo

The general lessons this repo has paid for once. The privacy boundary — the
product's defining constraint — has its own pack (`local/on-device-privacy`);
what follows is everything else.

**Ship a version the running app can state, and bump it whenever a build has to be
told apart from the last one.** Diagnosing the `installTap` crash (#61) stalled on
"which binary is installed?", and the answer had to be reconstructed by grepping a
crash report's symbol names for whether `finishListening` took a `generation:`
argument. Two causes, both durable. The menu header said only "LaughCounter"; and
several genuinely different builds all reported `0.2.1`, because the release
workflow keys its Release on `v<version>` read from `mac/Resources/Info.plist` — so
a merge that leaves `CFBundleShortVersionString` alone **refreshes the same
Release**, and the DMG behind the `latest/download` link changes identity without
changing its name. So the menu renders `LaughCounter v<version> (<build>)` from
`Bundle.main` rather than a constant in the source — `Info.plist` is already where
the version lives and where the release tag comes from, and a second copy could
disagree with the DMG it shipped in — and the **build number** is what separates
two builds that share a version string, so show it and raise it too. (#74/#75)

**Nothing in this repo runs on `pull_request`, so most PRs carry no checks at all
— and arming auto-merge on one is rejected every time.** `build-macos-dmg.yml`
and `release-macos-dmg.yml` trigger on `push` scoped to `mac/**` (plus their own
file), and `claudinite-scheduler.yml` only on `schedule`/`workflow_dispatch`; no
workflow here declares a `pull_request` trigger. A PR touching only
`.claudinite/`, `docs/` or `dev/` therefore starts nothing, is mergeable the
second it opens, and GitHub answers the auto-merge arm with *"already in clean
status — auto-merge only applies when checks are pending."* That is the repo's
shape, not a fault. PR #138 sat unmerged for a day because a run read its task
file's blanket "never hand-merge" as covering the rejection too. Two
corollaries. The maintenance PRs the Action opens land **within seconds** of
being armed, so by the time the agent stage starts there is usually no open
`claudinite/maintenance-*` PR left to
continue on and the condition that escalated no longer reproduces — three cycles
running (#127/#128, #129/#130, #133/#134) spent their budget hunting the PR API
for a branch that had already merged, when the first move is to fetch `main` and
re-run the check against it. And "CI will catch it" is simply false outside
`mac/**`: nothing runs, so whatever a change needed proving, prove it locally
before it lands. (#137/#138)

**This repo's own placement convention is what makes a text-matching check
especially likely to flag the comment that documents the very idiom it bans.**
A trap gets written down as a comment beside the call it applies to, so the
closer a gotcha comment sits to the code, the more certainly a grep for that
gotcha lands on the warning instead of the offence — the first draft of
`macos-audio/swift-toolchain-gate` flagged `mac/scripts/diagnose-mic.sh:175`, a
`#` comment that exists purely to warn the next reader that `command -v swift`
is not a usable test. (#152/#159)

**Every scheduled session here takes a hit the executor doc doesn't mention —
expect it and spend nothing re-deriving it.** All six of 2026-08-09's scheduled
sessions hit it: a second `<github-trigger-context>` for the same issue arrives
mid-run. It is the webhook echo of your own `ready-for-agent` → `agent-running`
swap, since a label change is itself a labeling event. It is not a new dispatch
and not a competing claim — `resolve-dispatch.mjs` answers `exit 11 / not-mine`
precisely because *you* are the claimant — so change nothing, comment nothing,
do not re-dispatch, and do not read it as a lease you lost. (#149/#150/#151/#152/#154/#155)

**`verify-outcome.mjs` is a plain ESM module export (`verifyOutcome()`), not a
CLI — `--help` returns nothing.** `executor.md` gives `record-exec.mjs` an
explicit invocation snippet but never shows one for `verify-outcome.mjs`, so a
session reaches for `--help` or writes a scratchpad file to probe it first.
The `<engine>/scheduler/` prefix those snippets use is itself stale — the
vendored engine carries no `scheduler/` directory — so call it by its real
path directly: `node -e "import('./.claudinite/shared/packs/claudinite-tasks/verify-outcome.mjs')
  .then(m => console.log(JSON.stringify(m.verifyOutcome({outcome, openedPr, mergedPr}))))"`. (#185)
