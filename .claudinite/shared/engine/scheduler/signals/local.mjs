// The LOCAL-DISK half of the signal collectors' `ctx` (per-project-scheduling
// DESIGN §3.3). Three collectors read facts off `ctx` that no GitHub read can
// supply — the shipped manifest version and whether this repo publishes at all
// (`release.manifestVersion`, `release.shipsPipeline`), whether the
// repo tracks local packs (`localPacks.present`), and the configured log
// retention (`conversationLogs.retentionDays`). The scheduler runs Action-side
// INSIDE the repo checkout, so all three are readable from the checkout itself:
// no API call, no rate budget, no base64 round-trip, and the tree read is the
// same tree the run would ship.
//
// This deliberately sits BESIDE the collectors rather than inside them. The
// collectors stay pure over an injected `ctx` (`ctx.X ?? null`), so the whole
// signal layer still unit-tests against a fake `gh` with no repo on disk; this
// module is the one place that touches the filesystem, and signals/context.mjs folds its
// result into the ctx it hands the collectors.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// A repo's own packs live under either local root — the canonical
// `.claudinite/local/packs/` or the pre-rename `.claudinite/local_packs/`, both
// live until the rename's cleanup. One definition: the `localPacks` collector's
// path test and the fleet reader's per-member probe both read it from here, so
// "where a local pack lives" cannot drift between the presence probe and the
// changed-in-window probe.
export const LOCAL_PACK_ROOTS = ['.claudinite/local/packs/', '.claudinite/local_packs/'];

// Where a browser-extension manifest may sit, in the order the retired gate
// probed them (recovered from the pack's deleted run_daily gate): the first one
// carrying a `version` wins. Absent/unparsable/versionless → null, which the
// consuming precondition reads as "no manifest version to judge".
const MANIFEST_PATHS = ['manifest.json', 'src/manifest.json', 'public/manifest.json', 'dist/manifest.json'];

function readManifestVersion(root) {
  for (const path of MANIFEST_PATHS) {
    let json;
    try { json = JSON.parse(readFileSync(join(root, path), 'utf8')); } catch { continue; }
    if (json?.version) return String(json.version);
  }
  return null;
}

// Does this repo PUBLISH — does it carry the release orchestrator (by `name:`, since
// a repo may host the pipeline's own reusable workflows at the same paths without
// being a publisher, as Claudinite's core tree does) or a release config? Either is
// enough, and the pair is the release standard's own test.
//
// The spelling lives here rather than being imported because the engine depends on no
// pack; the release pack's own SHIPS_PIPELINE_* regexes are the other copy, and the
// drift test beside them fails if the two disagree.
const SHIPS_PIPELINE_TEXT = /^(?:name:\s*['"]?(?:Release to Chrome Store|Release)['"]?\s*|manifest_path=.*)$/m;

function readShipsReleasePipeline(root) {
  const candidates = [];
  try {
    for (const e of readdirSync(join(root, '.github/workflows'), { withFileTypes: true })) {
      if (e.isFile() && /\.ya?ml$/.test(e.name)) candidates.push(join('.github/workflows', e.name));
    }
  } catch { /* no workflows directory — the release config may still say it ships */ }
  candidates.push('.github/release.config');
  return candidates.some((rel) => {
    try { return SHIPS_PIPELINE_TEXT.test(readFileSync(join(root, rel), 'utf8')); } catch { return false; }
  });
}

// Does the checkout carry any local pack? A pack is a DIRECTORY under a local
// root; an absent or empty root is "none". Explicit `false` (not null) is the
// point — the consuming precondition self-skips only on a definite no.
function readHasLocalPacks(root) {
  for (const dir of LOCAL_PACK_ROOTS) {
    let entries;
    try { entries = readdirSync(join(root, dir), { withFileTypes: true }); } catch { continue; }
    if (entries.some((e) => e.isDirectory())) return true;
  }
  return false;
}

// The log-retention window, in days, from the declared packs' entry config
// (`retention_days` in .claudinite-settings.json). Read through the caller's
// existing per-pack config reader rather than a second settings parser, and
// keyed by the PARAMETER, not by a pack name — core does not name the pack that
// happens to declare it. First declared pack carrying a numeric value wins.
function readRetentionDays(packIds, packConfigFor) {
  for (const id of packIds) {
    const value = packConfigFor(id)?.retention_days;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

// The ctx facts, read off the checkout at `root`. Every probe degrades to
// null/false rather than throwing: a missing file, an unreadable directory, and
// malformed JSON are all "nothing to judge", never a failed scheduler run.
export function localSignalContext(root, { packIds = [], packConfigFor = () => ({}) } = {}) {
  return {
    manifestVersion: readManifestVersion(root),
    shipsReleasePipeline: readShipsReleasePipeline(root),
    hasLocalPacks: readHasLocalPacks(root),
    retentionDays: readRetentionDays(packIds, packConfigFor),
  };
}
