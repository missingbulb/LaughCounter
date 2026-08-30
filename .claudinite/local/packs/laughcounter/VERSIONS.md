# laughcounter — change record

Every change automatic work makes to this pack, newest first: a prose rule added or removed, a
check created, a rule corrected against a probe or deleted as irrelevant. The row is written in
the same PR as the change it describes, so this file diffs beside it.

A run that changed nothing writes no row — this is the log of what happened to the pack, never a
log of runs.

| Date | Task | Change |
|---|---|---|
| 2026-08-30 | `rule-revalidation` | Corrected: **`verify-outcome.mjs`'s invocation path** — probing `<engine>/scheduler/verify-outcome.mjs` (`.claudinite/shared/engine/scheduler/verify-outcome.mjs`) against the vendored tree throws `ERR_MODULE_NOT_FOUND`; the engine carries no `scheduler/` directory at all, and the file actually lives at `.claudinite/shared/packs/claudinite-tasks/verify-outcome.mjs`, which resolves and runs. The rule now gives that real path. (#331) |
| 2026-08-23 | `growth-dedup` | Removed: **A scratchpad clone's local git mutation can be denied by the auto-mode classifier** — the same incident (#202/#203) is now generalized in `git-github/skills/git-github-advanced/SKILL.md` ("if the session's own permission/auto-mode classifier denies a mutating git command … take one attempt and stop … confirm what's needed read-only"). |
| 2026-08-23 | `growth-dedup` | Removed: **`mcp__github__search_issues`'s `query` is natural-language semantic matching, not GitHub qualifier syntax** — `git-github/skills/git-github-advanced/SKILL.md` now states the general point and a stronger fix ("don't search at all — list and match it yourself … Enumerate with `list_issues`"). |
| 2026-08-23 | `growth-dedup` | Stripped: **A text-matching check fires on the comment that documents the very idiom it bans** — the strip-comments-both-directions / prove-against-real-sources rule is now general in `basics/RULES.md` ("Writing a check that scans the repo"); kept only this repo's own placement-convention residue and the #152/#159 incident. |
| 2026-08-23 | `growth-dedup` | Removed: **Nothing you post to GitHub can be edited afterwards** — the same incident (#143) is now generalized in `claudinite-growth/skills/unattended-agents/SKILL.md` ("Nothing you post to a tracker can be edited — resolve every value before the comment goes up"). |
| 2026-08-23 | `growth-dedup` | Removed: **That licensed hand-merge comes back as a `[Merge Without Review]` security warning** — now generalized in `claudinite-growth/skills/unattended-agents/SKILL.md` ("A `[Merge Without Review]` security warning on a task's own unattended merge is expected, not a finding to escalate … converge normally"). |
| 2026-08-23 | `growth-dedup` | Removed: **A scheduled job that skips its work still exits 0** — the same incident (#56) is now generalized in `claudinite-growth/skills/unattended-agents/SKILL.md` ("A run that skips its work still exits 0 … a skip is a finding to triage, not a pass"). |
| 2026-08-23 | `growth-dedup` | Removed: **Write a check as a positive whitelist over an enumerated API surface** — the same example (`single-storage-directory`) is now generalized in `claudinite-growth/skills/prose-to-checks/SKILL.md` ("Prefer a positive allowlist over an enumerated list of the bad cases … Invert only where the allowed set is genuinely open-ended"). |
| 2026-08-23 | `growth-dedup` | Removed: **"Already covered by another check" is a claim to test, not to reason out** — the same incident is now generalized in `claudinite-growth/skills/prose-to-checks/SKILL.md` ("hand the sibling check a file that violates the rule before dropping the candidate as a duplicate"). |
| 2026-08-23 | `growth-dedup` | Removed: **"Not statically checkable" is a verdict about the tree's shape at the time, not about the rule** — the same incident (`on-device-privacy`'s storage-directory rule) is now generalized in `claudinite-growth/skills/prose-to-checks/SKILL.md`. |
| 2026-08-23 | `growth-dedup` | Removed: **Don't prune a `.gitignore` section in the same breath as deleting what it ignored** — now generalized, near-verbatim, in `git-github/skills/git-github-advanced/SKILL.md` ("Don't prune a `.gitignore` section in the same commit that deletes what produced its artifacts"). |
