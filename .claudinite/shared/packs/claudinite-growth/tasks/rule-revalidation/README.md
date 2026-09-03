# rule-revalidation

## Why the declaration reads as it does

Carried over from the declaration's comments when it became `task.json`.

claudinite-growth task: rule-revalidation — re-probe the pack rules whose
truth lives OUTSIDE this repo. A rule saying "the harness rejects X", "the
Action's token cannot reach Y", "MCP tool Z exists" was true of the environment
on the day it was written, and nothing in the repo goes red when the platform
moves under it: the prose stays green, sessions keep following it, and the cost
lands as a session spent on a path that closed months ago. This task re-runs the
probe behind each such claim and corrects what no longer holds.

Scope is the pack's existing `pack_paths` config — the same key the sibling
prose-to-checks-sweep reads, so a repo names its capture surface once: a
consuming repo revalidates only its OWN local packs, and Claudinite (which
configures `packs`) revalidates the whole canon — so every pack's claims are
re-probed in the one repo that can fix them, exactly once across the fleet.

The claims are about the world, but a repo nobody works in has nothing riding
on them: the sweep sleeps while it is silent and resumes on the first active
window. Which pack paths it revalidates is task.md's.

Never narrow this to a movement gate: the repo does not move when its claims
expire, so movement is exactly the wrong evidence. And never gate on the
previous round still being open — the round runs and appends to that PR, which
is what makes one review cover several weeks of corrections.
