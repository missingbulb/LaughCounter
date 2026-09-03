// The auto-merge policy engine (tasks-dispatch DESIGN §16.11): may THIS diff land
// without a person? A task declares `automerge` — `'nothing'`, `'anything'`,
// or a list of named diff classes — and this module turns that declaration plus
// the branch's actual diff into a verdict. The call is arithmetic over the diff,
// never the session's opinion of its own work: a run cannot talk its way past a
// text comparison (the narrow-diff posture, generalized).
//
// WHAT A POLICY IS FOR. A policy is its author's PREDICTION of the change's
// shape — the folders and the kinds of file a request should touch. When the
// diff sits inside the prediction, nobody reads it: the code is out the door and
// working, and a later PR can improve it. When the diff misses the prediction,
// the PR parks for a person, and that park is the mechanism's purpose rather
// than its failure. The reviewer here is not checking that the code is perfect;
// they are checking the wagon is on the trail — that nothing irreversible
// slipped through, and that the change's footprint matches its ask (a wide diff
// for a small request is a lesson in separation of concerns, not a defect). So a
// policy is written narrow, from the predicted folders, and is never widened to
// fit the diff that arrived.
//
// THE VOCABULARY IS EXTENSIBLE AS DATA. Built-in diff classes live here; a pack
// adds its own by shipping a `merge-rules.json` beside its `pack.mjs` — named
// path/kind/edit-shape matchers, validated at load, colliding loudly. A policy
// then names any rule, built-in or declared, plus the inline `under:<dir>` scope
// that carries its own argument, and an unknown name FAILS CLOSED: a policy this
// code cannot fully resolve authorizes nothing.
//
// A LIST IS A UNION, `&&` IS THE INTERSECTION. Listing two terms widens — each
// changed file need only be covered by one of them — so the way to say "docs,
// but only under this folder" is one `&&` term, never two list entries.
//
// POLICY SEMANTICS, in evaluation order:
//   - `'nothing'`  — never mergeable. `'anything'` — mergeable (the repo's own
//     delivery settings still apply downstream, land-pr.mjs).
//   - a LIST mixes allow terms and `reject:<name>` terms. A reject matching any
//     changed file vetoes the whole diff; otherwise every changed file must be
//     covered by some allow term (first listed match wins), and every matched
//     rule's whole-diff constraint (e.g. "one code directory") must hold. A list
//     with no allow term is an authoring error, not "anything except" — spell
//     that as `['anything', 'reject:<name>']`.
//   - THE SELF-WIDENING GUARD: under a list policy, a change to the files that
//     define policies (`merge-rules.json`, `tasks/<name>/task.mjs`, this module,
//     its work-scope gate) is never coverable unless it is comment-only — a run
//     must not be able to grant itself a wider authorization than it started
//     with. Only the plain `'anything'` (the trusted lane: the vendored-mount
//     converge) can land such a change.
//
// Two judging surfaces read one resolution path: the landing lane's CLI below
// (what the worker doc tells a run to execute before it may merge), and the
// `automerge-policy-scope` work check beside this file, which re-evaluates the
// same verdict over a branch that stamped the arming trailer.

import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { COMMENT_CHECKABLE, commentOnly } from '../../engine/checks/helpers/code-scanning.mjs';
import { FILE_CLASSES } from '../../engine/checks/helpers/pattern-rules.mjs';
import { isActive } from '../../engine/pack_loader/pack-registry.mjs';

export { COMMENT_CHECKABLE, commentOnly };

export const POLICY_NOTHING = 'nothing';
export const POLICY_ANYTHING = 'anything';

// The commit-message trailer a run stamps when it intends to land its own PR
// under a granular policy — what makes the work-scope gate self-gating: no
// trailer, no armed auto-merge, nothing to judge. The policy expression is the
// string form below (`a;b;reject:c`).
export const AUTOMERGE_TRAILER = 'Claudinite-Automerge-Policy';
export const AUTOMERGE_TRAILER_RE = /^Claudinite-Automerge-Policy:[ \t]*(\S+)[ \t]*$/m;

// --- path classification (shared with narrow-diff.mjs, which re-exports it) ---

const DOC_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.rst']);

const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'spec', 'specs', 'fixtures', 'testdata']);

// A path's kind, from the path alone: 'doc', 'test', or 'code'. Directory names
// are matched on whole segments (`tests/`), never on substrings, so `latest/` is
// not a test directory; file names are matched on the conventions every ecosystem
// here shares.
export function classifyPath(file) {
  const segments = file.split('/');
  const name = segments[segments.length - 1];
  if (segments.slice(0, -1).some((seg) => TEST_DIRS.has(seg) || seg.endsWith('-tests') || seg.endsWith('_tests'))) return 'test';
  if (/(^|[.\-_])(test|tests|spec)[.\-_]/i.test(name) || /^test_/i.test(name)) return 'test';
  if (DOC_EXTENSIONS.has(path.extname(name).toLowerCase())) return 'doc';
  return 'code';
}

// --- diff entries -------------------------------------------------------------

// One changed file with both contents: null `before` = added, null `after` =
// deleted. Everything below judges these, so a caller with another diff source
// (the work-scope context) builds the same shape.
export const changeKindOf = ({ before, after }) =>
  (before == null ? 'added' : after == null ? 'deleted' : 'modified');

// Only line removals (and nothing else): the after-lines are an ordered
// subsequence of the before-lines. Deliberately order-preserving — a reorder is
// an edit, not a removal — and a whole-file deletion is every line removed.
export function removalsOnly(before, after) {
  return shrinkOnly(before, after, (line, original) => line === original);
}

// Removals, plus in-line TRIMS: every surviving line either equals a line it
// replaces or is a character-subsequence of one — a line cut in half, a word
// struck from its middle, a truncation closed with a period the original
// already held. What can never pass is growth: no new line, and no character a
// replaced line did not already carry in order. The alignment is greedy and
// backtrack-free, so a pathological reshuffle can read as not-a-trim — that
// end fails safe (the diff parks for review).
export function trimsOnly(before, after) {
  return shrinkOnly(before, after, isCharSubsequence);
}

function shrinkOnly(before, after, lineSatisfies) {
  if (after == null) return true;
  if (before == null) return false;
  const from = before.split('\n');
  const to = after.split('\n');
  let i = 0;
  for (const line of to) {
    while (i < from.length && !lineSatisfies(line, from[i])) i += 1;
    if (i === from.length) return false;
    i += 1;
  }
  return true;
}

function isCharSubsequence(needle, hay) {
  let i = 0;
  for (const c of needle) {
    i = hay.indexOf(c, i);
    if (i === -1) return false;
    i += 1;
  }
  return true;
}

const isCommentOnlyChange = (e) => changeKindOf(e) === 'modified' && commentOnly(e.file, e.before, e.after);

// --- the rule registry --------------------------------------------------------
// A rule is `{ name, appliesTo(entry) }` plus, for the whole-diff rules, a
// `constraint(coveredEntries)` returning null or the reason it fails. `appliesTo`
// answers both roles a policy can use the name in: as an allow term it covers the
// files it applies to, as a `reject:` term it vetoes on them.

// The two code-locality rules deliberately do NOT apply to a comment-only code
// file (mirroring narrowVerdict): a comment edit is `comment-only-changes`'
// business, and counting it toward the file/directory budget would fail a diff
// the policy's author plainly meant to allow.
const isRealCodeChange = (e) => classifyPath(e.file) === 'code' && !isCommentOnlyChange(e);

export const BUILTIN_MERGE_RULES = new Map([
  ['doc-changes', {
    appliesTo: (e) => changeKindOf(e) !== 'deleted' && classifyPath(e.file) === 'doc',
  }],
  ['readme-changes', {
    appliesTo: (e) => changeKindOf(e) !== 'deleted' && path.basename(e.file).toLowerCase() === 'readme.md',
  }],
  ['comment-only-changes', {
    appliesTo: isCommentOnlyChange,
  }],
  ['test-changes', {
    appliesTo: (e) => changeKindOf(e) !== 'deleted' && classifyPath(e.file) === 'test',
  }],
  ['markdown-line-removals', {
    appliesTo: (e) => e.file.toLowerCase().endsWith('.md')
      && changeKindOf(e) !== 'added' && removalsOnly(e.before, e.after),
  }],
  // The trim superset of the rule above: whole-line removals plus in-line trims
  // (trimsOnly) — for a prune allowed to cut a line down, never to grow one.
  ['markdown-trims', {
    appliesTo: (e) => e.file.toLowerCase().endsWith('.md')
      && changeKindOf(e) !== 'added' && trimsOnly(e.before, e.after),
  }],
  ['file-additions', {
    appliesTo: (e) => changeKindOf(e) === 'added',
  }],
  ['generated-file-changes', {
    appliesTo: (e) => changeKindOf(e) !== 'deleted' && path.basename(e.file).includes('GENERATED'),
  }],
  // The language-scoped class, matching ANY change to a JavaScript-family file —
  // built in mostly for its `reject:` use ("nothing may touch the JS"), which is
  // why it applies to every change kind. Its file set is the checks engine's own
  // JavaScript class, so the two surfaces cannot disagree on what counts.
  ['javascript-changes', {
    appliesTo: (e) => FILE_CLASSES.javascriptFiles.test(e.file),
  }],
  ['single-file-code-changes', {
    appliesTo: isRealCodeChange,
    constraint: (covered) => {
      const files = [...new Set(covered.map((e) => e.file))].sort();
      return files.length <= 1 ? null : `code changed in ${files.length} files: ${files.join(', ')}`;
    },
  }],
  ['single-folder-code-changes', {
    appliesTo: isRealCodeChange,
    constraint: (covered) => {
      const dirs = [...new Set(covered.map((e) => path.dirname(e.file)))].sort();
      return dirs.length <= 1 ? null : `code changed in ${dirs.length} directories: ${dirs.join(', ')}`;
    },
  }],
]);

// Composites expand into their member allow terms — `narrow-diff` is the queue's
// historical `Merge: if-narrow` shape. Slightly stricter than the retired
// narrowVerdict on purpose: a DELETED doc or test file is no longer silently
// allowed (deciding a document should not exist is a reviewed change — the
// improve-comments-scope lesson), which fails toward a parked PR, never a merge.
export const COMPOSITE_POLICIES = new Map([
  ['narrow-diff', ['doc-changes', 'test-changes', 'comment-only-changes', 'single-folder-code-changes']],
]);

// --- the inline path scope (`under:<dir>`) ------------------------------------

// A rule name that carries its own argument: `under:packs/claudinite-tasks`
// covers every change inside that directory. It exists because a scope is
// usually per-request — the one folder an ad-hoc ask or a task is confined to —
// where a named merge-rules.json rule is per-pack and costs a commit to add.
//
// It covers any change KIND inside the directory (added, modified, deleted):
// "any change under this folder" reads as literally any. And it scopes rather
// than widens — a changed file outside the folder is covered by no allow term,
// so a diff that strays parks — with POLICY_SOURCES below still absolute, so a
// folder scope cannot reach the files that define policies even when they sit
// inside it.
export const UNDER_PREFIX = 'under:';

const PATH_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

// The rule an `under:<dir>` term denotes, or null when `<dir>` is not a usable
// repo-relative directory (absolute, empty, or carrying a `.`/`..` segment).
// Null is a verdict: an unresolvable scope makes the whole policy invalid, which
// authorizes nothing — the same fail-closed answer an unknown rule name gets.
export function underRule(term) {
  const dir = term.slice(UNDER_PREFIX.length).replace(/\/+$/, '');
  const segments = dir.split('/');
  if (!dir || segments.some((seg) => !PATH_SEGMENT_RE.test(seg) || seg === '.' || seg === '..')) return null;
  const prefix = `${dir}/`;
  return { name: term, appliesTo: (e) => e.file.startsWith(prefix) };
}

// --- the `&&` intersection ----------------------------------------------------

// A policy list is a UNION: adding a term widens what may land. `&&` is the one
// narrowing operator — `under:product-wiki&&doc-changes` covers a file only when
// every part covers it, so it reads as "docs, and only under that folder".
//
// Whitespace around it is accepted wherever a human writes one (an issue's
// `Automerge:` line, a task declaration) and canonicalized away by
// `policyExpression`, so what rides the commit trailer stays one whitespace-free
// token. `&` is not a legal character in a rule name or an `under:` path, so the
// operator can never be read as part of a term.
export const CONJUNCTION = '&&';

const conjunctionParts = (term) => term.split(CONJUNCTION).map((p) => p.trim());

// --- pack-declared rules (merge-rules.json) -----------------------------------

export const MERGE_RULES_FILE = 'merge-rules.json';

const RULE_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DECLARED_KEYS = ['name', 'pathMatching', 'excludePathMatching', 'changeKinds', 'editShape', 'coversMountPolicySources'];
const CHANGE_KINDS = ['added', 'modified', 'deleted'];
const EDIT_SHAPES = ['any', 'removals-only', 'comment-only'];

// Regex-as-string in the `/body/flags` form declared-checks.json already uses —
// the same inline parse pattern-rules.mjs applies (this module cannot import the
// checks engine's private compiler, so the six lines live here and point there).
function compileRegex(raw, where) {
  const m = /^\/(.*)\/([a-z]*)$/s.exec(String(raw));
  if (!m) throw new Error(`${where}: ${JSON.stringify(raw)} is not a /pattern/ regex string`);
  return new RegExp(m[1], m[2]);
}

// One declared rule compiled into the registry shape. Every key is validated and
// `changeKinds`/`editShape` are REQUIRED — a matcher whose reach is defaulted is
// a matcher nobody decided (the corpus' explicit-over-default rule).
export function compileDeclaredRule(spec, where) {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error(`${where}: a merge rule is an object, not ${JSON.stringify(spec)}`);
  }
  for (const key of Object.keys(spec)) {
    if (!DECLARED_KEYS.includes(key)) {
      throw new Error(`${where}: "${key}" is not a merge-rule key — the vocabulary is: ${DECLARED_KEYS.join(', ')}`);
    }
  }
  if (typeof spec.name !== 'string' || !RULE_NAME_RE.test(spec.name)) {
    throw new Error(`${where}: a merge rule needs a kebab-case "name"`);
  }
  const pathMatching = compileRegex(spec.pathMatching, `${where} (${spec.name}).pathMatching`);
  const exclude = spec.excludePathMatching === undefined
    ? null : compileRegex(spec.excludePathMatching, `${where} (${spec.name}).excludePathMatching`);
  if (!Array.isArray(spec.changeKinds) || !spec.changeKinds.length
      || spec.changeKinds.some((k) => !CHANGE_KINDS.includes(k))) {
    throw new Error(`${where} (${spec.name}): "changeKinds" is a non-empty subset of ${CHANGE_KINDS.join(', ')}`);
  }
  if (!EDIT_SHAPES.includes(spec.editShape)) {
    throw new Error(`${where} (${spec.name}): "editShape" must be one of ${EDIT_SHAPES.join(', ')} — declared, never defaulted`);
  }
  // The one key that may relax the self-widening guard, and only for files under
  // the VENDORED MOUNT (see POLICY_SOURCES below): declaring it is an owner
  // saying "this task may rewrite the mount, policy definitions included" — the
  // adoption/converge grant. `true` only, so it cannot be half-declared.
  if (spec.coversMountPolicySources !== undefined && spec.coversMountPolicySources !== true) {
    throw new Error(`${where} (${spec.name}): "coversMountPolicySources" takes only \`true\` — omit it otherwise`);
  }
  return {
    name: spec.name,
    coversMountPolicySources: spec.coversMountPolicySources === true,
    appliesTo(e) {
      if (!pathMatching.test(e.file) || (exclude && exclude.test(e.file))) return false;
      if (!spec.changeKinds.includes(changeKindOf(e))) return false;
      if (spec.editShape === 'removals-only') return changeKindOf(e) !== 'added' && removalsOnly(e.before, e.after);
      if (spec.editShape === 'comment-only') return isCommentOnlyChange(e);
      return true;
    },
  };
}

// The merge rules the ACTIVE packs declare, keyed by name. `packs` are discovered
// pack objects (each with `.dir`), `config` the normalized repo config — the pair
// both judging surfaces already hold. A broken declaration or a name collision is
// an ERROR entry, never a silent drop: a policy naming the broken rule must fail
// closed, and the error text is what gets it fixed.
export function declaredMergeRules(packs, config) {
  const rules = new Map();
  const errors = [];
  for (const pack of (packs ?? []).filter((p) => p.dir && isActive(p, config))) {
    const file = path.join(pack.dir, MERGE_RULES_FILE);
    if (!existsSync(file)) continue;
    const where = `${pack.id}/${MERGE_RULES_FILE}`;
    let specs;
    try {
      specs = JSON.parse(readFileSync(file, 'utf8'));
      if (!Array.isArray(specs)) throw new Error('the file must hold an array of rule objects');
    } catch (e) {
      errors.push(`${where}: ${e.message}`);
      continue;
    }
    for (const spec of specs) {
      try {
        const rule = compileDeclaredRule(spec, where);
        if (BUILTIN_MERGE_RULES.has(rule.name) || COMPOSITE_POLICIES.has(rule.name) || rules.has(rule.name)) {
          throw new Error(`rule name "${rule.name}" is already taken — merge-rule names are one flat namespace`);
        }
        rules.set(rule.name, rule);
      } catch (e) {
        errors.push(e.message.startsWith(where) ? e.message : `${where}: ${e.message}`);
      }
    }
  }
  return { rules, errors };
}

// --- policy parsing -----------------------------------------------------------

const TERM_NAME_RE = /^(under:\S+|[a-z0-9]+(-[a-z0-9]+)*)$/;

// A policy, normalized from any surface it rides — the declaration's string or
// array, the item's `Merge:` field, the commit trailer's `a;b;reject:c` — into
// { kind: 'nothing' | 'anything' } or { kind: 'rules', allow, reject } or
// { kind: 'invalid', reason }. Invalid is a verdict-shaped answer on purpose:
// every consumer treats it as "authorizes nothing", loudly.
export function normalizePolicy(raw) {
  if (raw == null) return { kind: POLICY_NOTHING };
  const terms = Array.isArray(raw)
    ? raw.map((t) => String(t).trim())
    : String(raw).trim().split(';').map((t) => t.trim());
  if (terms.length === 1) {
    const one = terms[0].toLowerCase();
    if (one === POLICY_NOTHING || one === '') return { kind: POLICY_NOTHING };
    if (one === POLICY_ANYTHING) return { kind: POLICY_ANYTHING };
    // The queue's historical spellings for its one pre-policy authorization.
    if (one === 'if-narrow' || one === 'yes' || one === 'true') return normalizePolicy(['narrow-diff']);
  }
  const allow = [];
  const reject = [];
  for (const term of terms) {
    const isReject = term.startsWith('reject:');
    const parts = conjunctionParts(isReject ? term.slice('reject:'.length) : term);
    for (const part of parts) {
      if (!TERM_NAME_RE.test(part)) {
        return { kind: 'invalid', reason: `"${term}" is not a policy term (rule names or under:<dir>, joined with && and optionally reject:-prefixed)` };
      }
      if (part.startsWith(UNDER_PREFIX) && !underRule(part)) {
        return { kind: 'invalid', reason: `"${part}" names no usable repo-relative directory — spell it under:packs/some-pack` };
      }
    }
    // A composite is itself a union, so intersecting one is ambiguous, and the
    // whole-policy words mean nothing narrowed: both are authoring errors.
    if (parts.length > 1) {
      const notIntersectable = parts.find((p) => COMPOSITE_POLICIES.has(p) || p === POLICY_ANYTHING || p === POLICY_NOTHING);
      if (notIntersectable) {
        return { kind: 'invalid', reason: `"${notIntersectable}" cannot sit in an && term — intersect specific rules` };
      }
    }
    const name = parts.join(CONJUNCTION);
    if (isReject) {
      if (COMPOSITE_POLICIES.has(name)) return { kind: 'invalid', reason: `"${term}" rejects a composite — name the specific rules to reject` };
      reject.push(name);
    } else if (name === POLICY_ANYTHING) {
      allow.push(name);
    } else if (name === POLICY_NOTHING) {
      return { kind: 'invalid', reason: `"nothing" cannot sit in a rule list — it is a whole policy of its own` };
    } else {
      allow.push(...(COMPOSITE_POLICIES.get(name) ?? [name]));
    }
  }
  if (!allow.length) {
    return { kind: 'invalid', reason: 'the policy lists no allow term — "anything except X" is spelled ["anything", "reject:X"]' };
  }
  return { kind: 'rules', allow: [...new Set(allow)], reject: [...new Set(reject)] };
}

// The string form of a declared policy — what rides the commit trailer and the
// worker's CLI invocation. Inverse of normalizePolicy for every legal value, and
// the one place whitespace around `&&` is collapsed, which is what keeps the
// stamped trailer a single whitespace-free token.
export const policyExpression = (policy) =>
  (Array.isArray(policy) ? policy : String(policy ?? POLICY_NOTHING).split(';'))
    .map((t) => conjunctionParts(String(t).trim()).join(CONJUNCTION))
    .join(';');

// --- the verdict --------------------------------------------------------------

// The files no granular policy may cover except as comment-only edits: the
// sources the policy machinery itself is read from. Whatever an allow rule says,
// a run authorized by a list must not be able to rewrite what it is authorized
// to do. (`'anything'` — the vendored-converge lane — is deliberately exempt:
// the mount refresh replaces these files wholesale, and that lane's trust is the
// repo's delivery setting, not a diff class.)
//
// One narrow relaxation: such a file UNDER THE VENDORED MOUNT may be covered by
// a declared rule carrying `coversMountPolicySources` — the shape an adoption
// re-vendor has, where policy files arrive canon-authored inside the pack trees
// it copies. The flag rides merge-rules.json, which is itself guarded and
// owner-committed, so a run cannot grant it to itself; repo-owned policy
// sources (everything outside the mount) stay absolute.
const POLICY_SOURCES = /(^|\/)(merge-rules\.json|merge-policy\.mjs|workRules\/automerge-policy-scope\.mjs|tasks\/[^/]+\/task\.mjs)$/;
const VENDORED_MOUNT = /^\.claudinite\/shared\//;

// The whole verdict over a diff. `entries` are `{ file, before, after }` (null
// side = added/deleted); `declaredRules` a Map from declaredMergeRules, with its
// `errors` passed through so a broken declaration fails any policy that names
// the broken pack's rule set. Returns { mergeable, why, files, problems }:
// `files` carries one line per changed file (its covering rule, or its
// violation), `problems` each refusal as { file, what } — file null for a
// whole-diff refusal — because a run that parks has to say what it parked over.
export function policyVerdict({ policy, entries, declaredRules = new Map(), ruleErrors = [] }) {
  const refuse = (problems, files = []) => ({
    mergeable: false, why: problems.map((p) => p.what).join('; '), files, problems,
  });
  const norm = normalizePolicy(policy);
  if (norm.kind === 'invalid') return refuse([{ file: null, what: `invalid policy: ${norm.reason}` }]);
  if (norm.kind === POLICY_NOTHING) {
    return refuse([{ file: null, what: 'the policy authorizes nothing to auto-merge' }]);
  }
  if (norm.kind === POLICY_ANYTHING) {
    return { mergeable: true, why: 'the policy authorizes any diff (the repo\'s delivery settings still apply)', files: [], problems: [] };
  }
  if (!entries.length) {
    return refuse([{ file: null, what: 'this branch changes nothing against the base — there is nothing to merge' }]);
  }

  const resolveOne = (name) => (name.startsWith(UNDER_PREFIX)
    ? underRule(name)
    : BUILTIN_MERGE_RULES.get(name) ?? declaredRules.get(name) ?? null);
  // An `&&` term is one rule that every part must agree on — for coverage and
  // for the whole-diff constraints alike. It deliberately carries no
  // `coversMountPolicySources`: that grant belongs to the declared rule that was
  // committed with it, never to an expression composed around it.
  const resolve = (name) => {
    if (!name.includes(CONJUNCTION)) return resolveOne(name);
    const parts = name.split(CONJUNCTION).map(resolveOne);
    if (parts.some((r) => !r)) return null;
    return {
      name,
      appliesTo: (e) => parts.every((r) => r.appliesTo(e)),
      constraint: (covered) => parts.map((r) => r.constraint?.(covered) ?? null).find(Boolean) ?? null,
    };
  };
  const unknown = [...norm.allow, ...norm.reject].filter((n) => n !== POLICY_ANYTHING && !resolve(n));
  if (unknown.length) {
    const errs = ruleErrors.length ? ` (rule declarations also failed to load: ${ruleErrors.join('; ')})` : '';
    return refuse([{ file: null, what: `unresolved rule name(s): ${unknown.join(', ')} — an unknown rule authorizes nothing${errs}` }]);
  }

  const files = [];
  const problems = [];
  const coveredBy = new Map(); // allow name -> entries it covered
  for (const entry of entries) {
    const { file } = entry;
    if (POLICY_SOURCES.test(file) && !isCommentOnlyChange(entry)) {
      const mountCoverer = VENDORED_MOUNT.test(file)
        && norm.allow.find((n) => resolve(n)?.coversMountPolicySources && resolve(n).appliesTo(entry));
      if (!mountCoverer) {
        files.push({ file, verdict: 'policy-source' });
        problems.push({ file, what: `${file} defines auto-merge policy itself — no granular policy may change it` });
        continue;
      }
      // Exempted: it falls through to the ordinary reject/coverage flow below,
      // so a reject term still vetoes it and the flagged rule still has to
      // cover it on its own terms.
    }
    const rejectedBy = norm.reject.find((n) => resolve(n).appliesTo(entry));
    if (rejectedBy) {
      files.push({ file, verdict: `rejected:${rejectedBy}` });
      problems.push({ file, what: `${file} matches reject:${rejectedBy}` });
      continue;
    }
    const coverer = norm.allow.find((n) => n === POLICY_ANYTHING || resolve(n).appliesTo(entry));
    if (coverer === undefined) {
      files.push({ file, verdict: 'uncovered' });
      problems.push({ file, what: `${file} (${changeKindOf(entry)} ${classifyPath(entry.file)}) is covered by no allow term` });
      continue;
    }
    files.push({ file, verdict: `covered:${coverer}` });
    if (!coveredBy.has(coverer)) coveredBy.set(coverer, []);
    coveredBy.get(coverer).push(entry);
  }
  for (const [name, covered] of coveredBy) {
    const failed = resolve(name)?.constraint?.(covered) ?? null;
    if (failed) problems.push({ file: null, what: `${name}: ${failed}` });
  }

  return problems.length
    ? refuse(problems, files)
    : { mergeable: true, why: `every changed file is covered (${[...coveredBy.keys()].join(', ')})`, files, problems: [] };
}

// --- the diff against a base ref (shared with narrow-diff.mjs) ----------------

// `stderr: ignore` because the ONE expected failure here — `git show` on a path
// that does not exist at that ref — is how an added or deleted file answers, and
// letting git narrate it once per such file buries the verdict the caller reads.
const git = (args, cwd) => execFileSync('git', args, {
  cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
});

// The content of `file` at `ref`, or null when it does not exist there (an added
// file) — the same answer a deleted file's "after" gets.
function contentAt(ref, file, cwd) {
  try {
    return git(['show', `${ref}:${file}`], cwd);
  } catch {
    return null;
  }
}

// The diff this branch carries against `base`, read from the merge base so
// commits that landed on the base meanwhile are not counted as this run's work.
export function diffEntries({ base, cwd = process.cwd() }) {
  // The checkouts these runs work in are shallow, where `merge-base` has no common
  // ancestor to find; the base ref itself is then the honest comparison point.
  let mergeBase;
  try {
    mergeBase = git(['merge-base', base, 'HEAD'], cwd).trim();
  } catch {
    mergeBase = base;
  }
  const names = git(['diff', '--name-only', mergeBase, 'HEAD'], cwd).split('\n').map((l) => l.trim()).filter(Boolean);
  return names.map((file) => ({
    file,
    before: contentAt(mergeBase, file, cwd),
    after: contentAt('HEAD', file, cwd),
  }));
}

// --- the CLI ------------------------------------------------------------------
// What the landing lane runs before it may merge:
//   node <this file> --base origin/main --policy 'comment-only-changes;readme-changes'
// Prints one line per changed file and a final `AUTOMERGE: yes|no — why` verdict
// line the worker quotes. Pack-declared rules resolve from the repo's ACTIVE
// packs (loaded here, not at import time — discovery re-importing this module
// mid-evaluation must find no work started).
async function main() {
  const argv = process.argv.slice(2);
  const at = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null);
  const cwd = at('--root') ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const base = at('--base') ?? 'origin/main';
  const policy = at('--policy');
  if (policy === null) {
    console.error('merge-policy: --policy is required (the task\'s automerge, or the item\'s Merge: value)');
    process.exitCode = 2;
    return;
  }

  const { loadPacks } = await import('../../engine/pack_loader/pack-registry.mjs');
  const { loadConfig } = await import('../../engine/checks/helpers/repo-context.mjs');
  const packs = await loadPacks({ localRoot: cwd });
  const { rules, errors } = declaredMergeRules(packs, loadConfig(cwd));
  for (const e of errors) console.error(`merge-policy: ${e}`);

  const entries = diffEntries({ base, cwd });
  const verdict = policyVerdict({ policy, entries, declaredRules: rules, ruleErrors: errors });
  for (const { file, verdict: v } of verdict.files) console.log(`  ${v.padEnd(32)} ${file}`);
  console.log(`\nAUTOMERGE: ${verdict.mergeable ? 'yes' : 'no'} — ${verdict.why}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`merge-policy: ${e.message}`); process.exitCode = 1; });
}
