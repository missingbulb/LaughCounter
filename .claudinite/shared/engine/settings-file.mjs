// WHERE A MEMBER'S SETTINGS LIVE — the one place the declaration's filename is
// spelled, for every reader in the corpus: the checks loader, the update and
// install flows, the vendor writer, the migration ops, and the cross-repo
// readers that fetch the file over the API rather than off disk.
//
// THE RENAME (#1252). The file is `.claudinite-settings.json`. It was
// `.claudinite-checks.json` when checks were the only thing a member declared,
// and it has not been a file of checks for a long time: it carries the pack
// declaration, the scheduler anchor, the installed versions and the delivery
// override. The old name is still READ, everywhere, because a member's file is
// renamed by a migration record that converges on its own schedule — and until
// every member has run it, both names name the same file.
//
// The tolerance is the LEGACY half of a rename with a stated end: the cleanup
// that deletes it is gated on no member still carrying the old name, never on a
// date (#1252 Phase 3). Read order is new-then-legacy, so a member mid-rename
// that somehow holds both is read from the one the migration wrote.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const SETTINGS_FILE = '.claudinite-settings.json';

// Retired from what anything WRITES; still read while members carry it.
export const LEGACY_SETTINGS_FILE = '.claudinite-checks.json';

// Both names, newest first — the read order. Exported for the cross-repo readers,
// which have no disk to probe and must try the paths in this order over the API.
export const SETTINGS_FILES = [SETTINGS_FILE, LEGACY_SETTINGS_FILE];

// The settings file to READ under `root`: whichever name is actually there, the
// new one when both are, and the new one when neither is — so a caller reporting
// "no settings file" names the file a member should now have rather than the one
// being retired.
export function settingsPath(root) {
  for (const name of SETTINGS_FILES) {
    const path = join(root, name);
    if (existsSync(path)) return path;
  }
  return join(root, SETTINGS_FILE);
}

// Is this path one of the two settings-file names? For the scans that ask whether
// a changed file is the declaration, which must keep answering yes for a member
// that has not been renamed yet.
export const isSettingsFile = (path) => SETTINGS_FILES.includes(String(path ?? '').split('/').pop());
