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
