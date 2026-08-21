#!/usr/bin/env bash
# The body a project pastes into its Claude Code Web environment's Setup script
# field, whole and unedited. Generic for every project — README.md explains why,
# and the pack's adoptionHandover step quotes this body into the issue that asks
# somebody to paste it.
set -euo pipefail

# Runs when the environment image is built, as root, starting in the checkout's
# PARENT dir — hence the search for the one dir under here that mounts Claudinite.
cd "$(dirname "$(find "$PWD" -maxdepth 2 -name .claudinite-checks.json 2>/dev/null | head -n1)")"

# What this installs is the active packs' business, which is why the body never
# changes as their requirements do.
node .claudinite/shared/engine/pack_loader/env-requirements.mjs install
