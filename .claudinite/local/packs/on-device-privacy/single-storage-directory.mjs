// "Delete the folder and it's gone" as a check: the app keeps everything it
// persists under `~/Library/Application Support/LaughCounter/`, so the only
// system directory its sources may ask macOS for is the Application Support
// one. Scans `mac/Sources/` for the APIs that *select* a search-path directory
// and requires the literal `.applicationSupportDirectory`.
//
// A whitelist, not a blacklist. Earlier sweeps left this rule as prose because
// proving "nothing lands outside the directory" looked like it needed data-flow
// tracking of every write target back to its declaration. It doesn't: every
// persistent path in the app is rooted at a `FileManager` search-path lookup,
// and there are exactly two of them (`AppLog.swift`, `Store.swift`), both
// `.applicationSupportDirectory`. Constraining the *root* constrains every path
// derived from it, and matching the allowed constant positively means a
// `SearchPathDirectory` case that doesn't exist yet is caught the day it lands —
// which an enumerate-the-bad-ones list would miss.
//
// Two deliberate consequences, both wanted:
//   - A non-literal argument (`urls(for: dir, in:)`) is a finding. Indirection
//     is exactly what would defeat the check, and no caller needs it here.
//   - The Login Item registration RULES.md carves out doesn't go through these
//     APIs at all (`SMAppService` names no directory), so it needs no exemption.
//
// Dependency-free by design (a local pack must load without the canon mount),
// so the finding object is built by hand rather than via the engine helper.

const ALLOWED = 'applicationSupportDirectory';

// The APIs that pick a system directory. `\s*` spans newlines, so a call split
// across lines (`urls(\n    for: .cachesDirectory,`) is matched too.
const SELECTORS = [
  // FileManager.default.urls(for:in:) and .url(for:in:appropriateFor:create:)
  [/\burls?\s*\(\s*for\s*:\s*([^,\s)]+)/g, 'FileManager.urls(for:)'],
  [/\bNSSearchPathForDirectoriesInDomains\s*\(\s*([^,\s)]+)/g, 'NSSearchPathForDirectoriesInDomains'],
];

const inScope = (f) => f.startsWith('mac/Sources/') && f.endsWith('.swift');

// `.applicationSupportDirectory`, `FileManager.SearchPathDirectory.applicationSupportDirectory`
// and a bare `applicationSupportDirectory` all name the same case.
const caseName = (token) => token.replace(/^.*\./, '');

const rule = {
  id: 'on-device-privacy/single-storage-directory',
  severity: 'blocking',
  description: 'The app asks macOS for only one directory: .applicationSupportDirectory (mac/Sources/)',
  doc: '.claudinite/local/packs/on-device-privacy/RULES.md',
  why: '"delete the folder and it\'s gone" is a promise a user acts on — a second storage root means the mic\'s memory of them outlives the directory they deleted',

  run(ctx) {
    const out = [];
    for (const file of ctx.files.filter(inScope)) {
      const text = ctx.read(file);
      if (text === null) continue;
      for (const [pattern, what] of SELECTORS) {
        pattern.lastIndex = 0;
        let m = pattern.exec(text);
        while (m !== null) {
          const token = m[1];
          if (caseName(token) !== ALLOWED) {
            out.push({
              rule: rule.id,
              severity: rule.severity,
              file,
              line: text.slice(0, m.index).split('\n').length,
              what: `${what} asks for \`${token}\`, not \`.${ALLOWED}\` (${file})`,
              why: rule.why,
              fix: `root the path at \`FileManager.default.urls(for: .${ALLOWED}, in: .userDomainMask)[0]\` and hang it off the app's existing \`LaughCounter\` directory; a second storage root is a product decision that belongs in RULES.md first`,
              doc: rule.doc,
            });
          }
          m = pattern.exec(text);
        }
      }
    }
    return out;
  },
};

export default rule;
