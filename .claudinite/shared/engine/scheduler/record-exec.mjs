// Print one machine-readable execution record for the dispatch this executor
// session ran — `claudinite-task-exec v1 <pack>/<task> [<slot>] <status>`
// (run-record.mjs, the single home of the format). The executor runs this in
// code at step 4, right after converging its issue, so the record lands in the
// session transcript exactly as printed; the capture step ships the transcript
// to the conversation-logs branch, and the usage fold counts the statuses out
// of it deterministically. Hard-coded on purpose: the count must never depend
// on how an agent chose to phrase its final message.
//
// The code-decided terminal verdicts (`task-gone`, `invalid`) are printed by
// resolve-dispatch.mjs itself; this CLI exists for the two verdicts only the
// end of the run can know (`success`, `failed`).
//
// Usage: node record-exec.mjs <pack>/<task> <slot> <success|failed>

import { pathToFileURL } from 'node:url';
import { renderTaskExec, TASK_EXEC_STATUSES } from './run-record.mjs';

export function execRecordLine(argv) {
  const [family, slotId, status] = argv;
  const m = /^([^/\s]+)\/([^/\s]+)$/.exec(family ?? '');
  if (!m) return { error: `first argument must be <pack>/<task>, got ${JSON.stringify(family ?? null)}` };
  if (!slotId) return { error: 'second argument must be the slot id (from the dispatch brief)' };
  if (!TASK_EXEC_STATUSES.includes(status)) {
    return { error: `third argument must be one of ${TASK_EXEC_STATUSES.join(', ')}, got ${JSON.stringify(status ?? null)}` };
  }
  return { line: renderTaskExec({ pack: m[1], task: m[2], slotId, status }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { line, error } = execRecordLine(process.argv.slice(2));
  if (error) {
    console.error(`record-exec: ${error} — usage: node record-exec.mjs <pack>/<task> <slot> <${TASK_EXEC_STATUSES.join('|')}>`);
    process.exit(2);
  }
  console.log(line);
}
