// The work item — the queue's one durable object (tasks-dispatch DESIGN §3, §4).
// An issue titled `[claudinite-work] <pack>/<task> [qualifier]`, whose labels are
// its state, whose body's first line is the task path, and whose two optional body
// fields (`Not-before`, `Blocked-by`) are the only scheduling facts it carries.
//
// PURE, and deliberately the whole schema: everything else — anchors, guards,
// yields, leashes, verdicts — is computed fresh at every tick and pick from the
// engine and the declarations at HEAD (DESIGN §14). The label-and-field vocabulary
// here is therefore the compatibility surface across engine versions, which is why
// additive change is the strongly preferred shape and a rename needs a migration.
//
// Parse/serialize of the two fields lives here and nowhere else (DESIGN §9).

// The title prefix. Disjoint from the slot mechanism's `[claudinite-task]` on
// purpose: the two mechanisms coexist per-repo behind `taskScheduler.dispatch`,
// and neither may read the other's issues (DESIGN §14, S29).
export const WORK_PREFIX = '[claudinite-work]';

export const BLOCKED = 'task:blocked';
export const READY = 'task:ready';
export const URGENT = 'task:urgent';
export const EXECUTING = 'task:executing';
export const AGENT = 'task:agent';
export const ORIGIN_SCHEDULE = 'origin:schedule';
export const NEEDS_HUMAN = 'needs-human';
export const OUTCOME_DONE = 'outcome:done';
export const OUTCOME_DELIVERED = 'outcome:delivered';
export const OUTCOME_OBSOLETE = 'outcome:obsolete';

// The four state labels an open item may wear. An open item wearing none of them
// and no `needs-human` is off the state machine entirely — a torn label swap's
// leavings, which the janitor repairs (DESIGN §6.2, §11).
export const STATE_LABELS = [BLOCKED, READY, EXECUTING, AGENT];

// Every label this mechanism applies, with the colour and description a bootstrap
// one-off would have given it. Ensured create-if-missing before anything is
// applied: GitHub 422s when you apply an unknown label and never creates one on
// demand, so the thing that assigns a label guarantees it first.
export const QUEUE_LABELS = [
  { name: BLOCKED, color: 'c5def5', description: 'Claudinite queue: waiting on Blocked-by and/or Not-before' },
  { name: READY, color: '0e8a16', description: 'Claudinite queue: available for an executor to pick up' },
  { name: URGENT, color: 'd93f0b', description: 'Claudinite queue: pick this before any non-urgent item' },
  { name: EXECUTING, color: 'fbca04', description: 'Claudinite queue: an executor holds the claim' },
  { name: AGENT, color: '1d76db', description: 'Claudinite queue: an agent session owns this item' },
  { name: ORIGIN_SCHEDULE, color: 'ededed', description: 'Claudinite queue: created by the generator tick at a task anchor' },
  { name: NEEDS_HUMAN, color: 'b60205', description: 'Claudinite queue: failed or anomalous — the one triage state' },
  { name: OUTCOME_DONE, color: '0e8a16', description: 'Claudinite queue: succeeded, nothing pending' },
  { name: OUTCOME_DELIVERED, color: '5319e7', description: 'Claudinite queue: succeeded and left a live artifact the world still has to act on' },
  { name: OUTCOME_OBSOLETE, color: 'ededed', description: 'Claudinite queue: never ran — the precondition said no, or the task is gone' },
];

// GitHub hands labels back as objects on the issues API and as bare strings in
// some fixtures; accept either.
export const labelNames = (issue) =>
  (issue?.labels ?? []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean);

export const hasLabel = (issue, name) => labelNames(issue).includes(name);

// Title. The optional qualifier exists ONLY for deliberately concurrent items —
// a fan-out naming its target — and it is part of the identity the same-title
// mutex reads (DESIGN §6.1). Nothing ever encodes a date here: that was the slot
// grammar, and the issue number is the identity (DESIGN §5).
export const workItemTitle = ({ pack, task, qualifier = null }) =>
  `${WORK_PREFIX} ${pack}/${task}${qualifier ? ` ${qualifier}` : ''}`;

// pack and task ids are single path segments; the qualifier is whatever follows.
const TITLE_RE = /^\[claudinite-work\]\s+([^/\s]+)\/([^/\s]+)(?:\s+(\S.*))?$/;

export function parseWorkItemTitle(title) {
  const m = TITLE_RE.exec(String(title ?? '').trim());
  return m ? { pack: m[1], task: m[2], qualifier: m[3]?.trim() || null } : null;
}

export const isWorkItemTitle = (title) => parseWorkItemTitle(title) !== null;

// --- comment markers ----------------------------------------------------------
// The three comments the protocol reads back. They are HTML comments so a human
// reading the item sees prose, and they are here — with the labels and the body
// fields — because together they ARE the item's vocabulary, the one compatibility
// surface across engine versions (DESIGN §14).
//
// The CLAIM comment carries who and when (executor identity is an unbounded set
// and must never become a label). The HANDOFF comment names the session and the
// invocation nonce. The EPISODE comment is the boundary the claim arbiter is
// scoped to: every claim before it is dead, and arbitrating over dead claims makes
// one outrank every future live claimant — the item then livelocks through reclaim
// cycles forever (F18). A reclaim, a revert and a hand re-queue each write one.
export const CLAIM_MARKER = '<!-- claudinite-claim -->';
export const HANDOFF_MARKER = '<!-- claudinite-handoff -->';
export const EPISODE_MARKER = '<!-- claudinite-episode -->';

// --- the body -----------------------------------------------------------------

export const NOT_BEFORE_FIELD = 'Not-before';
export const BLOCKED_BY_FIELD = 'Blocked-by';

const NOT_BEFORE_RE = /^Not-before:[ \t]*(.*)$/m;
const BLOCKED_BY_RE = /^Blocked-by:[ \t]*(.*)$/m;

// Build a work item body. The first line is the task path — the only thing an
// executor reads to locate the worker, validated in code before anything trusts
// it. Everything behavior-defining (model, ceiling, worker content, prework
// command) is read from the tracked task files at HEAD, never from here.
export function workItemBody({
  taskPath, notBefore = null, blockedBy = [], context = [], delivered = [], reason = null,
}) {
  const lines = [taskPath, ''];
  const fields = [];
  if (notBefore) fields.push(`${NOT_BEFORE_FIELD}: ${notBefore}`);
  if (blockedBy.length) fields.push(`${BLOCKED_BY_FIELD}: ${blockedBy.map((n) => `#${n}`).join(', ')}`);
  if (fields.length) lines.push(...fields, '');
  lines.push('Execute the Claudinite task above.');
  if (context.length) {
    lines.push(
      'The Context section below is binding scope — do not re-decide it.',
      '',
      '### Context',
      ...context.map((c) => `- ${c}`),
    );
  }
  if (reason) lines.push('', '### Why the agent is here', '', `- ${reason}`);
  if (delivered.length) lines.push('', '### Delivered by prework', '', ...delivered.map((d) => `- ${d}`));
  return lines.join('\n') + '\n';
}

// Parse an item body back into the facts the tick and the executor read. A body
// with no first line, or whose fields are absent, yields nulls — absence is
// meaningful everywhere here and is never filled in with a default.
export function parseWorkItemBody(body) {
  const text = String(body ?? '');
  const taskPath = text.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? null;
  const nb = NOT_BEFORE_RE.exec(text)?.[1]?.trim() || null;
  const bb = BLOCKED_BY_RE.exec(text)?.[1] ?? '';
  const blockedBy = [...bb.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
  return { taskPath, notBefore: nb, blockedBy };
}

// Stamp (or clear) `Not-before` on an existing body, in place where the field is
// already present and directly under the task path otherwise. Text surgery rather
// than a rebuild: the body also carries the creating precondition's Context and
// prework's Delivered section, which belong to whoever wrote them.
export function withNotBefore(body, iso) {
  const text = String(body ?? '');
  if (NOT_BEFORE_RE.test(text)) {
    return iso
      ? text.replace(NOT_BEFORE_RE, `${NOT_BEFORE_FIELD}: ${iso}`)
      : text.replace(/^Not-before:[ \t]*.*\n?/m, '');
  }
  if (!iso) return text;
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.trim() !== '');
  if (at === -1) return `${NOT_BEFORE_FIELD}: ${iso}\n`;
  lines.splice(at + 1, 0, '', `${NOT_BEFORE_FIELD}: ${iso}`);
  return lines.join('\n');
}

// Set a section of an item body (the Context, prework's Delivered, the agent's Why)
// — replacing one of the same heading if it is already there, appending otherwise.
//
// REPLACING IS THE WHOLE POINT, and appending was a live bug (#879). Every standing
// item is born carrying a `### Context`, and the hand-off writes Context again — so
// an append leaves TWO sections of that name, while the session is told to read "the
// issue's Context section", singular. The one it reads first is then the tick's birth
// note and the binding scope is in the other, which fails silently whichever section
// the agent picks. It also grows: an item re-queued through hand-off twice carried a
// third.
//
// A section runs to the next `### ` heading or to the end of the body, so a replaced
// section keeps its position rather than migrating to the bottom — the body stays in
// the order a reader learned it.
export function withSection(body, heading, lines) {
  if (!lines.length) return body;
  const text = String(body ?? '').replace(/\s*$/, '');
  const section = [`### ${heading}`, '', ...lines.map((l) => `- ${l}`)];
  const existing = text.split('\n');
  const at = existing.findIndex((l) => l.trim() === `### ${heading}`);
  if (at === -1) return `${text}\n\n${section.join('\n')}\n`;
  const after = existing.findIndex((l, i) => i > at && l.startsWith('### '));
  const tail = after === -1 ? [] : ['', ...existing.slice(after)];
  return `${[...existing.slice(0, at), ...section, ...tail].join('\n')}\n`;
}
