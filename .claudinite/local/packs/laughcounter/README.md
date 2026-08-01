# laughcounter

The repo's **general** local pack — the working lessons about LaughCounter that aren't about the
on-device-privacy boundary. That boundary is the product's defining constraint and keeps its own
pack (`local/on-device-privacy`, checks included); this one is where everything else lands so it
doesn't get filed under privacy for want of a home.

Local pack, declared by hand as `local/laughcounter` (no fingerprint), named for the repo the way
the canon home repo's own pack is named for it.

| Rule | How enforced |
| --- | --- |
| Don't prune `.gitignore` while its artifacts are still in the worktree | `no-loose-build-artifacts` check (no artifact class is visible to git), plus `RULES.md` prose for the sequencing half the check can't see |
| Re-ask "not statically checkable" after the tree changes | `RULES.md` prose |
| Author a check as a positive whitelist, not a ban list | `RULES.md` prose |

Fixtures: `pack.test.mjs` — `node --test .claudinite/local/packs/laughcounter/pack.test.mjs`.
Each check has a violating fixture it fires on and this repo's real file list it stays quiet on.
They sit in the pack, not alongside the app sources (`claudinite-isolation`).
