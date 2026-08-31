// The coded production-validation grammar and judgment (#1530) — pure, no I/O.
// A verification issue states declarative PROBES on its first lines, each one
// URL and one assertion, in two classes with distinct failure meanings:
//
//   Live-probe:   <url> :: <assertion>   — the liveness gate. Any failing means
//                                          the release has not landed: the run
//                                          re-arms and comes back, and nothing
//                                          is judged.
//   Verify-probe: <url> :: <assertion>   — the verification itself, judged only
//                                          once every liveness probe passes. Any
//                                          failing is a real fault in production.
//
// Both classes are REQUIRED: without a liveness gate a verify failure cannot be
// told from a release that simply has not happened, and would reopen the
// original issue over nothing.
//
// Assertions, after the `::`:
//   status <n>                       the response code itself (the one op a
//                                    non-2xx response can pass)
//   [not ]contains <text>            body carries the literal text
//   [not ]matches /<re>/[flags]      body matches the JS regex
//   json <path> exists               dotted path resolves to a value
//   json <path> == <value>           strict-deep equality with the JSON value
//   json <path> != <value>           its negation
//   json <path> >= <value>           dotted identifiers compared segment-wise
//                                    numeric — '60821.10' is ten past '60821.3',
//                                    where floats and string order both lie

export const LIVE_FIELD = 'Live-probe';
export const VERIFY_FIELD = 'Verify-probe';
export const RETRY_FIELD = 'Retry-every';
export const ORIGINAL_FIELD = 'Original-issue';

const UNIT_MS = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 7 * 86_400_000 };

// `<count> <unit>` and nothing else. Null for anything unreadable — absence is a
// problem the caller names, never a default cadence nobody chose.
export function parseRetryEvery(text) {
  const m = /^(\d+)\s*(minute|hour|day|week)s?$/i.exec(String(text ?? '').trim());
  return m ? Number(m[1]) * UNIT_MS[m[2].toLowerCase()] : null;
}

// One assertion, or null for a line that reads as none. Values after json ops are
// JSON literals; one that does not parse is taken as a bare string, so
// `== fleet` and `== "fleet"` assert the same thing.
export function parseAssertion(text) {
  const s = String(text ?? '').trim();
  let m;
  if ((m = /^status\s+(\d{3})$/.exec(s))) return { op: 'status', status: Number(m[1]) };
  if ((m = /^(not\s+)?contains\s+(.+)$/.exec(s))) {
    return { op: 'contains', negate: !!m[1], text: m[2] };
  }
  if ((m = /^(not\s+)?matches\s+\/(.*)\/([a-z]*)$/.exec(s))) {
    try {
      // Compiled here so an unreadable pattern is a parse problem, not a run crash.
      void new RegExp(m[2], m[3]);
    } catch { return null; }
    return { op: 'matches', negate: !!m[1], source: m[2], flags: m[3] };
  }
  if ((m = /^json\s+(\S+)\s+exists$/.exec(s))) return { op: 'json-exists', path: m[1] };
  if ((m = /^json\s+(\S+)\s+(==|!=|>=)\s+(.+)$/.exec(s))) {
    const raw = m[3].trim();
    let value;
    try { value = JSON.parse(raw); } catch { value = raw; }
    const op = { '==': 'json-eq', '!=': 'json-ne', '>=': 'json-gte' }[m[2]];
    return { op, path: m[1], value };
  }
  return null;
}

// Dotted identifiers compared segment-wise numeric, a missing segment counting
// zero. Kept string-typed end to end — '60820.10' and '60820.1' are different
// versions and the same float. A non-numeric segment falls back to string order
// for that segment.
export function compareDotted(a, b) {
  const as = String(a).split('.');
  const bs = String(b).split('.');
  for (let i = 0; i < Math.max(as.length, bs.length); i += 1) {
    const [x, y] = [as[i] ?? '0', bs[i] ?? '0'];
    const [nx, ny] = [Number(x), Number(y)];
    const cmp = Number.isNaN(nx) || Number.isNaN(ny)
      ? x.localeCompare(y)
      : nx - ny;
    if (cmp !== 0) return cmp < 0 ? -1 : 1;
  }
  return 0;
}

const dig = (value, path) => path.split('.').reduce(
  (v, seg) => (v !== null && typeof v === 'object' ? v[seg] : undefined), value);

const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Judge one assertion against one response ({ status, body }). Returns
// { ok, observed } — the observation is what was actually read, which is the
// evidence half of every verdict this task reports.
export function evaluateAssertion(assertion, { status, body }) {
  if (assertion.op === 'status') {
    return { ok: status === assertion.status, observed: `HTTP ${status}` };
  }
  if (status < 200 || status >= 300) return { ok: false, observed: `HTTP ${status}` };
  if (assertion.op === 'contains') {
    const found = body.includes(assertion.text);
    return { ok: found !== assertion.negate, observed: found ? 'text present' : 'text absent' };
  }
  if (assertion.op === 'matches') {
    const found = new RegExp(assertion.source, assertion.flags).test(body);
    return { ok: found !== assertion.negate, observed: found ? 'pattern present' : 'pattern absent' };
  }
  // The json ops.
  let parsed;
  try { parsed = JSON.parse(body); } catch { return { ok: false, observed: 'body is not JSON' }; }
  const actual = dig(parsed, assertion.path);
  const observed = actual === undefined ? `${assertion.path} absent` : `read ${JSON.stringify(actual)}`;
  if (assertion.op === 'json-exists') return { ok: actual !== undefined, observed };
  if (actual === undefined) return { ok: assertion.op === 'json-ne', observed };
  if (assertion.op === 'json-eq') return { ok: deepEq(actual, assertion.value), observed };
  if (assertion.op === 'json-ne') return { ok: !deepEq(actual, assertion.value), observed };
  return { ok: compareDotted(actual, assertion.value) >= 0, observed };
}

// Parse a verification issue's human text into the spec the worker runs. Every
// gap or unreadable line is a PROBLEM by name — the item then parks with the
// list rather than half-running a spec that silently dropped a probe.
export function parseVerificationSpec(text) {
  const problems = [];
  const live = [];
  const verify = [];
  const probeRe = new RegExp(`^(${LIVE_FIELD}|${VERIFY_FIELD}):[ \\t]*(.*)$`, 'gm');
  for (const m of String(text ?? '').matchAll(probeRe)) {
    const [field, rest] = [m[1], m[2].trim()];
    const parts = /^(\S+)\s*::\s*(.+)$/.exec(rest);
    const url = parts?.[1] ?? null;
    const assertion = parts ? parseAssertion(parts[2]) : null;
    if (!url || !/^https?:\/\//.test(url) || !assertion) {
      problems.push(`unreadable ${field} line: \`${rest}\` — expected \`https://… :: <assertion>\``);
      continue;
    }
    (field === LIVE_FIELD ? live : verify).push({ url, assertion, raw: parts[2].trim() });
  }
  const originalIssue = (() => {
    const m = new RegExp(`^${ORIGINAL_FIELD}:[ \\t]*#?(\\d+)`, 'm').exec(String(text ?? ''));
    return m ? Number(m[1]) : null;
  })();
  const retryRaw = new RegExp(`^${RETRY_FIELD}:[ \\t]*(.+)$`, 'm').exec(String(text ?? ''))?.[1]?.trim() ?? null;
  const retryEveryMs = parseRetryEvery(retryRaw);

  if (!live.length) problems.push(`no ${LIVE_FIELD}: line — without a liveness gate, "not deployed yet" and "deployed and broken" are indistinguishable`);
  if (!verify.length) problems.push(`no ${VERIFY_FIELD}: line — nothing would be verified`);
  if (!originalIssue) problems.push(`no ${ORIGINAL_FIELD}: line — a failing verification would have nowhere to land`);
  if (!retryEveryMs) problems.push(`no readable ${RETRY_FIELD}: line — expected \`<count> <minutes|hours|days|weeks>\``);
  return { originalIssue, retryEveryMs, retryRaw, live, verify, problems };
}

// Run one probe class. Each URL is fetched ONCE however many probes read it;
// `fetchUrl(url)` resolves to { status, body } or throws, and a throw fails the
// probe with the error as its observation rather than the run.
export async function runProbes(probes, fetchUrl) {
  const responses = new Map();
  const results = [];
  for (const probe of probes) {
    if (!responses.has(probe.url)) {
      responses.set(probe.url, await fetchUrl(probe.url).catch((e) => ({ error: e.message })));
    }
    const response = responses.get(probe.url);
    results.push(response.error
      ? { probe, ok: false, observed: `fetch failed: ${response.error}` }
      : { probe, ...evaluateAssertion(probe.assertion, response) });
  }
  return results;
}

export const renderResult = ({ probe, ok, observed }) =>
  `${ok ? 'PASS' : 'FAIL'} — ${probe.url} :: ${probe.raw} — ${observed}`;
