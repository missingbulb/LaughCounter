// "Delete the folder and it's gone" as a check. Everything LaughCounter persists
// belongs in *one* deletable directory per implementation — `~/.laughcounter` for
// the Python core (overridable via LAUGHCOUNTER_HOME) and
// `~/Library/Application Support/LaughCounter/` for the native app. State that
// lands anywhere else (a cache, a model dir, a log) breaks the documented
// property that removing that one folder removes everything the mic ever heard
// about you.
//
// So this scans the two runtime trees for *home-anchored* path literals and for
// the Foundation standard-directory API, and requires each to land inside the one
// directory. It matches the literal forms the code actually uses — a `~/…` string,
// `Path.home() / "…"`, `urls(for: .someDirectory)`, `NSHomeDirectory()` — rather
// than every conceivable path expression, so it stays free of false alarms.
//
// One documented exemption: `~/Library/LaunchAgents/…`. launchd mandates that
// location for a login agent and the app never writes it — `laughcounter service`
// only prints the plist and tells the user where to redirect it.
//
// Dependency-free by design (a local pack must load without the canon mount), so
// the finding object is built by hand rather than via the engine helper.

const PY_HOME = '.laughcounter';
const MAC_DIR = 'LaughCounter';

// launchd's mandated location — not app state, and not written by the app.
const HOME_EXEMPT = [/^Library\/LaunchAgents(\/|$)/];

// `Path.home() / "seg"` — the join's first literal segment.
const PATH_HOME_JOIN = /\bPath\.home\(\)\s*\/\s*["']([^"']*)["']/g;
// Any quoted `~/…` literal (expanduser arguments, f-strings, plain paths).
const TILDE_LITERAL = /["']~\/([^"']*)["']/g;

// `FileManager.default.urls(for: .applicationSupportDirectory, …)` — the standard
// directory being asked for. Scoped to the `urls(for:` call so that unrelated
// selectors ending in "Directory" (`.createDirectory`, `withIntermediateDirectories`)
// can't trip it.
const URLS_FOR_DIRECTORY = /\burls\s*\(\s*for:\s*\.(\w+)Directory\b/g;
const NS_HOME_DIRECTORY = /\bNSHomeDirectory\s*\(\s*\)/;
// The Application Support base is only legal once narrowed to LaughCounter/.
const NARROWED = new RegExp(`appendingPathComponent\\(\\s*["']${MAC_DIR}["']`);
const NARROW_WINDOW = 8;

const firstSegment = (path) => path.split('/')[0];
const exempt = (path) => HOME_EXEMPT.some((p) => p.test(path));

const rule = {
  id: 'on-device-privacy/single-home-directory',
  severity: 'blocking',
  description:
    'Persisted state stays in the one deletable directory (~/.laughcounter, ~/Library/Application Support/LaughCounter)',
  doc: '.claudinite/local/packs/on-device-privacy/RULES.md',
  why: '"delete the folder and it\'s gone" is a documented privacy property — state scattered outside that one directory survives the delete the user thinks removed everything',

  run(ctx) {
    const out = [];
    const add = (file, line, what, fix) =>
      out.push({ rule: rule.id, severity: rule.severity, file, line, what, why: rule.why, fix, doc: rule.doc });

    for (const file of ctx.files) {
      const isPy = file.startsWith('laughcounter/') && file.endsWith('.py');
      const isSwift = file.startsWith('mac/Sources/') && file.endsWith('.swift');
      if (!isPy && !isSwift) continue;
      const text = ctx.read(file);
      if (text === null) continue;
      const lines = text.split('\n');

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];

        if (isPy) {
          for (const pattern of [PATH_HOME_JOIN, TILDE_LITERAL]) {
            pattern.lastIndex = 0;
            let m = pattern.exec(line);
            while (m !== null) {
              const path = m[1];
              const seg = firstSegment(path);
              if (seg !== '' && seg !== PY_HOME && !exempt(path)) {
                add(
                  file,
                  i + 1,
                  `a home-anchored path lands in "~/${seg}", outside ~/${PY_HOME}`,
                  `keep persisted state under the configured home (config.default_home() / cfg.home_path, i.e. ~/${PY_HOME}) so deleting that one directory removes everything`,
                );
              }
              m = pattern.exec(line);
            }
          }
        }

        if (isSwift) {
          URLS_FOR_DIRECTORY.lastIndex = 0;
          let m = URLS_FOR_DIRECTORY.exec(line);
          while (m !== null) {
            const which = m[1];
            if (which !== 'applicationSupport') {
              add(
                file,
                i + 1,
                `state is placed in the .${which}Directory, not Application Support/${MAC_DIR}`,
                `use .applicationSupportDirectory and narrow it with appendingPathComponent("${MAC_DIR}")`,
              );
            } else if (!NARROWED.test(lines.slice(i, i + NARROW_WINDOW).join('\n'))) {
              add(
                file,
                i + 1,
                `the Application Support base is used without being narrowed to the ${MAC_DIR} directory`,
                `append the "${MAC_DIR}" path component to the base before writing anything under it`,
              );
            }
            m = URLS_FOR_DIRECTORY.exec(line);
          }

          if (NS_HOME_DIRECTORY.test(line)) {
            add(
              file,
              i + 1,
              'NSHomeDirectory() builds a path outside the app\'s one directory',
              `resolve .applicationSupportDirectory via FileManager and narrow it to "${MAC_DIR}" instead`,
            );
          }
        }
      }
    }
    return out;
  },
};

export default rule;
