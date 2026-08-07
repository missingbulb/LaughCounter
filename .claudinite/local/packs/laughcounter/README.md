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
| Re-ask "not statically checkable" after the tree changes | `RULES.md` prose |
| Test "already covered by another check" before believing it | `RULES.md` prose |
| Author a check as a positive whitelist, not a ban list | `RULES.md` prose |
| Ship a stateable version + build number, and bump it per distinguishable build | `RULES.md` prose |
| A green scheduled run that skipped its work is not a pass | `RULES.md` prose |
| Delete the flagged coupling before reaching for an `accept` | `RULES.md` prose |

Prose-only so far.
