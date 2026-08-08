# Working in this repo

The general lessons this repo has paid for once. The privacy boundary — the
product's defining constraint — has its own pack (`local/on-device-privacy`);
what follows is everything else.

**Don't prune a `.gitignore` section in the same breath as deleting what it
ignored — the artifacts are still on disk.** Removing a toolchain (the Python
reference, a build system, a generator) invites tidying its ignore rules away in
the same commit, but the ignored artifacts it already produced are usually still
sitting untracked in the worktree — earlier test runs leave `__pycache__/`,
builds leave `build/`. The moment those rules go, the next `git add -A` sweeps
the artifacts *into* the very commit that was supposed to remove them, and
nothing complains: the commit is valid, the tests still pass, and the junk only
shows up as an inflated file count in the diff a reviewer reads. Delete the
artifacts from the worktree first (or `git clean` them), then drop their ignore
lines — and read `git diff --cached --stat` after any bulk `git add -A`, not just
`git status`, since staged additions are exactly what a clean `git status` stops
telling you about.

**"Not statically checkable" is a verdict about the tree's shape at the time, not
about the rule — re-ask it after the tree changes.** `on-device-privacy`'s
"everything lives in one deletable directory" sat as prose because proving it
looked like it needed data-flow tracking of a `FileManager` write target back to
its declaration — true while the Python reference had many entry points, and
false the moment that tree went away: the native app has exactly two persistent
path roots, both the same search-path lookup, so constraining the *root*
constrains every path derived from it and no tracing is needed. A removal, a
migration, or a consolidation can collapse the entry points a rule has to cover,
so when a sweep meets prose a previous sweep left behind, re-derive the objection
against today's sources instead of trusting the recorded verdict.

**"Already covered by another check" is a claim to test, not to reason out — hand
the sibling check a violating file before dropping a rule as a duplicate.** Three
sweeps in a row left `on-device-privacy`'s "the app listens on no socket" as
prose, each reasoning that an `NWListener` needs `import Network` and
`no-network-client` already bans that. True of that one API, false of the
capability: `socket(2)` comes free with `import Foundation` (Darwin is
re-exported), `NSXPCListener`/`CFSocket*`/`NSSocketPort` are Foundation types, and
an embedded HTTP server arrives as its own import — a file whose entire content
was `let fd = socket(AF_INET, SOCK_STREAM, 0)` passed `check_the_world`
untouched. A ban list only covers the routes whoever wrote it thought of, so the
routes it misses are invisible to exactly the reasoning that drew it; running it
against a file that breaks the rule costs a minute and is the only step that can
disagree with you.

**Write a check as a positive whitelist over an enumerated API surface, not as a
list of the bad cases.** `single-storage-directory` flags any search-path lookup
whose directory argument is not the literal `.applicationSupportDirectory`,
rather than enumerating the directories we don't want. Matching the allowed case
buys two things a ban list can't: a `SearchPathDirectory` case that doesn't exist
yet is caught the day it lands, and a non-literal argument (`urls(for: dir, in:)`)
becomes a finding too — indirection is precisely what would otherwise defeat the
check, so refusing to reason about it is a feature. Only invert this where the
allowed set is genuinely open-ended.

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

**A scheduled job that *skips* its work still exits 0 — read what a green run says
it did.** This repo's Claudinite scheduler ran green every night while silently
skipping baselining, logging "no vendored mount (no stamp)" about a repo whose
`.claudinite-checks.json` carried one: the vendored `loadConfig` validated
`claudinite` as a legal settings key and then dropped it from the object it
returned, so the stamp read `undefined` and the run took the branch meant for a
pre-adoption repo. Nothing was red and nothing was missing — the only evidence was
one skip line in a log nobody opens on a green run. Two things follow. A *skip* is
a finding to read, not a pass: a job whose success and whose no-op look identical
from outside is telling you nothing. And when the bug lives inside the mechanism
that updates itself, the ordinary route is unreachable — baselining is what
refreshes the vendored mount, and the bug was *in* the mount — so the fix has to be
pushed in out of band rather than waited for. (#56)

**Nothing in this repo runs on `pull_request`, so most PRs carry no checks at all
— and arming auto-merge on one is rejected every time.** `build-macos-dmg.yml`
and `release-macos-dmg.yml` trigger on `push` scoped to `mac/**` (plus their own
file), and `claudinite-scheduler.yml` only on `schedule`/`workflow_dispatch`; no
workflow here declares a `pull_request` trigger. A PR touching only
`.claudinite/`, `docs/` or `dev/` therefore starts nothing, is mergeable the
second it opens, and GitHub answers the auto-merge arm with *"already in clean
status — auto-merge only applies when checks are pending."* That is the repo's
shape, not a fault, and the canon's delivery procedure already licenses the
squash merge yourself in exactly that case — take it rather than escalating: PR
#138 sat unmerged for a day because a run read its task file's blanket "never
hand-merge" as covering the rejection too. Two corollaries. The maintenance PRs
the Action opens land **within seconds** of being armed, so by the time the agent
stage starts there is usually no open `claudinite/maintenance-*` PR left to
continue on and the condition that escalated no longer reproduces — three cycles
running (#127/#128, #129/#130, #133/#134) spent their budget hunting the PR API
for a branch that had already merged, when the first move is to fetch `main` and
re-run the check against it. And "CI will catch it" is simply false outside
`mac/**`: nothing runs, so whatever a change needed proving, prove it locally
before it lands. (#137/#138)

**When a conformance check flags text, ask what a reader could act on before
reaching for an `accept`.** `claudinite-isolation` fired on `CLAUDE.md`'s
orientation header for spelling the vendored mount path. Nothing in that header
told a reader to go open the directory, so the path was pure decoration that
coupled a consumer file to a canon-internal layout — exactly the crossing the rule
exists to prevent, bought for nothing. Rewording to "vendored into this repo and
injected at session start" kept both facts a reader needs and lost only the
coupling. An `accept` entry is for a crossing that *must* exist; every one in this
repo's `.claudinite-checks.json` names a real constraint (a framework-fixed method
name, a deliberate broad-except, an optional-dependency availability probe). So
before adding one, delete the part the check is pointing at and see whether
anything actionable went with it — often nothing does. (#34)
