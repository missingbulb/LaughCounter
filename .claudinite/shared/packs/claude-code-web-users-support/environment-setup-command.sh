#!/usr/bin/env bash
# Claudinite cloud environment setup — generic, identical for every project and
# owned by the corpus (vendored into
# .claudinite/shared/packs/claude-code-web-users-support/), so a project commits
# no copy of its own.
#
# HOW TO USE: paste this full body into the Claude Code Web environment's "Setup
# script" field. It runs once when the environment image is built, as root,
# starting in the checkout's PARENT dir. What gets installed is the active packs'
# business (engine/pack_loader/env-requirements.mjs), so this body never changes
# as requirements evolve — see bootstrap.md Part 9.
set -euo pipefail

# The checkout is the one dir under here that mounts Claudinite.
cd "$(dirname "$(find "$PWD" -maxdepth 2 -name .claudinite-checks.json 2>/dev/null | head -n1)")"
node .claudinite/shared/engine/pack_loader/env-requirements.mjs install
