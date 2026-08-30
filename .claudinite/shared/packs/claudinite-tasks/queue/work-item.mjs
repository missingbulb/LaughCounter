// The work item — the queue's one durable object (tasks-dispatch DESIGN §3, §4).
// An issue titled `[claudinite-work] <pack>/<task> [qualifier]`, whose labels are
// its state, whose body's first line is the task path, and whose optional body
// fields (`Not-before`, `Blocked-by`, and a request's `Request` / `Model`) are the
// only facts it carries beyond that.
//
// PURE, and deliberately the whole schema: everything else — anchors, guards,
// yields, leashes, verdicts — is computed fresh at every scheduler run and pick from the
// engine and the declarations at HEAD (DESIGN §14). The label-and-field vocabulary
// here is therefore the compatibility surface across engine versions, which is why
// additive change is the strongly preferred shape and a rename needs a migration.
//
// Parse/serialize of those fields lives here and nowhere else (DESIGN §9).
//
// The one import, and a frozen constant at that: the pack-rename map, which this
// module needs to keep reading titles written before a rename (see parseWorkItemTitle).
import { canonicalPackId } from '../../../engine/pack_loader/renamed-packs.mjs';

// The title prefix. Disjoint from the slot mechanism's `[claudinite-task]` on
// purpose: the two mechanisms coexist per-repo behind `taskScheduler.dispatch`,
// and neither may read the other's issues (DESIGN §14, S29).
export const WORK_PREFIX = '[claudinite-work]';

// --- the canonical vocabulary (DESIGN §4, the migration of #1119) -------------
// Every label the machinery writes is one of three things — the item's single
// STATUS, its lifelong ORIGIN, or the URGENCY flag — and all of them live in the
// `task:` namespace. These are the spellings a reader compares against: decode
// first (`statusOf`, `originOf`), then compare, so an item filed by any engine
// version answers the same question the same way.
export const STATUS_PREFIX = 'task:status:';
export const PARK_PREFIX = `${STATUS_PREFIX}needs-human-`;

export const STATUS_BLOCKED = `${STATUS_PREFIX}blocked`;
export const STATUS_READY = `${STATUS_PREFIX}waiting-for-executor`;
export const STATUS_RUNNING_EXECUTOR = `${STATUS_PREFIX}running-executor`;
export const STATUS_RUNNING_AGENT = `${STATUS_PREFIX}running-agent`;
export const STATUS_NEEDS_HUMAN_ACTION = `${PARK_PREFIX}action`;
export const STATUS_NEEDS_HUMAN_DECISION = `${PARK_PREFIX}decision`;
export const STATUS_NEEDS_HUMAN_APPROVAL = `${PARK_PREFIX}approval`;
export const STATUS_NEEDS_HUMAN_FAILURE = `${PARK_PREFIX}failure`;
export const STATUS_DONE = `${STATUS_PREFIX}done`;
export const STATUS_REJECTED = `${STATUS_PREFIX}rejected`;

// The four statuses an OPEN item may wear before it parks or converges. An open
// item wearing no decodable status at all is off the state machine — a torn label
// swap's leavings, which the janitor repairs (DESIGN §6.2, §11).
export const LIVE_STATUSES = Object.freeze([
  STATUS_BLOCKED, STATUS_READY, STATUS_RUNNING_EXECUTOR, STATUS_RUNNING_AGENT,
]);
// The park kinds, in the order a decoder prefers them when an item somehow wears
// more than one: `failure` first, because it is the conservative lane — the one
// that holds the task's lane rather than letting a broken task keep filing work.
export const PARK_KINDS = Object.freeze(['failure', 'action', 'decision', 'approval']);
export const PARK_STATUSES = Object.freeze(PARK_KINDS.map((k) => `${PARK_PREFIX}${k}`));
export const STATUS_LABELS = Object.freeze([
  ...LIVE_STATUSES, ...PARK_STATUSES, STATUS_DONE, STATUS_REJECTED,
]);

// THE ORIGIN (DESIGN §3, decision §15.29) — who asked for this item, worn for the
// item's whole life beside whatever status it holds. Read here; the writers arrive
// with the write-side flip.
export const ORIGIN_PREFIX = 'task:origin:';
export const ORIGIN_PLANNED = `${ORIGIN_PREFIX}planned`;
export const ORIGIN_AD_HOC = `${ORIGIN_PREFIX}ad-hoc`;
export const ORIGIN_GITHUB = `${ORIGIN_PREFIX}github`;
export const ORIGIN_LABELS = Object.freeze([ORIGIN_PLANNED, ORIGIN_AD_HOC, ORIGIN_GITHUB]);

// --- the write spellings ------------------------------------------------------
// What this engine APPLIES — the canonical vocabulary above, since the write-side
// flip (#1119). The names survive the flip because fielded pack versions import
// them: a pack still on the old engine's spelling writes a legacy label, which
// every decoder here reads as the status it always meant.
export const BLOCKED = STATUS_BLOCKED;
export const READY = STATUS_READY;
export const URGENT = 'task:urgent';
export const EXECUTING = STATUS_RUNNING_EXECUTOR;
export const AGENT = STATUS_RUNNING_AGENT;
export const TASK_DONE = STATUS_DONE;
export const TASK_OBSOLETE = STATUS_REJECTED;

// --- the legacy spellings, written never and read forever ----------------------
// Every spelling any fielded engine has written. They are literals rather than
// aliases of the constants above precisely because those constants moved: a decode
// map built from them would have mapped today's spelling to itself and forgotten
// the vocabulary it exists to read (DESIGN §4).
export const LEGACY_BLOCKED = 'task:blocked';
export const LEGACY_READY = 'task:ready';
export const LEGACY_EXECUTING = 'task:executing';
export const LEGACY_AGENT = 'task:agent';

// @deprecated The bare park of the two-label era. A park is ONE label now
// (`task:status:needs-human-<kind>`); this is still read — on its own it decodes to
// `failure`, the conservative lane — and still ensured, because an open item filed
// by a fielded engine wears it.
export const NEEDS_HUMAN = 'needs-human';

// @deprecated Nothing writes this since the approval park: a run that left an
// unmerged PR no longer CLOSES as delivered, it parks at the approval lane and
// waits to be merged. Kept exported, kept in `QUEUE_LABELS`, and still read
// everywhere it was read — closed issues carrying it are stored data, and a decoder
// that stopped recognising it would turn every historical delivered run into an
// un-outcomed one.
export const OUTCOME_DELIVERED = 'outcome:delivered';

// @deprecated The pre-2026-08-19 terminal spellings. Kept exported so a fielded
// pack that imports them still loads, and READ wherever an outcome is decoded:
// labels are stored data on closed issues fleet-wide, so a decoder that stopped
// recognising these would turn every historical run into an un-outcomed one.
export const OUTCOME_DONE = 'outcome:done';
export const OUTCOME_OBSOLETE = 'outcome:obsolete';

// @deprecated The pre-#1119 terminal spellings in the `task:` namespace, the
// generation between `outcome:*` and today's statuses. Read forever, same reason.
export const LEGACY_TASK_DONE = 'task:done';
export const LEGACY_TASK_OBSOLETE = 'task:obsolete';

// @deprecated The origin marker (DESIGN §15.26). Nothing writes it and nothing
// branches on it: whether an item is a task's standing occurrence or an ad-hoc run
// is STRUCTURAL — see `isStandingItem` — so a marker that could disagree with the
// structure was a second authority over the same fact. Kept exported and inert
// because open items filed by an older engine still carry it, and a reader that
// choked on an unknown label would fail on exactly those.
export const ORIGIN_SCHEDULE = 'origin:schedule';

// THE PARK KINDS. A park is ONE label since the flip — `task:status:needs-human-<kind>`
// — and the kind is what the human is being asked for, which is the whole
// difference between a queue a person can skim and one they have to read.
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
//
// The names are the ones fielded packs import; their VALUES are today's park
// statuses. The two-label era's sub-labels (`task:needs-human-<kind>`) are read by
// `parkOf` below and written by nobody.
export const NEEDS_HUMAN_ACTION = STATUS_NEEDS_HUMAN_ACTION;
export const NEEDS_HUMAN_DECISION = STATUS_NEEDS_HUMAN_DECISION;
export const NEEDS_HUMAN_APPROVAL = STATUS_NEEDS_HUMAN_APPROVAL;
export const NEEDS_HUMAN_FAILURE = STATUS_NEEDS_HUMAN_FAILURE;
export const TRIAGE_LABELS = PARK_STATUSES;

// WHICH PARKS HOLD THE TASK'S LANE. A task's open STANDING item is the occurrence
// itself, so while one exists the generator files no further occurrence
// (`planSchedulerRun` job 1) — which for a park means the task stops being scheduled at
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
export const isBlockingPark = (item) => statusOf(item) === STATUS_NEEDS_HUMAN_FAILURE;

// --- the decode (DESIGN §4, "legacy spellings — written never, read forever") --
// Labels are STORED DATA: open items filed by a fielded engine wear its spellings,
// closed items keep theirs forever, and members converge on their own schedules. So
// every reader here goes through one pass that maps every spelling ever written
// straight to today's — never through a literal comparison against one of them.
const LEGACY_STATUS = new Map([
  [LEGACY_BLOCKED, STATUS_BLOCKED],
  [LEGACY_READY, STATUS_READY],
  [LEGACY_EXECUTING, STATUS_RUNNING_EXECUTOR],
  [LEGACY_AGENT, STATUS_RUNNING_AGENT],
  [LEGACY_TASK_DONE, STATUS_DONE], [OUTCOME_DONE, STATUS_DONE],
  [LEGACY_TASK_OBSOLETE, STATUS_REJECTED], [OUTCOME_OBSOLETE, STATUS_REJECTED],
]);

const LEGACY_PARK_RE = /^task:needs-human-(.+)$/;

// The park an issue's labels name, canonical, or null. Both shapes decode here:
// today's single `task:status:needs-human-<kind>` and the legacy pair
// (`needs-human` plus a sub-label). A kind nobody here knows — a bare legacy park,
// or a word a newer engine invented — reads as `failure`, the conservative lane.
function parkOf(names) {
  const kinds = [
    ...names.filter((n) => n.startsWith(PARK_PREFIX)).map((n) => n.slice(PARK_PREFIX.length)),
    ...names.map((n) => LEGACY_PARK_RE.exec(n)?.[1]).filter(Boolean),
  ];
  if (!kinds.length && !names.includes(NEEDS_HUMAN)) return null;
  return `${PARK_PREFIX}${PARK_KINDS.find((k) => kinds.includes(k)) ?? 'failure'}`;
}

// Every distinct status an issue's labels decode to. One entry per status, so an
// item mid-flip — wearing a legacy spelling beside its canonical one — reads as the
// ONE status it is, and only genuinely conflicting labels read as more than one
// (the dashboard's `torn`).
export function statusesOn(issue) {
  const names = labelNames(issue);
  const out = new Set();
  const park = parkOf(names);
  if (park) out.add(park);
  for (const n of names) {
    if (STATUS_LABELS.includes(n) && !n.startsWith(PARK_PREFIX)) out.add(n);
    else if (LEGACY_STATUS.has(n)) out.add(LEGACY_STATUS.get(n));
  }
  return [...out];
}

// THE status an issue wears, canonical, or null for one wearing none. A park wins
// over anything else present: a torn transition that left a state label beside a
// park must read as parked, or the queue would pick up an item a human owns.
export function statusOf(issue) {
  const worn = statusesOn(issue);
  return worn.find((s) => s.startsWith(PARK_PREFIX))
    ?? STATUS_LABELS.find((s) => worn.includes(s))
    ?? null;
}

export const isStatus = (issue, status) => statusOf(issue) === status;
export const isParked = (issue) => (statusOf(issue) ?? '').startsWith(PARK_PREFIX);
export const parkKindOf = (issue) =>
  (isParked(issue) ? statusOf(issue).slice(PARK_PREFIX.length) : null);

// The origin an issue wears, or null. Unlike the status there is no legacy
// spelling to fold in: `origin:schedule` is inert stored data (see ORIGIN_SCHEDULE),
// and reading it as an origin would put a marker nothing writes back into play.
export const originOf = (issue) =>
  labelNames(issue).find((n) => ORIGIN_LABELS.includes(n)) ?? null;

// Every spelling that MEANS `status` — what a transition out of it has to clear,
// since the item may wear any engine's. Leaving a park clears every park spelling
// whatever its kind: a re-queue takes the item out of the human's hands entirely.
export function spellingsOf(status) {
  if (String(status ?? '').startsWith(PARK_PREFIX)) {
    return [...PARK_STATUSES, ...PARK_KINDS.map((k) => `task:needs-human-${k}`), NEEDS_HUMAN];
  }
  const legacy = [...LEGACY_STATUS].filter(([, canonical]) => canonical === status).map(([l]) => l);
  return [status, ...legacy];
}

// THE RE-QUEUE LEVER, in words — one home, because it is written into every message
// that parks an item and a stale copy of it is an instruction that no longer works.
// Clearing the status IS the re-ask (DESIGN §16.3): a park is one label now, so
// there is nothing else to take off.
export const requeueHint = `clear its status label and add \`${STATUS_READY}\``;

// A kind word (from a worker's own triage marker, or a call site) to the park it
// names. Anything unrecognised is a `failure`: a worker that misspells its class has
// a bug, which is exactly what that lane means.
export const triageLabelFor = (kind) =>
  (PARK_KINDS.includes(kind) ? `${PARK_PREFIX}${kind}` : STATUS_NEEDS_HUMAN_FAILURE);


// The stored-data rename rule, decode side: every spelling ever written maps
// STRAIGHT to the canonical word, in one pass — including `outcome:delivered`,
// which nothing writes any more but closed issues carry forever.
const OUTCOME_WORDS = new Map([[STATUS_DONE, 'done'], [STATUS_REJECTED, 'obsolete']]);

// The one outcome an issue's labels carry, as the canonical word ('done',
// 'delivered', 'obsolete') or null. Everything that tallies or renders outcomes
// decodes through here, so a spelling change is one map entry and not a sweep.
export function outcomeOf(issue) {
  // `statusesOn` rather than `statusOf`: a closed item's terminal write is its
  // outcome even when a park label stands beside it, and park precedence is a
  // question about LIVE items — what the queue may pick up — not about history.
  const worn = statusesOn(issue);
  for (const [status, word] of OUTCOME_WORDS) if (worn.includes(status)) return word;
  return hasLabel(issue, OUTCOME_DELIVERED) ? 'delivered' : null;
}

// --- the request vocabulary, retired (DESIGN §4's legacy table, §16.1) --------
// @deprecated The three labels the SHADOW-ITEM request model used. The mark is
// `task:origin:ad-hoc` now and the marked issue is the item itself, so nothing here
// applies these — but they are read forever: `claude-task` is still accepted as a
// mark (a person with it in muscle memory, a template that carries it), and an
// issue whose shadow item is still draining wears `claude-queued`.
//
// What survives the retirement is the reason the mark is a LABEL at all: it must be
// appliable from the issue page on a phone, and it is write-gated by the platform —
// applying a label needs triage or write access — which is the first half of the
// security story (the second is the precondition's permission read at pickup,
// §16.4). A request's PARAMETERS are body fields (`parseRequestFields`), gated on
// the author's push access instead, and no label carries one: a `claude-model:` or
// `claude-automerge` label applied by hand asks for nothing.
export const REQUEST_LABEL = 'claude-task';
export const QUEUED_LABEL = 'claude-queued';
export const IN_REVIEW_LABEL = 'claude-in-review';

// The families a request may ask for in its `Model:` field. `none` is not among
// them: a request is implemented by a session, so an agentless family would name a
// run that cannot happen.
export const REQUEST_MODELS = Object.freeze(['opus', 'sonnet', 'haiku']);

// The four state labels an open item may wear. An open item wearing none of them
// and no `needs-human` is off the state machine entirely — a torn label swap's
// leavings, which the janitor repairs (DESIGN §6.2, §11).
export const STATE_LABELS = [BLOCKED, READY, EXECUTING, AGENT];

// The canonical statuses the same four decode to — what a reader tests against,
// since an item may wear either engine's spelling (`statusesOn`).
export { LIVE_STATUSES as STATE_STATUSES };

// Every label this mechanism applies, with the colour and description a bootstrap
// one-off would have given it. Ensured create-if-missing before anything is
// applied: GitHub 422s when you apply an unknown label and never creates one on
// demand, so the thing that assigns a label guarantees it first.
//
// The LEGACY block below is ensured too, and that is deliberate: nothing writes
// those spellings any more, but open items filed by a fielded engine wear them and
// deleting a label strips it from every issue that carries it — including closed
// ones, which are stored data (DESIGN §4).
export const QUEUE_LABELS = [
  { name: STATUS_BLOCKED, color: 'c5def5', description: 'Claudinite queue: waiting on Blocked-by and/or Not-before' },
  { name: STATUS_READY, color: '0e8a16', description: 'Claudinite queue: available for an executor to pick up' },
  { name: URGENT, color: 'd93f0b', description: 'Claudinite queue: pick this before any non-urgent item' },
  { name: STATUS_RUNNING_EXECUTOR, color: 'fbca04', description: 'Claudinite queue: an executor holds the claim' },
  { name: STATUS_RUNNING_AGENT, color: '1d76db', description: 'Claudinite queue: an agent session owns this item' },
  { name: STATUS_NEEDS_HUMAN_ACTION, color: 'b60205', description: 'Claudinite queue: parked — a human must change something outside the code' },
  { name: STATUS_NEEDS_HUMAN_DECISION, color: 'd93f0b', description: 'Claudinite queue: parked — a human must choose what happens next' },
  { name: STATUS_NEEDS_HUMAN_APPROVAL, color: '5319e7', description: 'Claudinite queue: parked — succeeded and left an unmerged PR to approve' },
  { name: STATUS_NEEDS_HUMAN_FAILURE, color: 'b60205', description: 'Claudinite queue: parked — the run broke, diagnose and fix' },
  { name: STATUS_DONE, color: '0e8a16', description: 'Claudinite queue: succeeded, nothing pending' },
  { name: STATUS_REJECTED, color: 'ededed', description: 'Claudinite queue: never ran — the precondition said no, or the task is gone' },
  { name: ORIGIN_PLANNED, color: 'c2e0c6', description: 'Claudinite queue: filed by the schedule — a task\'s own occurrence' },
  { name: ORIGIN_AD_HOC, color: 'bfd4f2', description: 'Claudinite queue: asked for by a person — a one-issue request or a hand-created run' },
  { name: ORIGIN_GITHUB, color: 'd4c5f9', description: 'Claudinite queue: filed by the platform itself — a workflow reporting its own failure' },
  // Legacy, kept alive for the items that wear them.
  { name: LEGACY_BLOCKED, color: 'c5def5', description: 'Claudinite queue (legacy): waiting on Blocked-by and/or Not-before' },
  { name: LEGACY_READY, color: '0e8a16', description: 'Claudinite queue (legacy): available for an executor to pick up' },
  { name: LEGACY_EXECUTING, color: 'fbca04', description: 'Claudinite queue (legacy): an executor holds the claim' },
  { name: LEGACY_AGENT, color: '1d76db', description: 'Claudinite queue (legacy): an agent session owns this item' },
  { name: NEEDS_HUMAN, color: 'b60205', description: 'Claudinite queue (legacy): parked for a human' },
  { name: LEGACY_TASK_DONE, color: '0e8a16', description: 'Claudinite queue (legacy): succeeded, nothing pending' },
  { name: LEGACY_TASK_OBSOLETE, color: 'ededed', description: 'Claudinite queue (legacy): never ran' },
  { name: OUTCOME_DELIVERED, color: '5319e7', description: 'Claudinite queue (legacy): succeeded and left a live artifact the world still has to act on' },
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
// scheduler run would not recognise its own live item, would file a second one beside it, and
// would leave the first orphaned in the queue with nothing ever draining it.
export function parseWorkItemTitle(title) {
  const m = TITLE_RE.exec(String(title ?? '').trim());
  return m ? { pack: canonicalPackId(m[1]), task: m[2], qualifier: m[3]?.trim() || null } : null;
}

export const isWorkItemTitle = (title) => parseWorkItemTitle(title) !== null;

// The `<pack>/<task>` id a WORKER PATH names — the identity half a marked issue's
// title cannot carry (DESIGN §16.1), read off the path its machine block names. Two
// shapes, because tasks have two homes: the `tasks/` slot a declared pack contributes,
// and the queue's own built-in root. The `.claudinite/shared/` prefix is optional in
// both — a member's mount is there and the canon runs its own tree.
//
// THE BUILT-IN ROOT HAS TWO SPELLINGS, and both are permanent. The surface moved from
// `engine/scheduler/` to the tasks pack (#1317), so a live item minted before the move
// still names the engine path while every new one names the pack path; the wire id
// either produces is unchanged, which is what the move promised. Stored data is
// renamed on the DECODE side or it stops decoding, and here that failure is silent:
// this is the fallback for a marked issue, whose title is the requester's own words,
// so a path that yields null leaves the item unattributable rather than rejected.
//
// It is a PARSE, not a lookup: anything that must know the task exists at HEAD
// resolves the path against the discovered task set instead (the executor does).
const PACK_TASK_PATH_RE = /^(?:\.claudinite\/shared\/)?packs\/([^/]+)\/tasks\/([^/]+)\/[^/]+$/;
const BUILT_IN_TASK_PATH_RE = /^(?:\.claudinite\/shared\/)?(?:engine\/scheduler|packs\/claudinite-tasks)\/queue\/tasks\/([^/]+)\/[^/]+$/;

export function taskIdFromPath(path) {
  const p = String(path ?? '');
  const pack = PACK_TASK_PATH_RE.exec(p);
  if (pack) return { pack: canonicalPackId(pack[1]), task: pack[2] };
  const builtIn = BUILT_IN_TASK_PATH_RE.exec(p);
  return builtIn ? { pack: 'engine', task: builtIn[1] } : null;
}

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
// to hand one over. `Model` is the family the asker chose, copied here by the scheduler run
// from a write-gated label and read only by a task that declares
// `model_from_request`; it is the first thing an item carries that defines
// behaviour, which is why it is fenced rather than waved through (§16.7).
export const REQUEST_FIELD = 'Request';
export const MODEL_FIELD = 'Model';

// `Task` is the TARGETING field (DESIGN §16, the one-issue request): which task a
// marked issue asks for, as `<pack>/<task>`. Absent, the ask is the built-in
// request implementer, which is what an ordinary "implement this issue" mark means.
// It rides the same author gate as `Model` and `Merge`: naming a task is choosing
// what runs, and a body is editable by whoever opened the issue.
export const TASK_FIELD = 'Task';

// `Merge` is the asker's standing authorization: a POLICY EXPRESSION the run
// hands to the policy engine (merge-policy.mjs) — `anything`, a `a;b;reject:c`
// rule list, or the legacy `if-narrow` (the narrow-diff composite). The run may
// land its own pull request only on that engine's yes, and must park for
// approval otherwise. An absent field is the default — never merge — so an item
// an older scheduler run wrote reads as unauthorized rather than as authorized.
export const MERGE_FIELD = 'Merge';
// The field's one pre-policy value, still the canonical spelling the legacy
// `yes`/`true` aliases collapse to on their way in.
export const MERGE_IF_NARROW = 'if-narrow';

// A Merge/Automerge field value, fenced to what the policy engine can read: the
// canonical expression, or null for anything else. Fencing here is about SHAPE
// only — a well-formed policy naming a rule nobody defines rides through and
// fails closed at the verdict, loudly, which is better feedback than silently
// ignoring the ask. A policy of `nothing` is the default already, so it reads
// as absent.
//
// The grammar mirrors merge-policy.mjs's normalizePolicy — the semantic
// authority — and cannot import it: this module is deliberately pure (see the
// header), so the drift guard is the test that runs a value matrix through both
// sides (test/queue/request-mode.test.mjs).
const POLICY_TERM = /^(reject:)?[a-z0-9]+(-[a-z0-9]+)*$/;
function policyFieldValue(raw) {
  if (raw == null) return null;
  const value = String(raw).trim();
  if (['if-narrow', 'yes', 'true'].includes(value.toLowerCase())) return MERGE_IF_NARROW;
  if (value.toLowerCase() === 'anything') return 'anything';
  const terms = value.split(';').map((t) => t.trim());
  const wellFormed = terms.length > 0
    && terms.every((t) => POLICY_TERM.test(t) && t !== 'nothing')
    && terms.some((t) => !t.startsWith('reject:'));
  return wellFormed ? value : null;
}

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

// --- the machine block (DESIGN §16.1, §16.3) ----------------------------------
// A one-issue request's item IS the issue somebody marked, so the item's fields
// share a body a person authored and keeps editing. They live in one delimited
// block, appended at adoption and rewritten in place after that: everything outside
// it belongs to the human, everything inside it to the machine, and a parser that
// read the whole body would take a sentence of prose for a field.
//
// A `[claudinite-work]` item has no block — its whole body is the machine's — so
// every reader here falls back to the whole text, which is what keeps items filed
// before the one-issue model draining unchanged.
export const MACHINE_BLOCK_START = '<!-- claudinite-item -->';
export const MACHINE_BLOCK_END = '<!-- /claudinite-item -->';

const BLOCK_RE = /<!-- claudinite-item -->\n?([\s\S]*?)\n?<!-- \/claudinite-item -->/;

// The machine's half of a body, or null where there is no block at all.
export const machineBlockOf = (body) => BLOCK_RE.exec(String(body ?? ''))?.[1] ?? null;

// The machine's half to read fields out of: the block where there is one, the whole
// body otherwise.
export const itemFieldText = (body) => machineBlockOf(body) ?? String(body ?? '');

// Replace the block, or append one to a body that has none. The human's text is
// never rewritten — an append lands after it, separated by a blank line.
export function withMachineBlock(body, block) {
  const text = String(body ?? '');
  const wrapped = `${MACHINE_BLOCK_START}\n${block.replace(/\s*$/, '')}\n${MACHINE_BLOCK_END}`;
  if (BLOCK_RE.test(text)) return text.replace(BLOCK_RE, wrapped);
  return `${text.replace(/\s*$/, '')}\n\n${wrapped}\n`;
}

// Apply an edit to whichever half is the machine's. Every writer that reshapes an
// item body — a Context section, code-work's delivered list, a stamped
// `Not-before` — goes through here, so it edits the block on a marked issue and the
// whole body on a `[claudinite-work]` item, with one call site either way.
export function editItemBody(body, edit) {
  const block = machineBlockOf(body);
  return block === null ? edit(String(body ?? '')) : withMachineBlock(body, edit(block));
}

// The human's half of a body — everything the machine block is not. A marked
// issue's PARAMETERS are read from here and never from the block: re-asking clears
// the status and leaves the previous run's block standing, and a parser that read
// the whole body would find that stale copy beside the person's own field.
export const humanTextOf = (body) => String(body ?? '').replace(BLOCK_RE, '').trim();

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

// Parse an item body back into the facts the scheduler run and the executor read. A body
// with no first line, or whose fields are absent, yields nulls — absence is
// meaningful everywhere here and is never filled in with a default.
export function parseWorkItemBody(body) {
  const text = itemFieldText(body);
  const taskPath = text.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? null;
  const nb = NOT_BEFORE_RE.exec(text)?.[1]?.trim() || null;
  const blockedBy = parseBlockedBy(text);
  const request = REQUEST_RE.exec(text) ? Number(REQUEST_RE.exec(text)[1]) : null;
  // An unrecognised family reads as absent rather than as itself: the item's model
  // is behaviour-defining, so the only values that leave this parser are ones the
  // engine can actually dispatch at (§16.7).
  const askedModel = MODEL_RE.exec(text)?.[1] ?? null;
  const model = REQUEST_MODELS.includes(askedModel) ? askedModel : null;
  // Same fencing as the model: an authorization that does not read as a policy
  // expression reads as absent, and absent is the safe end of this field — a run
  // that cannot read its permission opens a pull request and waits.
  const merge = policyFieldValue(MERGE_RE.exec(text)?.[1] ?? null);
  return { taskPath, notBefore: nb, blockedBy, request, model, merge };
}

// WHAT A MARKED ISSUE ASKS FOR (DESIGN §16.3, §16.7, §16.11) — read from the
// person's own text at every adoption, so each ask names its parameters afresh and
// nothing stale outranks a new one.
//
// Whoever files the issue puts these on its FIRST LINES, as one block ahead of the
// prose — `basics/skills/do-later/SKILL.md` is where that placement is prescribed and
// argued. The parser does not care where they sit; a person editing the issue, and a
// retry rewriting `Not-before`, do.
//
// `gated` is whether the issue's AUTHOR holds push access. A body is editable by
// whoever opened the issue where a label was write-gated by the platform, so the
// three behaviour-defining fields are honoured only for an author who could have
// applied them as labels anyway; an ungated ask still runs, at the default task and
// model and with no authorization to land anything.
export function parseRequestFields(body, { gated = false } = {}) {
  const text = humanTextOf(body);
  const asked = {
    task: /^Task:[ \t]*(\S+)/m.exec(text)?.[1] ?? null,
    model: MODEL_RE.exec(text)?.[1] ?? null,
    automerge: /^Automerge:[ \t]*(\S+)/m.exec(text)?.[1]?.toLowerCase() ?? null,
  };
  const blockedBy = parseBlockedBy(text);
  const notBefore = NOT_BEFORE_RE.exec(text)?.[1]?.trim() || null;
  if (!gated) return { task: null, model: null, merge: null, blockedBy, notBefore, ungated: Object.values(asked).some(Boolean) };
  return {
    task: /^[^/\s]+\/[^/\s]+$/.test(asked.task ?? '') ? asked.task : null,
    // An unrecognised family reads as absent rather than failing the request: a run
    // nobody can start would look accepted forever.
    model: REQUEST_MODELS.includes(asked.model) ? asked.model : null,
    merge: policyFieldValue(asked.automerge),
    blockedBy,
    notBefore,
    ungated: false,
  };
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
// issue's Context section", singular. The one it reads first is then the scheduler run's birth
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
