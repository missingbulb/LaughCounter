# prose-to-checks-sweep

## Why the declaration reads as it does

Carried over from the declaration's comments when it became `task.json`.

claudinite-growth task: prose-to-checks-sweep — mine a repo's EXISTING pack
prose for always-testable rules the conversion missed and convert the strongest
ones (per-project-scheduling redesign). A per-repo task: every repo declaring the
growth pack sweeps its OWN packs. Which pack paths it works is a config setting,
`pack_paths`, defaulting to the repo's own local packs; Claudinite itself sets it
to ALSO include its core `packs/` (projects are not expected to improve core canon
packs — only Claudinite does). The method is owned by the prose-to-checks skill.

The subject is the world's, but the value is zero on a repo nobody works in:
no new prose is written where nothing happens, and the first active window
resumes the sweep. Which pack paths it sweeps is task.md's.

Never narrow this to a movement gate: the backlog is standing, so the sweep
would halt half-converted the week prose stops changing. And never gate on the
previous round still being open — the round runs and appends to that PR, which
is what makes one review cover several weeks of conversions.
A conversion removes the prose line and writes the check that replaces it —
both classes are this pack's merge-rules.json. In the canon home the sweep
works `packs/`, which neither class covers, so a canon round still parks.
The prose side is line removals from local-pack Markdown — said inline,
since the built-in class already means exactly that; the check side needs
the pack's own file-name matcher.
