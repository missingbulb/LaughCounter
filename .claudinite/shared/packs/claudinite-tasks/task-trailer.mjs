// The commit trailer that says "a scheduled task wrote this", and the reader that
// recognizes it (task-preconditions DESIGN, "Classifying task output structurally").
//
// The silence gate needs to tell the project moving from the machinery running,
// and it must not do so by pattern-matching what a task happened to TITLE its PR:
// every new task's title is then a new leak, discovered only as a task re-armed by
// its own output. So every delivery lane that commits on a task's behalf stamps
// this trailer, and the movement terms read it — the writer classifies its own
// output, so a task added tomorrow is classified correctly on its first run with
// nothing to remember.
//
// It is deliberately the same shape as merge-policy.mjs's `Claudinite-Automerge-Policy`:
// a trailer is what survives a squash merge into the default branch, which is the
// commit the `commits` collector actually reads.

export const TASK_TRAILER = 'Claudinite-Task';

// `Claudinite-Task: <pack>/<task>` on its own line, anywhere in the message.
export const TASK_TRAILER_RE = /^Claudinite-Task:[ \t]*(\S+)[ \t]*$/m;

// The trailer line to append to a commit message, or '' when the writer does not
// know which task it is running as (a hand-run worker, a member's own script) —
// so a caller can always interpolate the return value.
export const taskTrailer = (taskId) => (taskId ? `${TASK_TRAILER}: ${taskId}` : '');

// `message` with the trailer appended, separated by a blank line so it lands in
// the message's trailer block. A message that already carries the trailer is
// returned untouched: the lanes compose (a worker's own message, then the merge
// commit built from it), and a doubled trailer reads as two tasks.
export function withTaskTrailer(message, taskId) {
  const line = taskTrailer(taskId);
  if (!line || TASK_TRAILER_RE.test(message ?? '')) return message ?? '';
  return `${(message ?? '').trimEnd()}\n\n${line}\n`;
}

// Which task wrote this commit, or null when nothing did. `null` is UNKNOWN as
// much as it is "a person wrote it" — every caller pairs it with the older
// author/title/path exclusions, which is what still classifies history from
// before the trailer existed.
export function taskFromMessage(message) {
  const m = TASK_TRAILER_RE.exec(message ?? '');
  return m ? m[1] : null;
}
