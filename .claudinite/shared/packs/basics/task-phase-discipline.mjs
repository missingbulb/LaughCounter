import { finding } from '../../engine/checks/helpers/findings.mjs';

// A task decides whether it runs in its PRECONDITION, and nowhere else (owner,
// 2026-08-06). Once the precondition says run, the two execution phases —
// deterministic prework, then agentic work — do the work; neither may discover
// a new reason to skip it for state, timing, or "already handled" reasons.
// Failures are allowed to stop a run; discretion is not. "The work ran and
// produced nothing" is always legal — that is an outcome, not a skip.
//
// This is the check-the-world sweep that hunts for tasks that ESCAPE in the
// later phases: instruction files (task.md) telling the agent to stop or skip
// when some state holds, and prework workers logging that they are skipping a
// cycle. It is a HEURISTIC over natural language, so it is advisory — its job
// is to surface candidates for a human (or the authoring session) to judge, and
// the tell-tale phrases were taken from real violations found in the 2026-08-06
// audit, not invented.
//
// Exemption: a line that scopes by the dispatch issue's `Context` is the
// precondition speaking (its verdict lands there verbatim), so "skip this half
// when Context says it is out of scope" is precondition-decided, not an escape.
// RELEVANCE FIRST: keyed on tasks/<name>/ files, inert on a repo without tasks.
const TASK_MD = /(^|\/)tasks\/[^/]+\/task\.md$/;
const TASK_HELPER_MJS = /(^|\/)tasks\/[^/]+\/[^/]+\.mjs$/;
const TASK_DECL = /(^|\/)task\.mjs$/;

// A skip word next to a condition word, in one instruction line. `stop` is
// matched lowercase-only on purpose: capitalized "Stop" in this corpus is the
// harness's Stop hook, not an instruction to stop.
const SKIP_WORD = /\b([Ss]kip(?:s|ped|ping)?|stop(?: here)?|[Aa]bort|[Bb]ail(?: out)?|[Dd]o\s+(?:\*\*?not\*\*?|not)\s+(?:run|proceed|continue|stack)|[Ll]eav(?:e|ing)\s+(?:it\s+|this\s+)?(?:cycle'?s?\s+)?(?:converge\s+)?undelivered)\b/;
const CONDITION_WORD = /\b(if\b|when\b|unless\b|already\b|still\s+(?:open|running|unreviewed)|(?:nothing|no\s+new|not?\s+\w+)\s+(?:changed|has\s+changed)|before\s+(?:anything|starting|researching)|unset\s+means|absent\b)\b/i;
// Two legal shapes share the vocabulary: a scope carved by the precondition's
// Context, and a line DESCRIBING the precondition's own verdicts (status
// vocabulary like "skipped (its precondition said no)").
const CONTEXT_EXEMPT = /\bContext\b|\bprecondition\b/;

// A prework worker announcing it decided not to do this cycle's work.
const WORKER_SKIP_STRING = /(skip(?:ping)?\s+this\s+(?:cycle|run)|leaving\s+this\s+cycle|cycle\s+skips|nothing\s+to\s+self-refresh)/i;

const rule = {
  id: 'task-phase-discipline',
  severity: 'advisory',
  description: 'After a task\'s precondition passes, neither phase of its execution (prework, agentic work) decides to skip the run for state/timing reasons — flags skip-language in task.md instructions and cycle-skip strings in prework workers',
  doc: 'packs/basics/scheduled-tasks.md',
  why: 'the precondition is the ONLY decision point: a later-phase skip hides work from the run records (a "ran, did nothing" that was really "declined to run"), re-litigates a verdict already given, and belongs in the precondition where it is code over signals',

  run(ctx) {
    const out = [];
    for (const file of ctx.files.filter((f) => TASK_MD.test(f))) {
      const text = ctx.read(file);
      if (text === null) continue;
      text.split('\n').forEach((line, i) => {
        if (!SKIP_WORD.test(line) || !CONDITION_WORD.test(line)) return;
        if (CONTEXT_EXEMPT.test(line)) return; // precondition-derived scope, not an escape
        out.push(finding(rule, {
          file,
          line: i + 1,
          what: `instructs a conditional skip after the precondition already passed: "${line.trim().slice(0, 120)}"`,
          fix: 'move the run/no-run decision into the task.mjs precondition (as code over signals, its verdict binding via Context) — or, if the work genuinely ran and found nothing, reword so it reads as an empty outcome, not a decision to skip',
        }));
      });
    }
    for (const file of ctx.files.filter((f) => TASK_HELPER_MJS.test(f) && !TASK_DECL.test(f))) {
      const text = ctx.read(file);
      if (text === null) continue;
      text.split('\n').forEach((line, i) => {
        const m = WORKER_SKIP_STRING.exec(line);
        if (!m) return;
        out.push(finding(rule, {
          file,
          line: i + 1,
          what: `prework announces a discretionary cycle skip ("${m[1]}") — work its precondition asked for was declined in a later phase`,
          fix: 'let the precondition make that call, or complete the work and report an empty outcome; only a genuine failure may stop a run past the precondition',
        }));
      });
    }
    return out;
  },
};

export default rule;
