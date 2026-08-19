// The machine-readable records a task's execution leaves in an Actions log
// (skill-usage-metrics DESIGN §4.2), and the parsers that read them back.
//
// TWO FAMILIES, ONE OF THEM HISTORICAL. `claudinite-task-run` was the SLOT
// scheduler's own line, one per due task per run; the slot scheduler is retired
// (#974) and nothing writes that line any more. The parser stays, and only the
// parser: Actions logs from before the retirement are still inside their retention
// window, and the usage fold still counts them. Nothing new should be taught this
// shape — `claudinite-task-exec` below is the live record.
//
// The counts these produce are exact within the Actions log retention window, and
// that is worth stating next to the capture-derived counts they land beside.

// The five things a slot scheduler run could do with a due task. One name per
// outcome, used verbatim as the counter key in the aggregate, so there is no
// mapping table between "what the run said" and "what the fold counted" to drift.
export const TASK_RUN_OUTCOMES = Object.freeze([
  // A dispatch issue was filed: an agent session ran this task.
  'agent',
  // The task ran with NO agent — an `agent_model: none` task (prework is the
  // whole task), or an agentful one whose prework requested no agent phase.
  'prework',
  // Due, but its precondition said there was nothing to do.
  'skipped',
  // Its prework failed; the run converged the task to a needs-human issue.
  'failed',
  // Due and past its precondition, but no NEW agent run started: this slot was
  // already dispatched (exactly-once), an earlier dispatch is still open
  // (at-most-one-open), or another task claimed the run exclusively. Work that
  // was wanted and did not happen this run.
  'deferred',
]);

// An empty per-task counter row — every outcome present, zeros included, so a row's
// shape never depends on which outcomes a task happened to hit.
export const emptyTaskRun = () => Object.fromEntries(TASK_RUN_OUTCOMES.map((o) => [o, 0]));

// The line format. `v1` is the shape's version: a reader that meets a `v2` line
// knows it is looking at something it was not written for, instead of silently
// half-parsing it.
export const TASK_RUN_TAG = 'claudinite-task-run';
const VERSION = 'v1';

// Actions stamps every log line with its own timestamp before the command's output,
// so the parse tolerates that prefix — without it, a fetched log reads as having
// printed nothing at all.
const LINE_RE = new RegExp(
  String.raw`^(?:\S+\s+)?${TASK_RUN_TAG} ${VERSION} (\S+)/(\S+) \[(\S+)\] ([a-z-]+)\s*$`,
);

// One line → `{ pack, task, slotId, outcome }`, or null for anything that is not a
// record of this version. Deliberately strict: an unknown outcome word is NOT a
// record, because counting it would mint a counter key nothing ever reads.
// `preprocess` is the pre-rename word for the prework outcome (2026-08-06);
// runs logged before the rename still parse, normalized to the canonical word.
export function parseTaskRun(line) {
  const m = LINE_RE.exec(line);
  if (!m) return null;
  const [, pack, task, slotId, word] = m;
  const outcome = word === 'preprocess' ? 'prework' : word;
  if (!TASK_RUN_OUTCOMES.includes(outcome)) return null;
  return { pack, task, slotId, outcome };
}

// Every record in one job log. The log is the whole job's output — this picks its
// own lines out of it and ignores everything else.
export function parseTaskRuns(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    const rec = parseTaskRun(line);
    if (rec) out.push(rec);
  }
  return out;
}

// --- executor-side execution records ------------------------------------------
// The historical records above say what the retired slot scheduler DID with a due
// task; these record what an EXECUTOR SESSION did with the work it ran. Printed by executor-side code
// (resolve-dispatch on a terminal verdict, record-exec.mjs at convergence), they
// land in the session transcript, ride to the conversation-logs branch with the
// executor's capture step, and the usage fold counts them deterministically —
// the "task statuses out of the conversation logs" half of the census (owner,
// 2026-08-06). Same single-home rule: renderer and parser sit here together.

export const TASK_EXEC_STATUSES = Object.freeze([
  // The dispatch ran to completion within its ceiling; the issue was closed.
  'success',
  // The run failed (task failure or ceiling violation); converged to needs-human.
  'failed',
  // The dispatch named a task the repo no longer carries (file gone, pack
  // undeclared) — the executor closed the issue as obsolete. Not a failure.
  'task-gone',
  // The dispatch was malformed (bad path shape, unparseable declaration) and was
  // converged to needs-human without running.
  'invalid',
]);

export const TASK_EXEC_TAG = 'claudinite-task-exec';

// The bracketed field is the OCCURRENCE'S IDENTITY, which is a different thing under
// each dispatch mechanism: a slot id (`d2026-08-06`) where slots decide what runs, and
// the work item's issue number (`#867`) where the queue does. `slotId` keeps its name
// for the fielded records that already carry one; what it must never become is a
// constant, since it is the only join from a record back to the work it describes.
export const renderTaskExec = ({ pack, task, slotId, status }) =>
  `${TASK_EXEC_TAG} ${VERSION} ${pack}/${task} [${slotId ?? 'unknown'}] ${status}`;

const EXEC_LINE_RE = new RegExp(
  String.raw`(?:^|\s)${TASK_EXEC_TAG} ${VERSION} (\S+)/(\S+) \[(\S+)\] ([a-z-]+)\s*$`,
);

export function parseTaskExec(line) {
  const m = EXEC_LINE_RE.exec(line);
  if (!m) return null;
  const [, pack, task, slotId, status] = m;
  if (!TASK_EXEC_STATUSES.includes(status)) return null;
  return { pack, task, slotId, status };
}

export function parseTaskExecs(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    const rec = parseTaskExec(line);
    if (rec) out.push(rec);
  }
  return out;
}
