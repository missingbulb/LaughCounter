// The work item — the queue's one durable object (tasks-dispatch DESIGN §3, §4).
// An issue titled `[claudinite-work] <pack>/<task> [qualifier]`, whose labels are
// its state, whose body's first line is the task path, and whose optional body
// fields (`Not-before`, `Blocked-by`, and a request's `Request` / `Model`) are the
// only facts it carries beyond that.
//
// PURE, and deliberately the whole schema: everything else — anchors, guards,
// yields, leashes, verdicts — is computed fresh at every tick and pick from the
// engine and the declarations at HEAD (DESIGN §14). The label-and-field vocabulary
// here is therefore the compatibility surface across engine versions, which is why
// additive change is the strongly preferred shape and a rename needs a migration.
//
// Parse/serialize of those fields lives here and nowhere else (DESIGN §9).
//
// The one import, and a frozen constant at that: the pack-rename map, which this
// module needs to keep reading titles written before a rename (see parseWorkItemTitle).
import { canonicalPackId } from '../../pack_loader/renamed-packs.mjs';

// The title prefix. Disjoint from the slot mechanism's `[claudinite-task]` on
// purpose: the two mechanisms coexist per-repo behind `taskScheduler.dispatch`,
// and neither may read the other's issues (DESIGN §14, S29).
export const WORK_PREFIX = '[claudinite-work]';

export const BLOCKED = 'task:blocked';
export const READY = 'task:ready';
export const URGENT = 'task:urgent';
export const EXECUTING = 'task:executing';
export const AGENT = 'task:agent';
export const NEEDS_HUMAN = 'needs-human';

// @deprecated The origin marker (DESIGN §15.26). Nothing writes it and nothing
// branches on it: whether an item is a task's standing occurrence or an ad-hoc run
// is STRUCTURAL — see `isStandingItem` — so a marker that could disagree with the
// structure was a second authority over the same fact. Kept exported and inert
// because open items filed by an older engine still carry it, and a reader that
// choked on an unknown label would fail on exactly those.
export const ORIGIN_SCHEDULE = 'origin:schedule';

// The TRIAGE SUB-LABELS. `needs-human` says an item is parked; these say what the
// human parked with it is expected to DO, which is the whole difference between a
// queue a person can skim and one they have to read. Every park wears BOTH:
// `needs-human` stays the single state the machine reads (every guard, sweep and
// dashboard already turns on it), and the sub-label is the human's routing.
//
// The four are disjoint by REMEDY, not by cause:
//   action   — something outside the code must change: a secret set, a scope
//              granted, a routine's prompt or endpoint fixed, an item re-created
//              with the parameter it was missing. Mechanical; no judgement.
//   decision — the run stopped mid-flight and what happens next is a choice:
//              re-queue or abandon, does the half-done work stand, was the
//              ceiling violation acceptable.
//   approval — the run SUCCEEDED and deliberately left an unmerged PR. The only
//              park that is not a fault; the human merges it or closes it.
//   failure  — the run broke: a bug, a contract-forbidden shape, a malformed or
//              forged item. Someone diagnoses and fixes code.
// `failure` is the default a park falls back to, so an unclassified park reads as
// "diagnose me" rather than quietly joining the mechanical lane.
const triage = (kind) => `task:needs-human-${kind}`;
export const NEEDS_HUMAN_ACTION = triage('action');
export const NEEDS_HUMAN_DECISION = triage('decision');
export const NEEDS_HUMAN_APPROVAL = triage('approval');
export const NEEDS_HUMAN_FAILURE = triage('failure');
export const TRIAGE_LABELS = Object.freeze([
  NEEDS_HUMAN_ACTION, NEEDS_HUMAN_DECISION, NEEDS_HUMAN_APPROVAL, NEEDS_HUMAN_FAILURE,
]);
// WHICH PARKS HOLD THE TASK'S LANE. A task's open STANDING item is the occurrence
// itself, so while one exists the generator files no further occurrence
// (`planTick` job 1) — which for a park means the task stops being scheduled at
// all until a human clears it. That is right for a `failure`: filing a queue of
// items that will break the same way helps nobody, and the silence is the signal.
// It is wrong for the other three, which are a person's inbox, not a fault in the
// task: a PR waiting to be approved, a choice waiting to be made and a secret
// waiting to be set must not also stop tomorrow's run.
//
// A park wearing NO sub-label blocks, which is what makes this safe on the way in:
// every item parked by an engine older than the sub-labels, and every kind word a
// future engine invents that this one does not know, holds the lane rather than
// silently letting a broken task keep filing work.
export const isBlockingPark = (item) =>
  hasLabel(item, NEEDS_HUMAN)
  && !hasLabel(item, NEEDS_HUMAN_ACTION)
  && !hasLabel(item, NEEDS_HUMAN_DECISION)
  && !hasLabel(item, NEEDS_HUMAN_APPROVAL);

// A kind word (from a worker's own triage marker, or a call site) to its label.
// Anything unrecognised is a `failure`: a worker that misspells its class has a
// bug, which is exactly what that lane means.
export const triageLabelFor = (kind) =>
  (TRIAGE_LABELS.includes(triage(kind)) ? triage(kind) : NEEDS_HUMAN_FAILURE);

// @deprecated Nothing writes this since the approval park: a run that left an
// unmerged PR no longer CLOSES as delivered, it parks at
// `task:needs-human-approval` and waits to be merged. Kept exported, kept in
// `QUEUE_LABELS`, and still read everywhere it was read — closed issues carrying
// it are stored data, and a decoder that stopped recognising it would turn every
// historical delivered run into an un-outcomed one.
export const OUTCOME_DELIVERED = 'outcome:delivered';

// @deprecated The pre-2026-08-19 spellings of the two terminals below. Kept
// exported so a fielded pack that imports them still loads, and READ wherever an
// outcome is decoded: labels are stored data on closed issues fleet-wide, so a
// decoder that stopped recognising these would turn every historical run into an
// un-outcomed one. Write `TASK_DONE` / `TASK_OBSOLETE`.
export const OUTCOME_DONE = 'outcome:done';
export const OUTCOME_OBSOLETE = 'outcome:obsolete';

// Today's terminal spellings (DESIGN §4, §15.25): the `outcome:` namespace dissolves
// into `task:`, one vocabulary for the state machine's live and terminal states
// alike. These are what the engine WRITES; the `outcome:*` spellings above are read
// forever, because a closed issue keeps whatever it was closed under.
export const TASK_DONE = 'task:done';
export const TASK_OBSOLETE = 'task:obsolete';

// The stored-data rename rule, decode side: every spelling ever written maps
// STRAIGHT to the canonical word, in one pass — including `outcome:delivered`,
// which nothing writes any more but closed issues carry forever.
const OUTCOME_SPELLINGS = new Map([
  [TASK_DONE, 'done'], [OUTCOME_DONE, 'done'],
  [OUTCOME_DELIVERED, 'delivered'],
  [TASK_OBSOLETE, 'obsolete'], [OUTCOME_OBSOLETE, 'obsolete'],
]);

// The one outcome an issue's labels carry, as the canonical word ('done',
// 'delivered', 'obsolete') or null. Everything that tallies or renders outcomes
// decodes through here, so a spelling change is one map entry and not a sweep.
export function outcomeOf(issue) {
  for (const l of labelNames(issue)) {
    const o = OUTCOME_SPELLINGS.get(l);
    if (o) return o;
  }
  return null;
}

// --- the request vocabulary (DESIGN §16.1) ------------------------------------
// Five labels in their own namespace, worn by an ORDINARY issue somebody marked —
// never by a work item, which is why they are not in the `task:` namespace and why
// nothing here reads them off an item. They are here beside the item's own
// vocabulary because they are the other half of the same compatibility surface.
//
// The mark is a LABEL rather than a body syntax or a command comment for one
// reason: it must be appliable from the issue page on a phone. It is also
// write-gated by the platform — applying a label needs triage or write access —
// which is the first half of the security story (the second is the precondition's
// permission read at pickup, §16.4).
export const REQUEST_LABEL = 'claude-task';
export const QUEUED_LABEL = 'claude-queued';
export const IN_REVIEW_LABEL = 'claude-in-review';
export const MODEL_LABEL_PREFIX = 'claude-model:';

// The merge authorization (§16.11): the asker says up front that this request's
// change may land without their approval WHEN ITS DIFF IS NARROW — the run still
// judges the diff, and a wide one parks for review exactly as an unauthorized
// request does. Consumed with the mark like the model labels, so each ask
// authorizes afresh and a label left by an earlier ask never carries into a new one.
export const AUTOMERGE_LABEL = 'claude-automerge';

// The families a request may ask for, and the one it gets when it asks for
// nothing. `none` is not among them: a request is implemented by a session, so an
// agentless family would name a run that cannot happen.
export const REQUEST_MODELS = Object.freeze(['opus', 'sonnet', 'haiku']);
export const DEFAULT_REQUEST_MODEL = 'opus';

export const MODEL_LABELS = REQUEST_MODELS.map((f) => `${MODEL_LABEL_PREFIX}${f}`);

// Every label the request mode applies, ensured like the queue's own. `claude-task`
// is ensured too although only a person applies it: a label that does not exist is
// one nobody can find in the picker, and the mark is the whole entry point.
export const REQUEST_LABELS = [
  { name: REQUEST_LABEL, color: '1d76db', description: 'Claudinite: implement this issue — the next tick queues a run for it' },
  { name: QUEUED_LABEL, color: 'fbca04', description: 'Claudinite: a work item exists for this issue' },
  { name: IN_REVIEW_LABEL, color: '5319e7', description: 'Claudinite: a pull request is open for this issue, waiting on a person' },
  { name: AUTOMERGE_LABEL, color: '0e8a16', description: 'Claudinite: land this request without approval if its diff is narrow (docs, tests, comments, code in one directory)' },
  ...REQUEST_MODELS.map((f) => ({
    name: `${MODEL_LABEL_PREFIX}${f}`, color: 'ededed',
    description: `Claudinite: run this request at the ${f} family`,
  })),
];

// The model a marked issue asks for, from the labels standing on it. An
// unrecognised family falls back to the default rather than failing the request:
// a run nobody can start would look accepted forever. Where several are present the
// order is REQUEST_MODELS' — the labels are consumed at adoption (§16.3), so the
// only way to hold two is to apply two for the same ask.
export const requestModelFromLabels = (labels = []) => {
  const asked = labels.filter((l) => l.startsWith(MODEL_LABEL_PREFIX)).map((l) => l.slice(MODEL_LABEL_PREFIX.length));
  return REQUEST_MODELS.find((f) => asked.includes(f)) ?? DEFAULT_REQUEST_MODEL;
};

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
  { name: NEEDS_HUMAN, color: 'b60205', description: 'Claudinite queue: parked for a human — the one triage state' },
  { name: NEEDS_HUMAN_ACTION, color: 'b60205', description: 'Claudinite triage: a human must change something outside the code' },
  { name: NEEDS_HUMAN_DECISION, color: 'd93f0b', description: 'Claudinite triage: a human must choose what happens next' },
  { name: NEEDS_HUMAN_APPROVAL, color: '5319e7', description: 'Claudinite triage: succeeded and left an unmerged PR to approve' },
  { name: NEEDS_HUMAN_FAILURE, color: 'b60205', description: 'Claudinite triage: the run broke — diagnose and fix' },
  { name: TASK_DONE, color: '0e8a16', description: 'Claudinite queue: succeeded, nothing pending' },
  { name: OUTCOME_DELIVERED, color: '5319e7', description: 'Claudinite queue: succeeded and left a live artifact the world still has to act on' },
  { name: TASK_OBSOLETE, color: 'ededed', description: 'Claudinite queue: never ran — the precondition said no, or the task is gone' },
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

// The pack half is canonicalized on the way out. A work item's title is STORED
// DATA — it sits on an open GitHub issue that outlives any one converge — so items
// filed before a pack was renamed still carry the old spelling. Read literally, the
// tick would not recognise its own live item, would file a second one beside it, and
// would leave the first orphaned in the queue with nothing ever draining it.
export function parseWorkItemTitle(title) {
  const m = TITLE_RE.exec(String(title ?? '').trim());
  return m ? { pack: canonicalPackId(m[1]), task: m[2], qualifier: m[3]?.trim() || null } : null;
}

export const isWorkItemTitle = (title) => parseWorkItemTitle(title) !== null;

// STANDING OR AD-HOC, DERIVED (DESIGN §15.26). A task's standing item is the one
// the generator files at an anchor: its title names the task and nothing else, and
// the task it names is on a calendar. Everything else is ad-hoc — a `manual` task
// (which has no anchor to stand for) and every qualified item (a fan-out target, a
// request naming its issue), each of which may legitimately run beside the
// occurrence rather than being it.
//
// It is read off the item and the declaration at HEAD rather than off a label the
// creator applied, because the two could disagree: a marker says what its writer
// believed, the structure says what the item IS, and the guards that consume this
// (the occurrence guard, the dedupe, the `after` yield) are only sound on the
// second. `frequency` is the declared frequency of the task the title names —
// absent when the repo no longer carries it, which is ad-hoc by the same rule.
export function isStandingItem(item, frequency) {
  const parsed = parseWorkItemTitle(item?.title ?? item);
  return !!parsed && parsed.qualifier === null && frequency != null && frequency !== 'manual';
}

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

// The three fields a REQUEST item carries (DESIGN §16.3, §16.11). `Request` is the issue this
// run implements — the whole payload, since the request task has no code-work phase
// to hand one over. `Model` is the family the asker chose, copied here by the tick
// from a write-gated label and read only by a task that declares
// `model_from_request`; it is the first thing an item carries that defines
// behaviour, which is why it is fenced rather than waved through (§16.7).
export const REQUEST_FIELD = 'Request';
export const MODEL_FIELD = 'Model';

// `Merge` is the asker's standing authorization, copied here from the
// write-gated `claude-automerge` label. Its one value is `if-narrow`: the run may
// land its own pull request when the diff classifier calls the diff narrow, and
// must park for approval otherwise. An absent field is the default — never merge —
// so an item an older tick wrote reads as unauthorized rather than as authorized.
export const MERGE_FIELD = 'Merge';
export const MERGE_IF_NARROW = 'if-narrow';

// The heading the delivered-artifacts section carries in a work item body. One
// home, because it is written in three places and MATCHED when a re-entrant run
// updates the section it already wrote.
export const DELIVERED_HEADING = 'Delivered by code-work';

// The same heading as earlier renames spelled it. A live item's body still carries
// whichever word was current when its section was first written, and matching only
// today's would append a SECOND section rather than updating that one.
export const LEGACY_DELIVERED_HEADINGS = Object.freeze([
  'Delivered by prework',
  'Delivered by code_work',
]);

const NOT_BEFORE_RE = /^Not-before:[ \t]*(.*)$/m;
const BLOCKED_BY_RE = /^Blocked-by:[ \t]*(.*)$/m;
const REQUEST_RE = /^Request:[ \t]*#?(\d+)/m;
const MODEL_RE = /^Model:[ \t]*(\S+)/m;
const MERGE_RE = /^Merge:[ \t]*(\S+)/m;

// Build a work item body. The first line is the task path — the only thing an
// executor reads to locate the worker, validated in code before anything trusts
// it. Everything behavior-defining (model, ceiling, worker content, code-work
// command) is read from the tracked task files at HEAD, never from here.
export function workItemBody({
  taskPath, notBefore = null, blockedBy = [], context = [], delivered = [], reason = null,
  request = null, model = null, merge = null,
}) {
  const lines = [taskPath, ''];
  const fields = [];
  if (notBefore) fields.push(`${NOT_BEFORE_FIELD}: ${notBefore}`);
  if (blockedBy.length) fields.push(`${BLOCKED_BY_FIELD}: ${blockedBy.map((n) => `#${n}`).join(', ')}`);
  if (request) fields.push(`${REQUEST_FIELD}: #${request}`);
  if (model) fields.push(`${MODEL_FIELD}: ${model}`);
  if (merge) fields.push(`${MERGE_FIELD}: ${merge}`);
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
  if (delivered.length) lines.push('', `### ${DELIVERED_HEADING}`, '', ...delivered.map((d) => `- ${d}`));
  return lines.join('\n') + '\n';
}

// The `Blocked-by` numbers a body names, from a work item's body or from an
// ORDINARY issue's — a request marked for implementation states what it waits on in
// the same field spelling, and adoption carries it onto the item it births (§16.11).
export function parseBlockedBy(body) {
  const bb = BLOCKED_BY_RE.exec(String(body ?? ''))?.[1] ?? '';
  return [...bb.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
}

// Parse an item body back into the facts the tick and the executor read. A body
// with no first line, or whose fields are absent, yields nulls — absence is
// meaningful everywhere here and is never filled in with a default.
export function parseWorkItemBody(body) {
  const text = String(body ?? '');
  const taskPath = text.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? null;
  const nb = NOT_BEFORE_RE.exec(text)?.[1]?.trim() || null;
  const blockedBy = parseBlockedBy(text);
  const request = REQUEST_RE.exec(text) ? Number(REQUEST_RE.exec(text)[1]) : null;
  // An unrecognised family reads as absent rather than as itself: the item's model
  // is behaviour-defining, so the only values that leave this parser are ones the
  // engine can actually dispatch at (§16.7).
  const askedModel = MODEL_RE.exec(text)?.[1] ?? null;
  const model = REQUEST_MODELS.includes(askedModel) ? askedModel : null;
  // Same fencing as the model: an unrecognised authorization reads as absent, and
  // absent is the safe end of this field — a run that cannot read its permission
  // opens a pull request and waits.
  const askedMerge = MERGE_RE.exec(text)?.[1] ?? null;
  const merge = askedMerge === MERGE_IF_NARROW ? askedMerge : null;
  return { taskPath, notBefore: nb, blockedBy, request, model, merge };
}

// The item's own `### Context` bullets, in order — the binding scope a hand-created
// item was born with. Read back rather than kept only for the agent to read,
// because an operator's PARAMETERS ride here: `create-work-item --context
// "REPOS=Alpha Beta"` is how a forced run says what it is running on, and the
// executor hands these lines to code-work as `CLAUDINITE_CONTEXT`.
//
// A section runs to the next `### ` heading or to the end of the body — the same
// bounds `withSection` writes to — and only `- ` bullets count, so the prose
// framing around a section contributes nothing.
function sectionLines(body, heading) {
  const lines = String(body ?? '').split('\n');
  const at = lines.findIndex((l) => l.trim() === `### ${heading}`);
  if (at === -1) return [];
  const out = [];
  for (const line of lines.slice(at + 1)) {
    if (line.startsWith('### ')) break;
    const m = /^-[ \t]+(.*)$/.exec(line);
    if (m) out.push(m[1].trim());
  }
  return out;
}

export const parseContextLines = (body) => sectionLines(body, 'Context');

// --- the roll's record ----------------------------------------------------------

// The section a no-go roll keeps on the item: the last declined reason and the next
// wake, REPLACED on every roll (the item is a status line, not a log — the timeline
// carries the history). Serializer and parser live together so the shape has one
// home; the executor writes it, and anything answering "why didn't it run" — the
// dashboard above all — reads it back.
export const LAST_VERDICT_HEADING = 'Last verdict';

export function lastVerdictLines({ at, reason, until }) {
  const lines = [`${at} — the precondition declined: ${reason}`];
  if (until) lines.push(`Asked again at ${until}.`);
  return lines;
}

export function parseLastVerdict(body) {
  const lines = sectionLines(body, LAST_VERDICT_HEADING);
  // The reason may carry the separator itself, so the split is on the FIRST match.
  const first = /^(.*?) — the precondition declined: ([\s\S]*)$/.exec(lines[0] ?? '');
  if (!first) return null;
  const until = lines.map((l) => /^Asked again at (.*?)\.?$/.exec(l)).find(Boolean)?.[1] ?? null;
  return { at: first[1], reason: first[2], until };
}

// Fold a second set of Context lines into the first, keeping order and dropping
// exact duplicates. Both sides are real scope — the item carries what its creator
// bound it to, the precondition adds what this occurrence found — and a set-write
// from either side would drop the other's.
export const mergeContext = (...groups) => [...new Set(groups.flat().filter((l) => l && l.trim()))];

// Stamp (or clear) `Not-before` on an existing body, in place where the field is
// already present and directly under the task path otherwise. Text surgery rather
// than a rebuild: the body also carries the creating precondition's Context and
// code-work's Delivered section, which belong to whoever wrote them.
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

// Set a section of an item body (the Context, code-work's Delivered, the agent's Why)
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
// `aliases` are older spellings of the SAME heading. The section is rewritten under
// `heading`, but located by any of them, so a body written before a rename is updated
// in place instead of gaining a second section.
export function withSection(body, heading, lines, aliases = []) {
  if (!lines.length) return body;
  const text = String(body ?? '').replace(/\s*$/, '');
  const section = [`### ${heading}`, '', ...lines.map((l) => `- ${l}`)];
  const existing = text.split('\n');
  const wanted = new Set([heading, ...aliases].map((h) => `### ${h}`));
  const at = existing.findIndex((l) => wanted.has(l.trim()));
  if (at === -1) return `${text}\n\n${section.join('\n')}\n`;
  const after = existing.findIndex((l, i) => i > at && l.startsWith('### '));
  const tail = after === -1 ? [] : ['', ...existing.slice(after)];
  return `${[...existing.slice(0, at), ...section, ...tail].join('\n')}\n`;
}
