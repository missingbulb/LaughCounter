// The dashboard serves the whole laugh log — every timestamp, every confidence —
// with no authentication, so its default bind address is a privacy decision, not
// an ergonomics one (config.py: "bound to localhost by default for privacy").
// Any Python default of a *host* parameter must therefore be a loopback address;
// reaching it from a phone stays an explicit `--host 0.0.0.0` the user types.
// Dependency-free (a local pack loads without the canon mount): plain findings.

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

// `something_host = "..."` / `host: str = "..."` — an identifier containing
// "host" given a string-literal default. Keyword arguments at call sites match
// the same shape, which is intended: `serve(..., host="0.0.0.0")` is the same
// decision as the signature's default.
const HOST_DEFAULT = /\b(\w*host\w*)\s*(?::\s*[^=\n]+?)?=\s*["']([^"']*)["']/g;

const rule = {
  id: 'on-device-privacy/loopback-default',
  severity: 'blocking',
  description: 'Host defaults in laughcounter/ must be loopback — the dashboard is unauthenticated',
  doc: '.claudinite/local/packs/on-device-privacy/RULES.md',
  why: 'the dashboard exposes the full laugh history with no auth, so a non-loopback default would publish it to the LAN without anyone choosing to',

  run(ctx) {
    const out = [];
    for (const file of ctx.files.filter((f) => f.startsWith('laughcounter/') && f.endsWith('.py'))) {
      const text = ctx.read(file);
      if (text === null) continue;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        HOST_DEFAULT.lastIndex = 0;
        let m = HOST_DEFAULT.exec(lines[i]);
        while (m !== null) {
          const [, name, value] = m;
          if (value !== '' && !LOOPBACK.has(value)) {
            out.push({
              rule: rule.id,
              severity: rule.severity,
              file,
              line: i + 1,
              what: `${name} defaults to "${value}", not a loopback address`,
              why: rule.why,
              fix: 'default to 127.0.0.1 and leave a wider bind to an explicit --host the user passes',
              doc: rule.doc,
            });
          }
          m = HOST_DEFAULT.exec(lines[i]);
        }
      }
    }
    return out;
  },
};

export default rule;
