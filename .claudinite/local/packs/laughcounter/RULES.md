# Working in this repo

The general lessons this repo has paid for once. The privacy boundary — the
product's defining constraint — has its own pack (`local/on-device-privacy`);
what follows is everything else.

**Ship a version the running app can state, and bump it whenever a build has to be
told apart from the last one.** The menu renders `LaughCounter v<version> (<build>)`
from `Bundle.main` rather than a constant in the source — `Info.plist` is already
where the version lives and where the release tag comes from, and a second copy
could disagree with the DMG it shipped in — and the **build number** is what
separates two builds that share a version string, so show it and raise it too. (1)

**Nothing in this repo runs on `pull_request`, so most PRs carry no checks at all
— and arming auto-merge on one is rejected every time.** `build-macos-dmg.yml`
and `release-macos-dmg.yml` trigger on `push` scoped to `mac/**` (plus their own
file), and `claudinite-scheduler.yml` only on `schedule`/`workflow_dispatch`; no
workflow here declares a `pull_request` trigger. A PR touching only
`.claudinite/`, `docs/` or `dev/` therefore starts nothing, is mergeable the
second it opens, and GitHub answers the auto-merge arm with *"already in clean
status — auto-merge only applies when checks are pending."* That is the repo's
shape, not a fault. Two corollaries: the maintenance PRs the Action opens land
**within seconds** of being armed, so by the time the agent stage starts there
is usually no open `claudinite/maintenance-*` PR left to continue on — the
first move is to fetch `main` and re-run the check against it. And "CI will
catch it" is simply false outside `mac/**`: nothing runs, so whatever a change
needed proving, prove it locally before it lands. (2)

**This repo's own placement convention is what makes a text-matching check
especially likely to flag the comment that documents the very idiom it bans.**
A trap gets written down as a comment beside the call it applies to, so the
closer a gotcha comment sits to the code, the more certainly a grep for that
gotcha lands on the warning instead of the offence. (3)

**Every scheduled session here takes a hit the executor doc doesn't mention —
expect it and spend nothing re-deriving it.** A second `<github-trigger-context>`
for the same issue arrives mid-run. It is the webhook echo of your own
`ready-for-agent` → `agent-running` swap, since a label change is itself a
labeling event. It is not a new dispatch and not a competing claim —
`resolve-dispatch.mjs` answers `exit 11 / not-mine` precisely because *you* are
the claimant — so change nothing, comment nothing, do not re-dispatch, and do
not read it as a lease you lost. (4)

**`verify-outcome.mjs` is a plain ESM module export (`verifyOutcome()`), not a
CLI — `--help` returns nothing.** `executor.md` gives `record-exec.mjs` an
explicit invocation snippet but never shows one for `verify-outcome.mjs`. The
`<engine>/scheduler/` prefix those snippets use is itself stale — the
vendored engine carries no `scheduler/` directory — so call it by its real
path directly: `node -e "import('./.claudinite/shared/packs/claudinite-tasks/verify-outcome.mjs')
  .then(m => console.log(JSON.stringify(m.verifyOutcome({outcome, openedPr, mergedPr}))))"`. (5)

**A command block handed to the owner to paste straight into an interactive terminal
must carry no trailing `# comment`.** Interactive zsh — the owner's default shell —
only treats `#` as a comment start under `setopt interactive_comments`, which is off
by default, unlike a script file. Put the explanation in prose around the block
instead of inline. (6)
