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
// `none` is the empty precondition, legal only as the sole entry: any real
// condition beside it would be the actual precondition.
//
// THE VOCABULARY HAS TWO HOMES. The built-ins below are the movement and
// pending-PR conditions every repo shares. A task whose gate is its own ships a
// `preconditions.mjs` beside its `task.mjs` exporting `terms`, resolved after the
// built-ins in one flat namespace where a collision is loud — so the declaration
// and the gate it names are one directory apart.
//
// Import-light and pure over the signals: no I/O, so the same evaluation runs at
// the scheduler's anchor read and at the executor's pick.

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

// Parse a declaration into `{ kind: 'none' }`, `{ kind: 'conditions', conditions }`
// (each condition an array of alternatives), or `{ kind: 'invalid', reason }`.
// Names are not resolved here — that needs the task's own terms, which the
// static check and the evaluator each supply.
export function parsePreconditions(preconditions) {
  const invalid = (reason) => ({ kind: 'invalid', reason });
  if (!Array.isArray(preconditions) || preconditions.length === 0) {
    return invalid('it is not a non-empty array of condition strings');
  }
  if (!preconditions.every((e) => typeof e === 'string' && e.trim() !== '')) {
    return invalid('every entry must be a non-empty string');
  }
  const conditions = preconditions.map((entry) => String(entry).split(ALTERNATIVE).map(parseTerm));
  if (conditions.some((alts) => alts.some((t) => t.name === ''))) {
    return invalid(`an alternative around "${ALTERNATIVE}" is empty`);
  }
  if (conditions.flat().some((t) => t.name === NONE)) {
    if (preconditions.length !== 1 || conditions[0].length !== 1) {
      return invalid(`"${NONE}" is the empty precondition and is legal only as the sole entry — any real condition beside it would be the actual precondition`);
    }
    return { kind: NONE };
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

// Every signal the expression's terms read. This is what replaced the declared
// `precondition_signals`: the collector union can never disagree with what the
// gate actually consults, because it IS what the gate consults.
export function preconditionSignals(preconditions, taskTerms) {
  const parsed = parsePreconditions(preconditions);
  if (parsed.kind !== 'conditions') return [];
  const out = new Set();
  for (const ref of parsed.conditions.flat()) {
    for (const s of resolveTerm(ref.name, taskTerms)?.signals ?? []) out.add(s);
  }
  return [...out];
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
      `write a list of conditions, all of which must hold — e.g. ["substantive-change", "no-open-pr-titled:My sweep"] — or ["${NONE}"] for a task whose trigger is the calendar or the filed item itself`);
    return problems;
  }
  if (parsed.kind === NONE) return problems;
  for (const ref of parsed.conditions.flat()) {
    const term = resolveTerm(ref.name, taskTerms);
    if (!term) {
      bad(`"preconditions" names the unknown condition "${ref.name}"`,
        `use a built-in (${[...BUILTIN_TERMS.keys()].join(', ')}) or a term this task's preconditions.mjs exports`);
      continue;
    }
    if (term.takesArg && !ref.arg) {
      bad(`the precondition "${ref.name}" takes an inline argument and was given none`, `write it as "${ref.name}:<${term.argName ?? 'value'}>"`);
    }
    if (!term.takesArg && ref.arg !== null) {
      bad(`the precondition "${ref.name}" takes no argument but was given "${ref.arg}"`, `write it as "${ref.name}"`);
    }
  }
  return problems;
}

// --- the built-in vocabulary --------------------------------------------------
// A term is `{ signals, takesArg?, argName?, holds(signals, opts) }`, where
// `holds` returns `{ holds, reason?, context? }` or `{ error }`. `opts` carries
// the inline `arg`, the pack's `config`, this occurrence's `item` fields, and
// `windowDays` — the lookback the signals were collected over, which the
// dimensions with no windowed field of their own (the logs branch) need.
//
// EVERY MOVEMENT TERM IS NON-TASK BY CONSTRUCTION: the fields they read are
// already classified by the collectors, which drop a commit or a PR carrying the
// `Claudinite-Task:` trailer. That is the whole silence gate — a movement-gated
// task cannot be woken by another task's output, and no operator or marker says
// so in the declaration.

const commitsOf = (s) => s?.commits ?? {};
const touchedPaths = (s) => commitsOf(s).touchedPaths ?? [];
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
  // The positive umbrella over all four activity dimensions — what a
  // calendar-triggered task states when its value is zero on a repo nobody works
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
export function evaluatePreconditions({ preconditions, signals = {}, config = {}, item = null, terms = new Map(), windowDays = null }) {
  const parsed = parsePreconditions(preconditions);
  if (parsed.kind === 'invalid') return { error: `the "preconditions" declaration is not legal: ${parsed.reason}` };
  if (parsed.kind === NONE) {
    return { run: true, reason: 'this task states no precondition — its trigger is the calendar, or the work item somebody filed', context: [] };
  }

  const held = [];
  const context = [];
  let declined = null;
  for (const alternatives of parsed.conditions) {
    const outcomes = [];
    for (const ref of alternatives) {
      const term = resolveTerm(ref.name, terms);
      if (!term) return { error: `unknown precondition "${ref.name}" — no built-in and none this task's preconditions.mjs exports` };
      if (term.takesArg && !ref.arg) return { error: `the precondition "${ref.name}" takes an inline argument and was given none` };
      if (!term.takesArg && ref.arg !== null) return { error: `the precondition "${ref.name}" takes no argument but was given "${ref.arg}"` };
      // An unreadable signal is never a verdict: the term would be ruling on data
      // that was not there, and a decline taken that way is permanent silence.
      const unreadable = (term.signals ?? []).find((n) => signals?.[n]?.error);
      if (unreadable) return { error: `${ref.name}: the \`${unreadable}\` signal could not be read — ${signals[unreadable].error}` };
      let out;
      try { out = term.holds(signals, { arg: ref.arg, config, item, windowDays }) ?? {}; }
      catch (e) { return { error: `the precondition "${ref.name}" threw: ${e.message}` }; }
      if (out.error) return { error: `${ref.name}: ${out.error}` };
      outcomes.push({ ref, out });
    }
    const winner = outcomes.find((o) => o.out.holds === true);
    if (winner) {
      held.push(winner.out.reason ?? winner.ref.text);
      context.push(...(winner.out.context ?? []));
    } else if (declined === null) {
      declined = outcomes.map((o) => o.out.reason ?? `${o.ref.text} does not hold`).join('; nor ');
    }
  }
  return declined === null
    ? { run: true, reason: held.join('; '), context }
    : { run: false, reason: declined };
}
