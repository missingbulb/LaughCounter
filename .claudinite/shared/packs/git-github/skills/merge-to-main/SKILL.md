---
name: merge-to-main
description: Merge the change in front of the owner into main. Use when the owner says "LGTM" or asks to merge/land the current branch or PR into main.
---

# Merge to main

If the project's own `CLAUDE.md` names a merge-policy file, that file overrides the divergent
points below (merge method, CI gating). Don't go hunting for one it doesn't name.

1. Load `create_pull_request` + `merge_pull_request` in one `ToolSearch`.
2. No PR open for the branch? `create_pull_request` (base `main`), body ending `Closes #<issue>`.
3. If the PR has check runs, wait for them to pass. None — merge without waiting.
4. `merge_pull_request`, `merge_method: squash`, title `<subject> (#<pr>)`. Don't pre-read
   mergeability; the call fails loudly.
5. Sync local `main`: `git checkout main && git pull origin main`.
6. Capture the conversation:
   `node .claudinite/shared/packs/claudinite-growth/capture-log.mjs --issue <n>`
   (in the canon repo: `node packs/claudinite-growth/capture-log.mjs --issue <n>`). Skip only if
   the repo doesn't declare `claudinite-growth`. A later merge in the same session runs it again.
7. Run the basics pack's
   [verify-in-production](../../../basics/skills/verify-in-production/SKILL.md) skill, unasked.
   This step is that skill's **only** trigger — it files against what the squash actually landed,
   which is why it runs here and not when the code was written or the PR opened. It decides
   whether this change needs a production check at all — most don't — and files the issue that
   comes back once the change is live. Never offer the owner to check later instead.

Don't re-read the issue to confirm it closed — `Closes #<issue>` does that on merge.
