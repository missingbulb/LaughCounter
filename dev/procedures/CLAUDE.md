# LaughCounter — local project procedures

Project-specific instructions for this repo, layered on the shared Claudinite
canon mounted read-only at `.claudinite/`. Where a local rule refines a canon
rule, the local one wins — it carries this project's concrete files and gotchas.
Routing index, not a payload: read the matching doc when its trigger fires; don't
pre-load.

Capture lessons **here, locally**, in the doc that owns the topic. A lesson's
*portability* is Claudinite's concern (its growth routine lifts portable lessons
up into the shared canon) — not a reason to capture it anywhere else.

- [ci-release.md](ci-release.md) — **before touching the release/CI workflows
  (`.github/workflows/*-macos-dmg.yml`).** How the DMG gets published to GitHub
  Releases, and the trigger gotchas learned wiring it up.

@ci-release.md
