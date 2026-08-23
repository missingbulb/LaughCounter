// The member declaration's rename and reshape (#1252): `.claudinite-checks.json`
// becomes `.claudinite-settings.json`, each pack's installed version moves onto that
// pack's own entry, and the two blocks that had stopped saying anything come out.
//
// WHY A RECORD AND NOT A CONVERGE. The file is the MEMBER'S — its packs, its rules,
// its acceptances, its scheduler anchor. A converge writes files the canon owns; this
// one it may only edit in place, once, which is exactly what a record is for.
//
// WHY IT NEEDS NO CAPABILITY PROBE. The usual hazard — a record that needs engine
// behaviour newer than the member's vendored worker — does not apply: the update
// worker loads `updates/engine-update.mjs` out of the FRESH canon clone, and the
// reshape op runs from that same clone. The member's own copy of the worker is only
// asked to read its declaration before the converge, which it does under the old name
// because that is still the name at that moment.
//
// WHAT MAKES THE WINDOW SAFE. Every reader in the corpus tries both names, in
// SETTINGS_FILES order (engine/settings-file.mjs), so a member is read correctly
// whether or not this has run — which is what lets the rename land in one pass
// instead of a phased stack. That tolerance is the thing this record exists to make
// removable: it can go when no member still carries the old name, and never on a date.
export default {
  id: 'settings-file-rename',
  landed: '2026-08-23',
  version: '60823.1',
  summary: '.claudinite-checks.json -> .claudinite-settings.json; pack versions onto their own entries; the retired "claudinite" and "maintenance" blocks folded into engineVersion and dailyClaudiniteUpdatesRequirePrReview; taskScheduler.endpoints renamed',

  // Structural, and every rule of the reshape lives in the op rather than here —
  // see applySettingsReshape in engine/migrations/registry.mjs.
  reshapeSettings: true,
};
