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

**That licensed hand-merge comes back as a `[Merge Without Review]` security
warning — expect it, and hand the reader the three facts that settle it.** When a
scheduled task squash-merges its own PR after the arm is rejected `clean status`,
the harness prefixes the subagent's completion notification to the executor with
*"SECURITY WARNING … [Merge Without Review] … relying only on its own project-doc
citation rather than actual user authorization."* Because nothing here triggers on
`pull_request`, every arm is rejected and every `merged-pr` task ends this way, so
the warning is **structural** — it arrives on every run that lands anything, and it
is silent about whether this particular merge was licensed. Treating it as either a
verdict or a rubber stamp is the mistake. Settle it in one read: the delivering
agent states the three licensing facts up front in its final report — this repo's
`maintenance.delivery` value, the arm rejection verbatim, and the dispatch's
declared outcome ceiling — and whoever reads the warning checks those three instead
of re-deriving the license from scratch (the 2026-08-08 run's executor spent five
extra tool calls re-reading `deliver-pr.md`, the PR and `verify-outcome.mjs` to get
back to the same answer). What it must never do is make a run *reverse* a merge
decision it already reasoned through — that failure has its own cost here, and its
name is #138. (#143/#144)

**Nothing you post to GitHub can be edited afterwards — resolve every value before
the comment goes up.** The MCP GitHub toolset these runs use has
`add_issue_comment` and **no comment-update tool at all**, so a comment that goes
out wrong can only be appended to. A run claiming issue #143 wrote the placeholder
`2026-08-08T00:00:00Z` into its claim comment meaning to correct it after, found no
edit tool, and left the issue permanently carrying both the wrong timestamp and a
"Correction:" comment under it. An agent session has no ambient clock — `date -u
+"%Y-%m-%dT%H:%M:%SZ"` is one Bash call and the only thing that makes a timestamp
true — and the same holds for every PR number, sha and label a comment asserts:
resolve it, then post. (#143)

**A text-matching check fires on the comment that documents the very idiom it
bans — strip comments before matching, in both directions, and prove it against
the real tree.** The first draft of `macos-audio/swift-toolchain-gate` (a check
that a `command -v swift` probe must sit behind an `xcode-select -p` gate)
flagged `mac/scripts/diagnose-mic.sh:175` — a `#` comment that exists purely to
warn the next reader that `command -v swift` is not a usable test. This is not
bad luck, it is the arithmetic of this repo's own placement rule: a trap gets
written down as a comment beside the call it applies to, so the closer a gotcha
comment sits to the code, the more certainly a grep for that gotcha lands on the
warning instead of the offence. Strip comments before matching — and strip them
in the *other* direction too, since a commented-out gate is not a gate and must
not count as one. What caught it was the fixture asserting the check is silent
on the repo's **real** sources; a synthetic clean fixture would have passed and
the false positive would have shipped, so every new check gets a real-tree case
alongside its red-first one. (#152/#159)

**Every scheduled session here takes two hits the executor doc doesn't mention —
expect both and spend nothing re-deriving them.** All six of 2026-08-09's
scheduled sessions hit both, and each paid a few tool calls working out what had
happened. First, the Stop hook's **blocking `comment-classification` finding**:
the scheduler's own dispatch prompt (*"Execute the Claudinite executor: …"*) is
an owner comment as far as that check is concerned, so a session that never
declares a class has its first Stop blocked every single time. Emit `Comment
class: other` in the first substantive reply — a scheduler dispatch is a command
phrase, which is exactly what `other` covers — and the Stop passes. Second, a
**second `<github-trigger-context>` for the same issue arrives mid-run**: it is
the webhook echo of your own `ready-for-agent` → `agent-running` swap, since a
label change is itself a labeling event. It is not a new dispatch and not a
competing claim — `resolve-dispatch.mjs` answers `exit 11 / not-mine` precisely
because *you* are the claimant — so change nothing, comment nothing, do not
re-dispatch, and do not read it as a lease you lost. (#149/#150/#151/#152/#154/#155)

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
