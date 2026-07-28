// The dashboard is unauthenticated: nothing but the loopback bind stands between
// the LAN and the laugh log. The one thing that stands between a *hostile page in
// the user's browser* and the mutating endpoints is the `application/json`
// content-type requirement — a browser cannot send that cross-origin without a
// preflight, so requiring it is the dashboard's whole CSRF story. Every mutating
// http.server handler therefore has to reject a non-JSON content type, and reject
// it *before* it reads the request body or acts on it.
//
// Detection parses structure rather than grepping text: the handler's body is cut
// out by indentation, so the guard has to be inside the handler that needs it —
// `application/json` appears all over dashboard.py as a *response* content type,
// and a whole-file grep would happily accept those.
//
// Dependency-free by design (a local pack must load without the canon mount), so
// the finding object is built by hand rather than via the engine helper.

// BaseHTTPRequestHandler's mutating verbs. do_GET/do_HEAD are read-only and are
// deliberately out of scope.
const HANDLER = /^(\s*)def\s+(do_(?:POST|PUT|PATCH|DELETE))\s*\(/;

const READS_CONTENT_TYPE = /["']Content-Type["']/i;
const REQUIRES_JSON = /application\/json/;
const GUARD_WINDOW = 4;
// Consuming or dispatching the request — everything the guard must precede.
const CONSUMES_BODY = /\bself\.rfile\.read\b|\b_read_json\s*\(|\bjson\.loads\s*\(/;

const indentOf = (line) => line.length - line.trimStart().length;

// The handler's body: the run of lines indented deeper than its `def`.
const bodyOf = (lines, defIndex, defIndent) => {
  const body = [];
  for (let i = defIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') {
      body.push({ line, index: i });
      continue;
    }
    if (indentOf(line) <= defIndent) break;
    body.push({ line, index: i });
  }
  return body;
};

const rule = {
  id: 'on-device-privacy/json-content-type-guard',
  severity: 'blocking',
  description: 'Every mutating dashboard handler must require an application/json content type, before reading the body',
  doc: '.claudinite/local/packs/on-device-privacy/RULES.md',
  why: 'the dashboard has no authentication — the JSON content-type requirement is the only thing forcing a cross-origin browser to preflight, so dropping it hands any page the user visits a write handle on their laugh log',

  run(ctx) {
    const out = [];
    const add = (file, line, what, fix) =>
      out.push({ rule: rule.id, severity: rule.severity, file, line, what, why: rule.why, fix, doc: rule.doc });

    for (const file of ctx.files.filter((f) => f.startsWith('laughcounter/') && f.endsWith('.py'))) {
      const text = ctx.read(file);
      if (text === null) continue;
      const lines = text.split('\n');

      for (let i = 0; i < lines.length; i += 1) {
        const m = HANDLER.exec(lines[i]);
        if (m === null) continue;
        const [, indent, name] = m;
        const body = bodyOf(lines, i, indent.length);

        const guardAt = body.findIndex(
          (b, j) =>
            READS_CONTENT_TYPE.test(b.line)
            && body.slice(j, j + GUARD_WINDOW).some((w) => REQUIRES_JSON.test(w.line)),
        );
        if (guardAt === -1) {
          add(
            file,
            i + 1,
            `${name} never requires an application/json content type`,
            'read Content-Type and return 415 unless it is application/json, before touching the request body',
          );
          continue;
        }

        const consumesAt = body.findIndex((b) => CONSUMES_BODY.test(b.line));
        if (consumesAt !== -1 && consumesAt < guardAt) {
          add(
            file,
            body[consumesAt].index + 1,
            `${name} reads the request body before it checks the content type`,
            'move the application/json guard above the body read so a non-JSON request is rejected without being acted on',
          );
        }
      }
    }
    return out;
  },
};

export default rule;
