import { finding } from '../../../engine/checks/helpers/findings.mjs';
// Namespace imports throughout, and every constant read through a `typeof`
// guard: the engine lane and the pack lane converge on separate cycles, so this
// file spends windows beside an engine that predates one of the symbols below.
// A named import of an absent export is a link-time error that faults the whole
// pack; a guarded read simply drops that one advisory, which is the behaviour
// the older engine already has.
import * as settingsNames from '../../../engine/settings-file-names.mjs';
import * as repoContext from '../../../engine/checks/helpers/repo-context.mjs';
import * as installedVersions from '../../../engine/installed-versions.mjs';
import * as renamedPacks from '../../../engine/pack_loader/renamed-packs.mjs';
import * as packRegistry from '../../../engine/pack_loader/pack-registry.mjs';
import * as versionSpec from '../../../engine/version.mjs';
import * as servedBy from '../../../engine/served-by.mjs';

// THE ADVISORY HALF OF EVERY DECLARATION-SHAPE TOLERANCE the engine still
// carries. Each of those tolerances lets a member's own file be read in a shape
// that has since been renamed, and each is removed a week after this advisory ships
// (#1638) — the window a repo converging nightly needs to act on its own finding.
// Nothing was telling the repos, which is why the window needed the advisory first.
//
// A tolerance with no advisory asks people to migrate off something they have no
// way of knowing they are on, so this rule fires in the repo that HOLDS the old
// shape rather than in the canon that tolerates it (basics' *Adding a legacy
// tolerance*). It reads the member's own declaration and stamp and names, per
// finding, the edit that moves it forward.
//
// ADVISORY, permanently. The old shape works — that is what a tolerance means —
// so a blocking finding would stop a member's build over something that is not
// broken. What the advisory buys is that the removal's gate can eventually read
// zero, which is the only way the tolerance ever comes out.
const rule = {
  id: 'legacy-shape-in-use',
  severity: 'advisory',
  since: '2026-09-03',
  description: 'This repo\'s Claudinite declaration and stamp use no shape the engine only tolerates',
  why: 'every legacy shape here is read through a tolerance that comes out a week after this advisory ships (#1638) — the canon cannot see which repos still carry the old shape, so a repo that does not act inside that window loses its mount rather than holding the removal up',

  run(ctx) {
    const names = Array.isArray(settingsNames.SETTINGS_FILES) ? settingsNames.SETTINGS_FILES : [];
    const file = names.find((n) => ctx.files.includes(n));
    if (!file) return [];                                  // not a member — inert

    let raw;
    try { raw = JSON.parse(ctx.read(file) ?? ''); } catch { return []; }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return [];

    const out = [];
    const flag = (what, fix) => out.push(finding(rule, { file, what, fix }));

    if (typeof settingsNames.LEGACY_SETTINGS_FILE === 'string' && file === settingsNames.LEGACY_SETTINGS_FILE) {
      flag(`the declaration is still named ${settingsNames.LEGACY_SETTINGS_FILE}`,
        `rename it to ${settingsNames.SETTINGS_FILE} — the file gained parameters, waits and schedules that are not checks, and the old name is read only until every member is off it`);
    }

    for (const key of Array.isArray(repoContext.LEGACY_CONFIG_KEYS) ? repoContext.LEGACY_CONFIG_KEYS : []) {
      if (raw[key] !== undefined) {
        flag(`the declaration carries the retired top-level "${key}" block`,
          'move its contents to their current homes — a pack\'s parameters to that pack\'s entry `config`, the stamp to `engineVersion` plus each entry\'s own `version`, delivery to `requirePrReview` — and delete the block');
      }
    }

    if (raw.packConfig !== undefined) {
      flag('the declaration carries a top-level "packConfig" map',
        'move each pack\'s parameters onto that pack\'s own entry in `packs` as `config`, where a version cannot outlive the pack it prices, and delete the top-level map');
    }

    const endpointsKey = repoContext.LEGACY_ENDPOINTS_KEY;
    if (typeof endpointsKey === 'string' && raw.taskScheduler?.[endpointsKey] !== undefined) {
      flag(`taskScheduler.${endpointsKey} is the retired spelling`,
        `rename it to taskScheduler.${repoContext.ENDPOINTS_KEY ?? 'agenticTaskInvocationEndpoints'} — these are the routine URLs a task's agentic phase is invoked through, and the bare name said nothing about which endpoints it meant`);
    }

    // Only where the block actually holds a stamp: its other contents are the
    // config-key finding above, and two findings for one block would read as two
    // separate edits.
    const stamp = typeof installedVersions.LEGACY_STAMP_KEY === 'string' ? raw[installedVersions.LEGACY_STAMP_KEY] : undefined;
    if (stamp?.engineVersion !== undefined || stamp?.packVersions !== undefined) {
      flag(`the version stamp still lives in the "${installedVersions.LEGACY_STAMP_KEY}" block`,
        'let the converge restamp it — the engine version belongs at the top level as `engineVersion` and each pack\'s version on its own `packs` entry; if the converge has run and the block is still here, the record that reshapes it has not reached this mount');
    }

    const entries = Array.isArray(raw.packs) ? raw.packs : [];
    const idOf = (e) => (typeof e === 'string' ? e : (e && typeof e === 'object' && typeof e.id === 'string' ? e.id : null));
    const renames = renamedPacks.RENAMED_PACKS ?? {};
    const localPrefix = packRegistry.LEGACY_LOCAL_DECL_PREFIX;

    for (const entry of entries) {
      const id = idOf(entry);
      if (id === null) continue;
      if (typeof localPrefix === 'string' && id.startsWith(localPrefix)) {
        flag(`the pack entry "${id}" uses the retired declaration prefix "${localPrefix}"`,
          `declare it as "${id.replace(localPrefix, packRegistry.LOCAL_DECL_PREFIX ?? 'local/')}" — this repo's own packs are discovered from .claudinite/local/packs/ and the old prefix resolves only while the tolerance stands`);
      }
      if (Object.hasOwn(renames, id)) {
        flag(`the pack entry "${id}" names a pack that has been renamed or absorbed`,
          `declare "${renames[id]}" instead — an id is matched literally when packs activate, so on the day the rename map comes out this entry activates nothing at all, the self-refresh included`);
      }
      if (typeof versionSpec.isLegacyVersion === 'function' && versionSpec.isLegacyVersion(entry?.version)) {
        flag(`the pack entry "${id}" is stamped with the pre-2026-08-20 integer version ${entry.version}`,
          'let the converge restamp it — a date-anchored `<day>.<n>` says when, where a counter says only "behind by an unknown amount"; if the converge has run and the integer is still here, this mount is not converging');
      }
    }

    if (typeof versionSpec.isLegacyVersion === 'function' && versionSpec.isLegacyVersion(raw.engineVersion)) {
      flag(`engineVersion is the pre-2026-08-20 integer ${raw.engineVersion}`,
        'let the converge restamp it — an integer sorts below every date-anchored version, so this mount prices itself as ancient against all of them');
    }

    if (typeof servedBy.LEGACY_MECHANISM === 'string' && raw.servedBy?.mechanism === servedBy.LEGACY_MECHANISM) {
      flag(`servedBy.mechanism is the retired alias "${servedBy.LEGACY_MECHANISM}"`,
        `write "${servedBy.VERSIONED_MECHANISM ?? 'versioned'}" — the same flows serve both spellings today, and only one of them survives the alias's removal`);
    }

    return out;
  },
};

export default rule;
