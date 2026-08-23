// WHAT A MEMBER'S SETTINGS FILE IS CALLED — the names alone, and nothing that
// touches a disk to find one.
//
// The names are split out from `settings-file.mjs` because one reader has no disk:
// the dashboard page runs this module in a browser, unbundled, and a single
// `node:` import anywhere in its graph fails the page's first module load
// (#1286). So the two halves live apart — the vocabulary here, the `existsSync`
// probe that picks between the names beside it — and `settings-file.mjs` re-exports
// everything below, which keeps it the one import every disk-side reader needs.
//
// THE RENAME (#1252). The file is `.claudinite-settings.json`. It was
// `.claudinite-checks.json` when checks were the only thing a member declared, and
// it has not been a file of checks for a long time: it carries the pack
// declaration, the scheduler anchor, the installed versions and the delivery
// override. The old name is still READ, everywhere, because a member's file is
// renamed by a migration record that converges on its own schedule — and until
// every member has run it, both names name the same file.
//
// The tolerance is the LEGACY half of a rename with a stated end: the cleanup that
// deletes it is gated on no member still carrying the old name, never on a date
// (#1252 Phase 3).

export const SETTINGS_FILE = '.claudinite-settings.json';

// Retired from what anything WRITES; still read while members carry it.
export const LEGACY_SETTINGS_FILE = '.claudinite-checks.json';

// Both names, newest first — the read order, so a member mid-rename that somehow
// holds both is read from the one the migration wrote. Exported for the cross-repo
// readers, which have no disk to probe and must try the paths in this order over
// the API.
export const SETTINGS_FILES = [SETTINGS_FILE, LEGACY_SETTINGS_FILE];

// Is this path one of the two settings-file names? For the scans that ask whether a
// changed file is the declaration, which must keep answering yes for a member that
// has not been renamed yet.
export const isSettingsFile = (path) => SETTINGS_FILES.includes(String(path ?? '').split('/').pop());
