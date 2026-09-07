// The precondition engine (task-preconditions DESIGN): may THIS task run now? A
// task declares `preconditions` — a list of named conditions — and this module
// turns that declaration plus the collected signals into a verdict. Sibling of
// merge-policy.mjs beside it, and deliberately its mirror image in two ways:
//
//   THE LIST IS A CONJUNCTION. `['X', 'Y || Z']` is `X && (Y || Z)`. An automerge
//   policy GRANTS, so its comma is a union; preconditions REQUIRE, so the comma
//   is `&&` and `||` lives inside one entry. Each field then reads against its
//   own English.
//
//   IT FAILS LOUD, NOT CLOSED. An unresolvable merge policy authorizes nothing,
//   which parks a PR in front of a person. An unresolvable precondition that
//   declined would be permanent, silent staleness — nothing goes red when a task
//   stops running — so an unknown term, a malformed argument or an unreadable
//   signal returns `{ error }`, a failed run in the queue's failure lane.
//
// THE EXPRESSION IS WHAT MUST HOLD, NEVER WHO ASKS (tasks-dispatch DESIGN §5). The
// engine keeps no calendar: every scheduler tick asks every task whose declaration
// says `trigger: 'schedule'`, and the cadence such a task keeps is one of its own
// conditions, read off its own run history — `due:<cadence>`,
// `last-run-over:<duration>` — beside whatever else it requires. The same
// conditions are judged, identically, at the pick of an item somebody created, so
// this module never asks which of the two happened. `none` is retired: a task with
// nothing to require states no condition, and the empty expression holds.
//
// THE VOCABULARY HAS TWO HOMES. The built-ins below are the run-history, movement
// and pending-PR conditions every repo shares. A task whose gate is its own ships a
// `preconditions.mjs` beside its `task.json` exporting `terms`, resolved after the
// built-ins in one flat namespace where a collision is loud — so the declaration
// and the gate it names are one directory apart.
//
// Import-light and pure over the signals: no I/O, so the same evaluation runs at
// the scheduler's tick and at the executor's pick.

import { anchorInstant, CADENCES, DUE_TERM, ELAPSED_TERM, NOT_FAILED_TERM, parseDuration } from './calendar.mjs';

// The retired empty precondition. The contract's door still strips it from a
// declaration that carries a `frequency` (the cadence term takes its place); on
// its own it is an error, named below.
export const NONE = 'none';

const ALTERNATIVE = '||';

// How many paths or numbers a term's context names before it says how many it
// dropped. A window can carry more files than one session should read, and a
// silently truncated list reads as the whole window.
export const MAX_CONTEXT_ITEMS = 40;

// --- the grammar --------------------------------------------------------------

// One term reference: its name, and the inline argument after its first colon
// (`commits-under:.claudinite/local`). The rest of the string is the argument
// verbatim, so a path argument may itself contain colons.
function parseTerm(text) {
  const raw = String(text ?? '').trim();
  const colon = raw.indexOf(':');
  return colon === -1
    ? { name: raw, arg: null, text: raw }
    : { name: raw.slice(0, colon).trim(), arg: raw.slice(colon + 1).trim(), text: raw };
}

// Parse a declaration into `{ kind: 'conditions', conditions }` (each condition an
// array of alternatives) or `{ kind: 'invalid', reason }`. Names are not resolved
// here — that needs the task's own terms, which the static check and the
// evaluator each supply.
export function parsePreconditions(preconditions) {
  const invalid = (reason) => ({ kind: 'invalid', reason });
  if (!Array.isArray(preconditions)) {
    return invalid('it is not an array of condition strings');
  }
  if (!preconditions.every((e) => typeof e === 'string' && e.trim() !== '')) {
    return invalid('every entry must be a non-empty string');
  }
  const conditions = preconditions.map((entry) => String(entry).split(ALTERNATIVE).map(parseTerm));
  if (conditions.some((alts) => alts.some((t) => t.name === ''))) {
    return invalid(`an alternative around "${ALTERNATIVE}" is empty`);
  }
  if (conditions.flat().some((t) => t.name === NONE)) {
    return invalid(`"${NONE}" is retired — a task with no condition states none: leave "preconditions" out, and the task runs only from an item somebody creates. Otherwise state when it runs: a cadence (\`${DUE_TERM}:daily\`, \`${ELAPSED_TERM}:7d\`) or the movement it waits for`);
  }
  return { kind: 'conditions', conditions };
}

// The task's own terms, as a Map, from whatever its `preconditions.mjs` exported.
// A non-object export is no terms at all rather than a crash; the shape check is
// what reports it.
export function termsMap(exported) {
  if (exported instanceof Map) return exported;
  if (exported && typeof exported === 'object') return new Map(Object.entries(exported));
  return new Map();
}

// Resolve a term name: built-ins first, then the task's own.
export const resolveTerm = (name, taskTerms) => BUILTIN_TERMS.get(name) ?? taskTerms?.get?.(name) ?? null;

// --- the signal union, derived ------------------------------------------------

// Every signal the expression's terms read. The collector union cannot disagree
// with what the gate actually consults, because it IS what the gate consults —
// which a separately declared list could not guarantee.
export function preconditionSignals(preconditions, taskTerms) {
  const parsed = parsePreconditions(preconditions);
  if (parsed.kind !== 'conditions') return [];
  const out = new Set();
  for (const ref of parsed.conditions.flat()) {
    for (const s of resolveTerm(ref.name, taskTerms)?.signals ?? []) out.add(s);
  }
  return [...out];
}

// Whether the expression reads the item itself — a term declaring `needsItem`
// (the request implementer's `request-eligible`, about one named issue). The
// scheduler's own ask has no item, so there is nothing to judge such a task
// against at a tick: it runs only from an item somebody created.
export function preconditionNeedsItem(preconditions, taskTerms) {
  const parsed = parsePreconditions(preconditions);
  if (parsed.kind !== 'conditions') return false;
  return parsed.conditions.flat().some((ref) => resolveTerm(ref.name, taskTerms)?.needsItem === true);
}

// --- static validation --------------------------------------------------------

// Everything about a declaration that is decidable without signals: the grammar,
// the term names, their arguments, and a task-local term shadowing a built-in.
// Returns `{ what, fix }` problems — empty means well-formed.
export function validatePreconditions(preconditions, taskTerms = new Map()) {
  const problems = [];
  const bad = (what, fix) => problems.push({ what, fix });
  for (const name of taskTerms.keys?.() ?? []) {
    if (BUILTIN_TERMS.has(name)) {
      bad(`the task's preconditions.mjs redefines the built-in term "${name}"`,
        `rename the task-local term — the term namespace is flat, and the built-ins are: ${[...BUILTIN_TERMS.keys()].join(', ')}`);
    }
  }
  const parsed = parsePreconditions(preconditions);
  if (parsed.kind === 'invalid') {
    bad(`"preconditions" is not a legal expression: ${parsed.reason}`,
      `write a list of conditions, all of which must hold — a cadence first where the task keeps one ("${DUE_TERM}:<daily|weekly|monthly>" or "${ELAPSED_TERM}:<12h|1d|7d>"), then what it waits for, e.g. ["${DUE_TERM}:weekly", "substantive-change", "no-open-pr-titled:My sweep"]; a task that runs only from an item somebody creates states no "preconditions" at all`);
    return problems;
  }
  for (const ref of parsed.conditions.flat()) {
    const term = resolveTerm(ref.name, taskTerms);
    if (!term) {
      bad(`"preconditions" names the unknown condition "${ref.name}"`,
        `use a built-in (${[...BUILTIN_TERMS.keys()].join(', ')}) or a term this task's preconditions.mjs exports`);
      continue;
    }
    const argProblem = argumentProblem(term, ref);
    if (argProblem) bad(argProblem.what, argProblem.fix);
  }
  return problems;
}

// A term's argument, judged statically: present where it takes one, absent where
// it does not, and — for a term that names its legal values — one of them. The
// evaluator asks the same question, so an author-time finding and a run-time
// error can never disagree about a declaration.
function argumentProblem(term, ref) {
  if (term.takesArg && !ref.arg) {
    return { what: `the precondition "${ref.name}" takes an inline argument and was given none`, fix: `write it as "${ref.name}:<${term.argName ?? 'value'}>"` };
  }
  if (!term.takesArg && ref.arg !== null) {
    return { what: `the precondition "${ref.name}" takes no argument but was given "${ref.arg}"`, fix: `write it as "${ref.name}"` };
  }
  if (term.takesArg && term.argOk && !term.argOk(ref.arg)) {
    return { what: `"${ref.name}" takes ${term.argHint}, not "${ref.arg}"`, fix: `write it as "${ref.name}:<${term.argName ?? 'value'}>" — ${term.argHint}` };
  }
  return null;
}

// --- the built-in vocabulary --------------------------------------------------
// A term is `{ signals, takesArg?, argName?, holds(signals, opts) }`, where
// `holds` returns `{ holds, reason?, context? }` or `{ error }`. `opts` carries
// the inline `arg`, the pack's `config`, this occurrence's `item` fields,
// `windowDays` — the lookback the signals were collected over, which the
// dimensions with no windowed field of their own (the logs branch) need — and
// `now`, the instant this verdict is being taken at.
//
// `now` is passed rather than read, because a term whose subject IS the instant
// ("are we inside the festival month") has nothing in the signal bundle to read:
// a term reaching for the process clock would be untestable at a chosen moment
// and impure, in the one module that promises to be neither. Both callers already
// hold the instant they are deciding for, so passing it costs nothing and keeps
// every term a pure function of its inputs.
//
// EVERY MOVEMENT TERM IS NON-TASK BY CONSTRUCTION: the fields they read are
// already classified by the collectors, which drop a commit or a PR carrying the
// `Claudinite-Task:` trailer. That is the whole silence gate — a movement-gated
// task cannot be woken by another task's output, and no operator or marker says
// so in the declaration.

const commitsOf = (s) => s?.commits ?? {};
const touchedPaths = (s) => commitsOf(s).touchedPaths ?? [];

// THE RUN HISTORY: this task's own unqualified work items, newest first, other
// than the item under evaluation — what the `runs` collector reads off the issue
// list over a fixed horizon. Each `{ number, createdAt, closedAt, state, status,
// park, outcome }`. The engine keeps no other memory of a task: the queue IS the
// record, which is why a renamed task simply reads as never having run.
const runsOf = (s) => s?.runs?.list ?? [];
const newestRun = (s) => runsOf(s)[0] ?? null;
const ms = (t) => (t == null ? null : new Date(t).getTime());
const ago = (fromMs, nowMs) => {
  const h = Math.round((nowMs - fromMs) / 3600e3);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
};

// A person's wake stands in for the cadence: the cadence terms hold on a woken
// item, and everything else the task requires still applies, so a force that
// finds no work still says so.
const wokenReason = (item) => (item?.woken === true
  ? { holds: true, reason: `#${item.number ?? '?'} was woken by hand — the wake stands in for the cadence` }
  : null);
const substantiveShas = (s) => (commitsOf(s).list ?? []).filter((c) => c.substantive).map((c) => c.sha.slice(0, 7));

// A capped list plus what it dropped — the shape every scope-naming context uses.
const cappedContext = (items, lead, dropTail) => {
  const scope = items.slice(0, MAX_CONTEXT_ITEMS);
  const dropped = items.length - scope.length;
  return [
    `${lead}: ${scope.join(', ')}.`,
    ...(dropped ? [`${dropped} further ${dropTail}`] : []),
  ];
};

// The scheduler's own work items wear a `task:*` label for their whole life. The
// issues collector hides them by title, so one filed under any other title still
// reaches here; the label is the invariant, and it filters BOTH ways — such an
// issue is neither a touch that triggers a run nor a target inside one.
const nonTaskIssues = (s) => {
  const open = (s?.issues?.open ?? []).filter((i) => !(i.labels ?? []).some((l) => String(l).startsWith('task:')));
  const inScope = new Set(open.map((i) => i.number));
  return { open, touched: (s?.issues?.touched ?? []).filter((n) => inScope.has(n)) };
};

const capturedInWindow = (s, windowDays) => {
  const age = s?.conversationLogs?.newestLogAgeDays;
  if (typeof windowDays !== 'number') return { error: 'the lookback window is unknown, so "a session captured in the window" cannot be decided' };
  // null/undefined is UNKNOWN — no branch, or no readable stamp — which is not movement.
  return { holds: typeof age === 'number' && age <= windowDays };
};

const openPrs = (s) => s?.prs?.open ?? [];

const BUILTIN_TERMS = new Map(Object.entries({
  // --- the run-history terms (tasks-dispatch DESIGN §5) ----------------------
  // Judged before any other signal is collected — the `runs` bundle comes off the
  // issue list the scheduler already holds — so a task whose cadence declines
  // costs no read at all on the ticks it does not run.

  // No run since the cadence's most recent anchor on this repo's schedule. Both
  // halves of the old occurrence guard: an item CREATED since the anchor is this
  // period's, and so is one CLOSED since it — an item that started before the
  // anchor and ran past it consumed this period, and a second one is a double run.
  [DUE_TERM]: {
    signals: ['runs'],
    takesArg: true,
    argName: 'daily|weekly|monthly',
    argOk: (arg) => CADENCES.includes(arg),
    argHint: `one of ${CADENCES.join(', ')}`,
    holds(s, { arg, item, now, schedule }) {
      const woken = wokenReason(item);
      if (woken) return woken;
      // The instant is the caller's to supply (a term never reads the clock); the
      // schedule falls back to the documented defaults the way every anchor read does.
      if (ms(now) === null || Number.isNaN(ms(now))) return { error: `${DUE_TERM}:${arg} has no instant to anchor on — the caller supplied no \`now\`` };
      const anchor = anchorInstant(arg, schedule ?? {}, now);
      const anchorMs = anchor.getTime();
      const since = runsOf(s).find((r) => (ms(r.createdAt) ?? -Infinity) >= anchorMs || (ms(r.closedAt) ?? -Infinity) >= anchorMs);
      return since
        ? { holds: false, reason: `#${since.number} already ran since the ${arg} anchor at ${anchor.toISOString()}` }
        : { holds: true, reason: `no run since the ${arg} anchor at ${anchor.toISOString()}` };
    },
  },

  // The newest run STARTED more than the duration ago — an item's creation is when
  // the task was last asked and said yes. No run in the horizon holds: the task
  // has not run in longer than any duration this term can state.
  [ELAPSED_TERM]: {
    signals: ['runs'],
    takesArg: true,
    argName: '12h|1d|7d',
    argOk: (arg) => parseDuration(arg) !== null,
    argHint: 'a whole number of hours or days, e.g. 12h, 1d, 7d',
    holds(s, { arg, item, now }) {
      const woken = wokenReason(item);
      if (woken) return woken;
      const newest = newestRun(s);
      if (!newest) return { holds: true, reason: `no run of this task in the last ${s?.runs?.horizonDays ?? '?'} days` };
      const nowMs = ms(now);
      const startedMs = ms(newest.createdAt);
      if (nowMs === null || startedMs === null) return { error: `${ELAPSED_TERM}:${arg} cannot measure — the instant or #${newest.number}'s start is unknown` };
      return nowMs - startedMs > parseDuration(arg)
        ? { holds: true, reason: `the newest run, #${newest.number}, started ${ago(startedMs, nowMs)} ago — over ${arg}` }
        : { holds: false, reason: `the newest run, #${newest.number}, started ${ago(startedMs, nowMs)} ago, inside ${arg}` };
    },
  },

  // Whether a failed run stops the next one is the task's to say, and only by
  // stating this: absent, the next occurrence is filed beside the park. Only the
  // newest run speaks — a failure behind a later clean run is history.
  [NOT_FAILED_TERM]: {
    signals: ['runs'],
    holds(s) {
      const newest = newestRun(s);
      if (!newest) return { holds: true, reason: 'no run of this task to have failed' };
      return newest.park === 'failure'
        ? { holds: false, reason: `the newest run, #${newest.number}, stands at a failure park — this task declares it does not run past its own failure` }
        : { holds: true, reason: `the newest run, #${newest.number}, did not fail` };
    },
  },

  // --- the movement terms -----------------------------------------------------
  // The positive umbrella over all four activity dimensions — what a
  // cadence-triggered task states when its value is zero on a repo nobody works
  // in. The first active window resumes it.
  'repo-active': {
    signals: ['commits', 'issues', 'prs', 'conversationLogs'],
    holds(s, { windowDays }) {
      const captured = capturedInWindow(s, windowDays);
      if (captured.error) return captured;
      const moved = [];
      if (commitsOf(s).substantiveChange === true) moved.push('a substantive commit landed');
      if (nonTaskIssues(s).touched.length) moved.push(`${nonTaskIssues(s).touched.length} issue(s) moved`);
      if ((s?.prs?.touched ?? []).length) moved.push(`${(s.prs.touched ?? []).length} open PR(s) moved`);
      if (captured.holds) moved.push('a session was captured');
      return moved.length
        ? { holds: true, reason: `the repo was active in the window — ${moved.join(', ')}` }
        : { holds: false, reason: 'the repo was silent in the window — no substantive commit, no issue or PR of its own moved, and no session was captured' };
    },
  },

  'substantive-change': {
    signals: ['commits'],
    holds(s) {
      // The collector's own verdict is the condition — it is where a commit is
      // classified, trailer and all. The sha list is only what the context names,
      // and a collector that could not detail the commits still answers the gate.
      if (commitsOf(s).substantiveChange !== true) {
        return { holds: false, reason: 'no substantive default-branch change in the window' };
      }
      const shas = substantiveShas(s);
      return {
        holds: true,
        reason: `${shas.length || 'a'} substantive default-branch commit(s) in the window`,
        context: shas.length ? cappedContext(shas, 'Substantive commits in the window', 'commit(s) are not named here.') : [],
      };
    },
  },

  // Task-authored movement included, deliberately: for the tasks that measure the
  // machinery itself rather than the project.
  'any-commit': {
    signals: ['commits'],
    holds(s) {
      const count = commitsOf(s).count ?? 0;
      return count > 0
        ? { holds: true, reason: `${count} default-branch commit(s) in the window` }
        : { holds: false, reason: 'no default-branch commit in the window' };
    },
  },

  'session-captured': {
    signals: ['conversationLogs'],
    holds(s, { windowDays }) {
      const captured = capturedInWindow(s, windowDays);
      if (captured.error) return captured;
      return captured.holds
        ? { holds: true, reason: 'a conversation log was captured in the window' }
        : { holds: false, reason: 'no conversation log was captured in the window' };
    },
  },

  'issues-touched': {
    signals: ['issues'],
    holds(s) {
      const { touched } = nonTaskIssues(s);
      return touched.length
        ? { holds: true, reason: `${touched.length} issue(s) moved in the window`, context: cappedContext(touched.map((n) => `#${n}`), 'Issues touched in the window', 'touched issue(s) are not named here.') }
        : { holds: false, reason: 'no issue of this repo\'s own moved in the window' };
    },
  },

  'prs-touched': {
    signals: ['prs'],
    holds(s) {
      const touched = s?.prs?.touched ?? [];
      return touched.length
        ? { holds: true, reason: `${touched.length} open PR(s) moved in the window`, context: cappedContext(touched.map((n) => `#${n}`), 'PRs opened or updated in the window', 'moved PR(s) are not named here.') }
        : { holds: false, reason: 'no open PR was opened or updated in the window' };
    },
  },

  'mount-moved': {
    signals: ['sharedMount'],
    holds(s) {
      const packs = s?.sharedMount?.changedPacks ?? [];
      return packs.length
        ? { holds: true, reason: `declared pack(s) changed in the mounted canon: ${packs.join(', ')}`, context: [`Canon packs that changed in the window: ${packs.join(', ')}.`] }
        : { holds: false, reason: 'no declared pack\'s vendored files changed in the window' };
    },
  },

  'commits-under': {
    signals: ['commits'],
    takesArg: true,
    argName: 'path-prefix',
    holds(s, { arg }) {
      const under = touchedPaths(s).filter((p) => p.startsWith(arg));
      return under.length
        ? { holds: true, reason: `${under.length} path(s) under ${arg} changed in the window`, context: cappedContext(under, `Paths under ${arg} that changed in the window`, `path(s) under ${arg} are not named here.`) }
        : { holds: false, reason: `no path under ${arg} changed in the window` };
    },
  },

  'commits-outside': {
    signals: ['commits'],
    takesArg: true,
    argName: 'path-prefix',
    holds(s, { arg }) {
      const outside = touchedPaths(s).filter((p) => !p.startsWith(arg));
      return outside.length
        ? {
          holds: true,
          reason: `${outside.length} path(s) outside ${arg} changed in the window`,
          context: cappedContext(outside, `Paths outside ${arg} that changed in the window — work exactly these, and no others`,
            `path(s) changed in the window and are NOT in scope this round — say so in the wrap-up, so it is not read as a full sweep.`),
        }
        : { holds: false, reason: `nothing outside ${arg} changed in the window` };
    },
  },

  // The two pending-round conditions. Both exist so an unreviewed round is never
  // stacked on one already in flight, which is why an open PR whose paths could
  // not be read counts as PENDING: unknown is not clear.
  'no-open-pr-touching': {
    signals: ['prs'],
    takesArg: true,
    argName: 'path-prefix',
    holds(s, { arg }) {
      const pending = openPrs(s).find((p) => Array.isArray(p.changedPaths) && p.changedPaths.some((f) => f.startsWith(arg)));
      if (pending) return { holds: false, reason: `PR #${pending.number} has a pending ${arg} change — this round waits for its review rather than stack a second unreviewed one on it` };
      const opaque = openPrs(s).find((p) => !Array.isArray(p.changedPaths));
      if (opaque) return { holds: false, reason: `PR #${opaque.number}'s changed paths could not be read, so whether a ${arg} change is pending is unknown — a skipped round is cheaper than an unreviewed one stacked on it` };
      return { holds: true, reason: `no open PR changes a path under ${arg}` };
    },
  },

  'no-open-pr-titled': {
    signals: ['prs'],
    takesArg: true,
    argName: 'title-prefix',
    holds(s, { arg }) {
      const pending = openPrs(s).find((p) => String(p.title ?? '').startsWith(arg));
      return pending
        ? { holds: false, reason: `PR #${pending.number} is this pass's previous round, still open — this round waits for it to land rather than stack a second sweep on it` }
        : { holds: true, reason: `no open PR titled "${arg}…" — the previous round has landed` };
    },
  },
}));

export const BUILTIN_TERM_NAMES = [...BUILTIN_TERMS.keys()];

// --- the verdict --------------------------------------------------------------

// Evaluate a declaration over collected signals. Returns `{ run, reason, context }`
// — or `{ error }`, which is a failed run rather than a decline.
//
// `schedule` is the repo's `taskScheduler` anchor settings, which `due:` reads.
//
// PARTIAL MODE (`partial: true`) judges what the bundle so far can decide: a term
// whose signal has not been collected is UNKNOWN rather than false, a conjunct
// with an unknown alternative and no held one stays open, and the verdict is `{
// run: null, undecided: true, missing }` unless some conjunct is already decided
// false — a decline that cost nothing beyond the run history — or every conjunct
// held. The scheduler asks this way first, with the `runs` bundle alone, so a
// task whose cadence declines never collects its other signals. In full mode a
// missing signal is a term that does not hold, as it always was.
export function evaluatePreconditions({
  preconditions, signals = {}, config = {}, item = null, terms = new Map(), windowDays = null, now = null,
  schedule = null, partial = false,
}) {
  const parsed = parsePreconditions(preconditions);
  if (parsed.kind === 'invalid') return { error: `the "preconditions" declaration is not legal: ${parsed.reason}` };

  const held = [];
  const context = [];
  const missing = new Set();
  let declined = null;
  let undecided = false;
  for (const alternatives of parsed.conditions) {
    const outcomes = [];
    let unknown = false;
    for (const ref of alternatives) {
      const term = resolveTerm(ref.name, terms);
      if (!term) return { error: `unknown precondition "${ref.name}" — no built-in and none this task's preconditions.mjs exports` };
      const argProblem = argumentProblem(term, ref);
      if (argProblem) return { error: argProblem.what };
      // An unreadable signal is never a verdict: the term would be ruling on data
      // that was not there, and a decline taken that way is permanent silence.
      const unreadable = (term.signals ?? []).find((n) => signals?.[n]?.error);
      if (unreadable) return { error: `${ref.name}: the \`${unreadable}\` signal could not be read — ${signals[unreadable].error}` };
      if (partial) {
        const absent = (term.signals ?? []).filter((n) => signals?.[n] === undefined);
        if (absent.length) { absent.forEach((n) => missing.add(n)); unknown = true; continue; }
      }
      let out;
      try { out = term.holds(signals, { arg: ref.arg, config, item, windowDays, now, schedule }) ?? {}; }
      catch (e) { return { error: `the precondition "${ref.name}" threw: ${e.message}` }; }
      if (out.error) return { error: `${ref.name}: ${out.error}` };
      outcomes.push({ ref, out });
    }
    const winner = outcomes.find((o) => o.out.holds === true);
    if (winner) {
      held.push(winner.out.reason ?? winner.ref.text);
      context.push(...(winner.out.context ?? []));
    } else if (unknown) {
      undecided = true;
    } else if (declined === null) {
      declined = outcomes.map((o) => o.out.reason ?? `${o.ref.text} does not hold`).join('; nor ');
    }
  }
  if (declined !== null) return { run: false, reason: declined };
  if (undecided) return { run: null, undecided: true, missing: [...missing] };
  return { run: true, reason: held.length ? held.join('; ') : 'no conditions stated — the item itself is the ask', context };
}
