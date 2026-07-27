// "Delete the folder and it's gone" is a documented privacy property, not a
// tidiness one: everything the Python core keeps about the room — the SQLite
// rows, the JSONL log, the saved clips, downloaded model weights — lives under
// the single directory `home_dir()` returns (`~/.laughcounter`, or
// `LAUGHCOUNTER_HOME`). State that lands somewhere else survives the delete the
// user was told was enough. This check holds the mechanical half: a path
// *anchored at the user's home* inside `laughcounter/` must land under
// `.laughcounter`. Two spellings reach the home directory in this codebase —
// `Path.home()` and a `~/…` string literal (`expanduser`, `Path(...).expanduser()`)
// — and both are checked, minus a short list of locations the OS itself dictates
// (see OS_MANDATED). An absolute path outside `$HOME` is still a judgment call
// left to RULES.md.
// Dependency-free (a local pack loads without the canon mount): plain findings.

const HOME_CALL = /\bPath\.home\s*\(\s*\)/;
const TILDE_LITERAL = /(["'])(~\/[^"']*)\1/g;

// The one directory everything hangs off, however it is spelled at the call site.
const UNDER_HOME_DIR = /\.laughcounter\b/;

// Mandated-location exemption: a launchd agent is registered by *being* a file
// in `~/Library/LaunchAgents/` — the OS picks the path, the project doesn't. It
// carries no captured data (`cmd_service` points its log back at `home_path`),
// so deleting `~/.laughcounter` still takes everything about the room with it.
// Keep this list to locations an OS genuinely dictates; a cache or a model dir
// is a choice, and a choice belongs under the home directory.
const OS_MANDATED = [/^~\/Library\/LaunchAgents\//];

const rule = {
  id: 'on-device-privacy/single-home-dir',
  severity: 'blocking',
  description: 'Home-anchored paths in laughcounter/ must live under the LaughCounter home directory',
  doc: '.claudinite/local/packs/on-device-privacy/RULES.md',
  why: '"delete ~/.laughcounter and it is gone" is a privacy promise the README makes — state written anywhere else in the user\'s home outlives the deletion they were told was enough',

  run(ctx) {
    const out = [];
    for (const file of ctx.files.filter((f) => f.startsWith('laughcounter/') && f.endsWith('.py'))) {
      const text = ctx.read(file);
      if (text === null) continue;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];

        // `Path.home()` is only legal where it is joined to the home directory
        // on the spot (config.py's `Path.home() / ".laughcounter"`).
        if (HOME_CALL.test(line) && !UNDER_HOME_DIR.test(line)) {
          out.push({
            rule: rule.id,
            severity: rule.severity,
            file,
            line: i + 1,
            what: 'Path.home() is used without landing under .laughcounter',
            why: rule.why,
            fix: 'hang the path off home_dir() from laughcounter/config.py instead of reaching into the user home directly',
            doc: rule.doc,
          });
        }

        TILDE_LITERAL.lastIndex = 0;
        let m = TILDE_LITERAL.exec(line);
        while (m !== null) {
          const literal = m[2];
          if (!literal.startsWith('~/.laughcounter') && !OS_MANDATED.some((p) => p.test(literal))) {
            out.push({
              rule: rule.id,
              severity: rule.severity,
              file,
              line: i + 1,
              what: `the home-anchored path "${literal}" is outside ~/.laughcounter`,
              why: rule.why,
              fix: 'move it under the LaughCounter home directory — use home_dir() from laughcounter/config.py so LAUGHCOUNTER_HOME keeps working',
              doc: rule.doc,
            });
          }
          m = TILDE_LITERAL.exec(line);
        }
      }
    }
    return out;
  },
};

export default rule;
