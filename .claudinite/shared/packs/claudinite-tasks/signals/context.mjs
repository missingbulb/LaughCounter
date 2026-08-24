// The `ctx` every signal collector reads (per-project-scheduling DESIGN §3.3) —
// the already-resolved facts a collector may not go and fetch for itself, built
// once per collection and handed to `collectSignals`.
//
// Its own module so the construction is testable on its own: the collectors'
// `ctx.X ?? null` seam makes them unit-testable with a hand-built ctx, which is
// exactly why a key nothing here populates can read as "collector works" forever.
// Assert against THIS, not a hand-built shape.
//
// `root` is the Action-side checkout: the manifest version, the local-pack
// presence and the configured retention are all read from it (signals/local.mjs),
// because a scheduled run already has the tree on disk and an API round-trip would
// buy nothing.

import { localSignalContext } from './local.mjs';

// `item` is the OCCURRENCE the signals are being collected for, where the caller
// has one — the executor always does. Almost every collector reads a window of repo
// activity and ignores it; the `request` collector reads the single issue this item
// names, which is a fact no window can single out.
export function buildSignalContext({ root, repo, defaultBranch, now, sinceIso, config, fleet = null, item = null, packConfigFor = () => ({}) }) {
  const local = localSignalContext(root, { packIds: config.packs ?? [], packConfigFor });
  return {
    repo, defaultBranch, now, sinceIso, config, item,
    activePacks: config.packs, fleet,
    manifestVersion: local.manifestVersion,
    shipsReleasePipeline: local.shipsReleasePipeline,
    hasLocalPacks: local.hasLocalPacks,
    retentionDays: local.retentionDays,
  };
}
