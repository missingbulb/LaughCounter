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
| Never hand-write a second `v<version> (<build>)` literal outside `AppDelegate` | `single-version-source` check (`mac/Sources/**.swift`) |
| A green scheduled run that skipped its work is not a pass | `RULES.md` prose |
| Nothing runs on `pull_request` — the auto-merge arm is always rejected | `RULES.md` prose |
| The licensed hand-merge always trips a `[Merge Without Review]` warning | `RULES.md` prose |
| No comment-edit tool exists — resolve a value before posting it | `RULES.md` prose |
| A text-matching check hits the comment documenting the idiom it bans | `RULES.md` prose |
| Every scheduled session trips `comment-classification` and a webhook echo | `RULES.md` prose |
| Delete the flagged coupling before reaching for an `accept` | `RULES.md` prose |
| `search_issues`'s `query` is natural language, not GitHub qualifier syntax | `RULES.md` prose |
| `verify-outcome.mjs` is a module export, not a CLI | `RULES.md` prose |
| A post-merge scratchpad git sync can be classifier-denied — verify read-only | `RULES.md` prose |

Fixtures: `pack.test.mjs` — `node --test .claudinite/local/packs/laughcounter/pack.test.mjs`.
The check has a violating fixture it fires on and the repo's real sources it stays quiet on.
