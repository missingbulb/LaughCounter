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
