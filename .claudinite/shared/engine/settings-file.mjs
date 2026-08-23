// WHERE A MEMBER'S SETTINGS LIVE — the one import for every reader in the corpus
// that has a disk: the checks loader, the update and install flows, the vendor
// writer, the migration ops, and the cross-repo readers that fetch the file over
// the API rather than off disk.
//
// The names themselves, and the rename they are still carrying, live in
// `settings-file-names.mjs`, which stays free of `node:` imports so the dashboard
// page can load it in a browser. They are re-exported here, so nothing on the disk
// side has to know about the split.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SETTINGS_FILE, SETTINGS_FILES } from './settings-file-names.mjs';

export { SETTINGS_FILE, LEGACY_SETTINGS_FILE, SETTINGS_FILES, isSettingsFile } from './settings-file-names.mjs';

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
