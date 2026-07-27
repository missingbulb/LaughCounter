// The dashboard is unauthenticated: nothing but the browser's own preflight
// rules stand between a page on the LAN and the laugh log. `dashboard.py`'s
// do_POST therefore rejects anything that isn't `application/json` before it
// touches the database — a content type a cross-origin `fetch` cannot send
// without a CORS preflight the dashboard never answers. That guard is the whole
// CSRF story, so a *new* mutating handler that forgets it silently reopens the
// hole. Parses the handler body by indentation rather than grepping the file,
// so the guard has to live in the handler that needs it — `application/json`
// elsewhere in the module (response content types, the inline page's fetch)
// doesn't count.
// Dependency-free (a local pack loads without the canon mount): plain findings.

// BaseHTTPRequestHandler dispatches `do_<VERB>`; these are the ones that mutate.
const MUTATING_HANDLER = /^(\s*)(?:async\s+)?def\s+(do_(?:POST|PUT|PATCH|DELETE))\s*\(/;

// The request's own content type being read — `self.headers.get("Content-Type")`
// or `self.headers["Content-Type"]`, however it is spelled/cased.
const READS_CONTENT_TYPE = /\.headers\s*(?:\.get\s*\(\s*|\[\s*)["']content-type["']/i;

// A conditional that turns on it. Requiring the `if` (not just the literal)
// keeps a handler that merely *replies* in JSON from passing.
const GUARDS_ON_JSON = /^\s*(?:el)?if\b.*application\/json/;

// The handler body: every line indented deeper than its `def`, up to the first
// non-blank line that dedents back out.
function bodyOf(lines, defIndex, indent) {
  const body = [];
  for (let i = defIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') { body.push(line); continue; }
    const lead = line.length - line.trimStart().length;
    if (lead <= indent) break;
    body.push(line);
  }
  return body;
}

const rule = {
  id: 'on-device-privacy/json-content-type-guard',
  severity: 'blocking',
  description: 'Every mutating dashboard handler must reject non-application/json requests',
  doc: '.claudinite/local/packs/on-device-privacy/RULES.md',
  why: 'the dashboard has no authentication — the application/json content-type requirement is the only thing forcing a cross-origin browser to preflight, and so the only thing stopping any page the user visits from writing to their laugh log',

  run(ctx) {
    const out = [];
    for (const file of ctx.files.filter((f) => f.startsWith('laughcounter/') && f.endsWith('.py'))) {
      const text = ctx.read(file);
      if (text === null) continue;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        const m = MUTATING_HANDLER.exec(lines[i]);
        if (m === null) continue;
        const [, indentText, name] = m;
        const body = bodyOf(lines, i, indentText.length);
        const readsType = body.some((l) => READS_CONTENT_TYPE.test(l));
        const guards = body.some((l) => GUARDS_ON_JSON.test(l));
        if (readsType && guards) continue;
        out.push({
          rule: rule.id,
          severity: rule.severity,
          file,
          line: i + 1,
          what: `${name}() mutates without requiring an application/json content type`,
          why: rule.why,
          fix: 'read the request\'s Content-Type first and reply 415 unless it is application/json, before doing any work (see do_POST in laughcounter/dashboard.py)',
          doc: rule.doc,
        });
      }
    }
    return out;
  },
};

export default rule;
