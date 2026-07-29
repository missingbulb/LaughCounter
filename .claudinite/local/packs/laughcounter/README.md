# laughcounter

The repo's **general** local pack — the working lessons about LaughCounter that aren't about the
on-device-privacy boundary. That boundary is the product's defining constraint and keeps its own
pack (`local/on-device-privacy`, checks included); this one is where everything else lands so it
doesn't get filed under privacy for want of a home.

Local pack, declared by hand as `local/laughcounter` (no fingerprint), named for the repo the way
the canon home repo's own pack is named for it.

| Rule | How enforced |
| --- | --- |
| Don't prune `.gitignore` while its artifacts are still in the worktree | `RULES.md` prose |

Prose-only so far. The promotion ladder still applies: anything deterministic enough to decide
mechanically becomes a check in `pack.mjs`'s `rules` (with a red-first fixture in a `pack.test.mjs`
alongside), and only what a check can't carry stays as prose here.
