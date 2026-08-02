---
name: bump-version
description: Raise the project's version — a minor bump by default. Use when the owner says "bump version".
---

The mechanics are the consuming project's — its release/workflow doc names which files carry
the version and how a release follows.

**Semantic versions (`X.Y.Z`).** For a Chrome-extension repo the standard applies
([the chrome-extension-release pack's RELEASE.md](../../../../packs/chrome-extension-release/RELEASE.md)):
edit the manifest and `package.json` together on a branch (default the next **minor**), land on
`main` via a normal PR — merging the bump *is* cutting the release.

**Date-anchored versions (`<major>.<ymmdd>.<n>`).** A project on this scheme — a static site under
[the static-website pack's RELEASE.md](../../../../packs/static-website/RELEASE.md) — computes the
last two parts from the previous version and the UTC date, in its release pipeline, on every push
that ships. So there is no minor to raise and nothing to compute by hand: **"bump version" means the
`major`**, the deliberate "this is a new generation of the site" statement. Edit it in every version
record the project declares, together, in one PR; the pipeline takes the date and the day counter
from there on its next run. Never hand-write the `ymmdd` or the counter — a value dated in the
future makes the next bump refuse.
