import { finding } from './findings.mjs';

// The declarative pattern-check engine: a rule whose whole logic is "these
// patterns over these files" is DECLARED as data — `patternRule(spec)` compiles
// the spec into an ordinary `{ id, severity, description, doc, why, run(ctx) }`
// rule module the runner treats like any other. The engine owns only the
// walking (the mechanism/policy line line-scanning.mjs draws): every pattern,
// file filter, and failure text stays in the declaring spec.
//
// Built for MANY such rules at once: however many pattern rules a run holds,
// the engine makes ONE pass over the scanned tree — each file is read once and
// its lines split once, with every subscribing rule's assertions evaluated in
// that single visit — and the per-context results are cached, so the first
// pattern rule the runner reaches pays for the whole family and the rest are
// lookups. Regexes must be non-global (`.test` on a /g regex is stateful).
//
// The spec vocabulary — everything beyond `files` is optional:
//   files      RegExp over repo paths, or one exact path (read directly)
//   over       'tracked' scans git-tracked files; default is ctx.files (the
//              run's scanned set — tracked+untracked minus vendored, and only
//              the changed files under --changed)
//   exclude    RegExp (or exact path) removing files from scope
//   gate       repo-level relevance, all parts must hold:
//                { exists, notExists }        a path present / absent
//                { tracked, notTracked }      some / no tracked path matches
//                { repoHas }                  some in-scope file's text matches —
//                                             evaluated only if findings exist
//   missing    { what, fix } — fires when an exact-path `files` is absent
//   maxLines   { limit, what, fix } — fires past `limit` lines, anchored there
//   skipLines  RegExp — lines it matches are invisible to `line` assertions
//   line       [{ match, unlessLine?, when?, unlessFile?, what, fix }]
//              flag each line `match` hits (unless `unlessLine` hits it too),
//              in files where every `when` matches and `unlessFile` does not;
//              per line, the first matching assertion wins
//   file       [{ gate?, if?, require?, forbid?, what, fix }]
//              one finding per file: where every `if` matches, `require` must
//              match / `forbid` must not (`if`/`when` take one RegExp or a list)
//   repo       [{ require, flag, excludeFlagged?, what, fix }]
//              unless some in-scope file matches `require`, flag every file
//              (minus `excludeFlagged`) satisfying a `flag` group — a list of
//              all-must-match RegExp lists — anchored at the first group's
//              first pattern's first matching line
//
// `what`/`fix` are plain strings; `{match}` interpolates the matched text on a
// `line` assertion, `{lines}`/`{limit}` the counts on `maxLines`.

const REGISTRY = [];
const scans = new WeakMap();

const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const fill = (tpl, vars) => tpl.replace(/\{(match|lines|limit)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
const excluded = (path, exclude) =>
  exclude != null && (exclude instanceof RegExp ? exclude.test(path) : path === exclude);

function gatePasses(ctx, gate) {
  if (!gate) return true;
  if (gate.exists && !ctx.exists(gate.exists)) return false;
  if (gate.notExists && ctx.exists(gate.notExists)) return false;
  if (gate.tracked && !ctx.tracked.some((f) => gate.tracked.test(f))) return false;
  if (gate.notTracked && ctx.tracked.some((f) => gate.notTracked.test(f))) return false;
  return true; // repoHas resolves after the pass, and only when findings exist
}

// One file visited once for every subscribing rule: file assertions and repo
// bookkeeping on the whole text, then a single walk of the lines shared by all
// the rules' line assertions.
function visit(ctx, subs, path, text) {
  let split = null;
  const lines = () => (split ??= text.split('\n'));
  const lineJobs = [];

  for (const j of subs) {
    const s = j.spec;
    if (s.maxLines && lines().length > s.maxLines.limit) {
      j.out.push(finding(j.rule, {
        file: path, line: s.maxLines.limit + 1,
        what: fill(s.maxLines.what, { lines: lines().length, limit: s.maxLines.limit }),
        fix: fill(s.maxLines.fix, { lines: lines().length, limit: s.maxLines.limit }),
      }));
    }
    for (const a of s.file ?? []) {
      if (a.gate && !gatePasses(ctx, a.gate)) continue;
      if (!arr(a.if).every((re) => re.test(text))) continue;
      if (a.forbid ? a.forbid.test(text) : !a.require.test(text)) {
        j.out.push(finding(j.rule, { file: path, what: a.what, fix: a.fix }));
      }
    }
    for (const st of j.repoStates) {
      if (st.a.require.test(text)) st.satisfied = true;
      if (excluded(path, st.a.excludeFlagged)) continue;
      const group = st.a.flag.find((g) => g.every((re) => re.test(text)));
      if (group) {
        const at = lines().findIndex((ln) => group[0].test(ln));
        st.hits.push({ file: path, line: at === -1 ? null : at + 1, what: st.a.what, fix: st.a.fix });
      }
    }
    const eligible = (s.line ?? []).filter((e) =>
      arr(e.when).every((re) => re.test(text)) && !e.unlessFile?.test(text));
    if (eligible.length) lineJobs.push({ j, eligible });
  }

  if (!lineJobs.length) return;
  lines().forEach((ln, i) => {
    for (const { j, eligible } of lineJobs) {
      if (j.spec.skipLines?.test(ln)) continue;
      for (const e of eligible) {
        const m = ln.match(e.match);
        if (!m || e.unlessLine?.test(ln)) continue;
        j.out.push(finding(j.rule, {
          file: path, line: i + 1, what: fill(e.what, { match: m[0] }), fix: fill(e.fix, { match: m[0] }),
        }));
        break;
      }
    }
  });
}

function results(ctx) {
  let res = scans.get(ctx);
  if (res) return res;
  res = new Map();
  scans.set(ctx, res);

  const jobs = [];
  for (const rule of REGISTRY) {
    const out = [];
    res.set(rule, out);
    if (!gatePasses(ctx, rule.spec.gate)) continue;
    jobs.push({
      rule, spec: rule.spec, out,
      repoStates: (rule.spec.repo ?? []).map((a) => ({ a, satisfied: false, hits: [] })),
    });
  }

  for (const j of jobs) {
    if (typeof j.spec.files !== 'string') continue;
    const text = ctx.read(j.spec.files);
    if (text === null) {
      if (j.spec.missing) {
        j.out.push(finding(j.rule, { file: j.spec.files, what: j.spec.missing.what, fix: j.spec.missing.fix }));
      }
      continue;
    }
    visit(ctx, [j], j.spec.files, text);
  }

  const swept = jobs.filter((j) => j.spec.files instanceof RegExp);
  if (swept.length) {
    const scanned = new Set(ctx.files);
    const tracked = new Set(ctx.tracked);
    for (const path of [...ctx.files, ...ctx.tracked.filter((f) => !scanned.has(f))]) {
      const subs = swept.filter((j) =>
        (j.spec.over === 'tracked' ? tracked : scanned).has(path) &&
        j.spec.files.test(path) && !excluded(path, j.spec.exclude));
      if (!subs.length) continue;
      const text = ctx.read(path);
      if (text !== null) visit(ctx, subs, path, text);
    }
  }

  for (const j of jobs) {
    for (const st of j.repoStates) {
      if (!st.satisfied) for (const h of st.hits) j.out.push(finding(j.rule, h));
    }
    const marker = j.spec.gate?.repoHas;
    if (marker && j.out.length &&
        !ctx.files.some((f) => !excluded(f, j.spec.exclude) && marker.test(ctx.read(f) ?? ''))) {
      j.out.length = 0;
    }
  }
  return res;
}

export function patternRule(spec) {
  const rule = {
    id: spec.id,
    severity: spec.severity,
    description: spec.description,
    doc: spec.doc,
    why: spec.why,
    spec,
    run(ctx) { return results(ctx).get(rule); },
  };
  REGISTRY.push(rule);
  return rule;
}
