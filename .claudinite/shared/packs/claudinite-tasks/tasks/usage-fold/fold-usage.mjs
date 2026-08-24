// The usage FOLD's counting and folding core (skill-usage-metrics DESIGN §4, §5).
// Every function here is pure and individually tested; worker.mjs is the I/O shell
// that reads the logs branch, calls these, and delivers the result.
//
// The questions this answers, one tested function each:
//   - which skills did a captured session LOAD, and how often;
//   - what workload was that against (captures, merges, sessions, user messages,
//     user commands) — the denominators without which a raw load count cannot
//     distinguish healthy-rare from broken;
//   - what the SCHEDULER did with each task — agent runs, deterministic
//     preprocessing-only runs, precondition skips, failures, deferrals. That last
//     family comes from the scheduler's own run records rather than from a captured
//     session, which is why it is a census of scheduled work where everything else
//     here is a sample of captured sessions.
//
// Zeros are implicit throughout: a mounted skill with no loads simply has no key.
// The zero set is derived by the consumer, diffing against the repo's mounted
// skills — which is exactly what makes "this skill never loads" visible at all.

// The non-builtin imports are both the engine surface a pack may build on
// (pack-independence). "Which skills does this repo mount" has exactly one home —
// the pack registry — and asking it here is what keeps the fold's answer identical
// to what the SessionStart hook actually mounted. The task-run outcome vocabulary
// has exactly one home too: the scheduler that prints those records, so the counter
// keys here cannot drift from the words the runs actually emit.
import { loadPacks, isActive, bundledSkillSources } from '../../../../engine/pack_loader/pack-registry.mjs';
import { TASK_EXEC_STATUSES, parseTaskExecs } from '../../../claudinite-tasks/run-record.mjs';
// The file's on-disk shape is its SIBLING here (usage-format.mjs). Everything below
// works in the NAMED counter shape and meets the tuples only at the two boundary
// functions at the foot of this file.
import {
  USAGE_FIELDS, USAGE_VERSION, CAPTURE_DAY_FIELDS, WEEK_FROM_DAY, QUEUE_OUTCOMES,
  hourKey, encodeUsageFile, decodeUsageFile,
} from './usage-format.mjs';

// --- entry classification -----------------------------------------------------
// Every shape below was verified against real captured transcripts on a
// conversation-logs branch, not inferred from the harness docs.

// A genuine human turn. POSITIVE test, deliberately: the transcript stamps a
// typed-by-a-person turn with `origin: { kind: 'human' }`, and everything else a
// user-role entry can be — a tool result, an injected/meta turn, a subagent's
// sidechain traffic, a compaction summary, a slash-command expansion, and (the one
// that matters most here) a scheduled-task firing, which carries
// `origin: { kind: 'task-notification', subkind: 'scheduled-trigger' }` — simply
// lacks that stamp. Testing FOR the human marker rather than against a list of
// automated ones means a new automated entry shape is excluded the day it appears
// instead of silently inflating the denominator.
//
// The honest boundary: an older harness wrote no `origin` at all. Those turns count
// as non-human, so a repo's very old captures under-report userMessages rather than
// over-reporting them. This is the most fragile line in the fold, which is why it is
// one function with a fixture per shape it excludes.
export function isUserMessage(entry) {
  return entry?.type === 'user' && entry?.origin?.kind === 'human';
}

// A user-typed slash command. The harness expands `/name args` into a user entry
// whose string content opens with a `<command-name>` tag — the tag is the marker,
// so prose that merely mentions a slash command never counts. Returns the bare
// command name (no leading slash), or null.
const COMMAND_RE = /<command-name>\s*\/?([A-Za-z0-9:_-]+)\s*<\/command-name>/;
export function commandName(entry) {
  if (entry?.type !== 'user') return null;
  const content = entry?.message?.content;
  if (typeof content !== 'string') return null;
  return COMMAND_RE.exec(content)?.[1] ?? null;
}

// Skill names loaded by an assistant entry: every `Skill` tool_use block's
// `input.skill`. Sidechain (subagent) entries are included by the caller — a
// subagent loading a skill is a load.
export function skillToolLoads(entry) {
  if (entry?.type !== 'assistant') return [];
  const content = entry?.message?.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((b) => b?.type === 'tool_use' && b?.name === 'Skill' && typeof b?.input?.skill === 'string')
    .map((b) => b.input.skill);
}

// --- check activations ---------------------------------------------------------
// The conformance checks are the other half of the picture, and the more valuable
// half: a check that FAILS is a win — the finding lands back in the session and the
// agent corrects before the work leaves. So the questions here are "how often did
// each scope actually run" and "how often did it catch something", and the second
// one is the one that matters.
//
// Neither runner writes a metrics file, so both are read off the marks they already
// leave in the transcript. There are exactly three, and each was verified against
// real captured logs:
//
//   1. The Stop hook's `hooklog` line — `<iso> run=<id> Stop: done exit=<n> <reason>`
//      — reaches the transcript because hooklog mirrors to stderr and the harness
//      records hook stderr. This is the ONLY mark that survives a PASSING run, which
//      is what makes work-scope run counts (not just failure counts) possible at all.
//   2. `report-findings`' summary line — `N blocking, M advisory (<scope> scope: …)`
//      — names its own scope and survives the `| tail` an agent usually pipes
//      through. It is printed ONLY when there were findings, so it counts failures
//      and finding volume, never runs.
//   3. The runner's own invocation in a Bash command (`node …/check_the_world.mjs`),
//      which is how the world scope runs — its Stop-hook sibling does not exist,
//      because the world sweep is wired into the test/CI flow, not the hook.
//
// CI COUNTS WHEN THE AGENT WAS IN THE LOOP ON IT. The write-commit-watch-CI-fix-it
// cycle is the same correction loop as the Stop hook's, one turn wider, so a CI
// check failure the session acted on is as much a win as a hook one. It is counted
// exactly when the session PULLED THE JOB LOG IN — which is what "the agent was in
// the loop" means operationally. A nightly or post-merge run nobody looked at stays
// uncounted, correctly: nothing was corrected. Those logs come through a CI-log tool
// rather than Bash, and their lines carry the Actions timestamp prefix, so both are
// read below.
//
// STATED BOUNDARY: this counts what the SESSION saw. A sweep whose CI log nobody
// fetched is invisible here, and so is a hook killed before it logged. A CI run is
// also only visible when it PRINTED something — a green sweep prints nothing at all
// — so `ciRuns`/`ciFailures` record the CI share separately, and a consumer wanting
// a clean session-only rate subtracts them. Every number below is a floor on
// activations, never an over-count, which is the direction that keeps "the checks
// caught N things" honest.

// The Stop hook's completion line. `reason` distinguishes the three outcomes the
// hook itself declares: `checks-passed`, `blocking-findings`, `loop-guard-relent`
// (blocking findings that survived two fix attempts — a failure that prints no
// findings block, so it must be read from here), and `runner-error` (the checks did
// not run at all, which is an anti-win masquerading as a quiet day).
const HOOK_DONE_RE = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z) run=(\S+) Stop: done exit=(\d+) ?([a-z-]*)/g;
export function hookCheckRuns(text) {
  return [...String(text ?? '').matchAll(HOOK_DONE_RE)]
    .map((m) => ({ stamp: `${m[1]} ${m[2]}`, exit: Number(m[3]), reason: m[4] || null }));
}

// A GitHub Actions log line stamps its own timestamp in front of the command's
// output, so every mark below has to tolerate that prefix or a fetched CI log reads
// as having printed nothing at all. Optional, and still anchored to the line start.
const ACTIONS_STAMP = String.raw`(?:\d{4}-\d{2}-\d{2}T[\d:.]+Z )?`;

// `report-findings`' summary line, which names the scope it ran. Anchored to the
// line start so a doc or a fixture quoting the shape mid-sentence never counts.
const SUMMARY_RE = new RegExp(`^${ACTIONS_STAMP}(\\d+) blocking, (\\d+) advisory \\((work|world) scope: `, 'gm');
export function checkSummaries(text) {
  return [...String(text ?? '').matchAll(SUMMARY_RE)]
    .map((m) => ({ scope: m[3], blocking: Number(m[1]), advisory: Number(m[2]) }));
}

// The rendered header of one finding — `[BLOCKING] <rule>  <file>` — which is where
// the RULE ID lives. Per-rule counts are the actionable end of this: "which rule
// catches something, and how often". They are lossier than the summary totals (an
// agent that pipes the run through `tail -3` keeps the summary and drops the
// headers), so both are kept and a gap between them is visible truncation.
const HEADER_RE = new RegExp(`^${ACTIONS_STAMP}\\[(BLOCKING|ADVISORY)\\] ([a-z0-9][a-z0-9-]*) {2}`, 'gm');
export function findingHeaders(text) {
  return [...String(text ?? '').matchAll(HEADER_RE)]
    .map((m) => ({ severity: m[1] === 'BLOCKING' ? 'blocking' : 'advisory', rule: m[2] }));
}

// Runner invocations inside one Bash command. Requires `node` and the `.mjs` on the
// same shell word run — so `grep -i check_the_world` never counts — and the
// separator class stops one match from swallowing a second runner on the same line.
const INVOKE_RE = /\bnode\b[^\n;|&]*?\bcheck_the_(work|world)\.mjs\b/g;
export function checkInvocations(command) {
  const counts = { work: 0, world: 0 };
  for (const m of String(command ?? '').matchAll(INVOKE_RE)) counts[m[1]] += 1;
  return counts;
}

// A tool that fetches CI job logs — the one way a CI run reaches a session, and
// therefore the one way "the agent was in the loop on this CI run" is observable.
// Matched by name shape rather than by one hardcoded tool: the same session can
// reach CI through an MCP server, a different server, or a future rename, and all of
// them say what they are in their name.
const CI_LOG_TOOL_RE = /(job|run|workflow)_logs/i;

// The transcript entries that can carry check output, reduced to the text to read
// and the source that produced it. Five shapes, all verified against real captures:
// the hook's blocking feedback (an `isMeta` user turn), the harness's
// `stop_hook_summary` (which repeats that same stderr), the passing hook's
// `hook_success` attachment, a Bash tool result, and a fetched CI job log — the last
// two paired back to the tool that produced them, so a Read of a file that merely
// CONTAINS this vocabulary is never mistaken for a run.
//
// Two different duplicate problems, so two different identities:
//   - the first two shapes are ONE hook execution recorded twice, so hook texts
//     dedupe on the `hooklog` stamps they carry — stable across both shapes and
//     unique per execution (its own timestamp, to the second);
//   - a CI job log can be fetched repeatedly (re-read while iterating), and there is
//     no per-fetch identity that says which RUN it was, so CI texts dedupe on the
//     check output itself. Two fetches of one job are byte-identical and collapse;
//     two real runs differ by their Actions timestamps at least. Two genuinely
//     identical runs would collapse too — an under-count, which is the direction
//     this whole counter is allowed to be wrong in.
// A Bash result needs neither: each tool call is its own run, and the invocation is
// counted from the command.
export function checkOutputs(entries) {
  const toolById = new Map();
  for (const entry of entries) {
    if (entry?.type !== 'assistant') continue;
    for (const block of entry?.message?.content ?? []) {
      if (block?.type !== 'tool_use' || typeof block?.name !== 'string') continue;
      if (block.name === 'Bash' && typeof block?.input?.command === 'string') {
        toolById.set(block.id, { source: 'bash', command: block.input.command });
      } else if (CI_LOG_TOOL_RE.test(block.name)) {
        toolById.set(block.id, { source: 'ci', command: null });
      }
    }
  }

  const out = [];
  const seenHooks = new Set();
  const seenCi = new Set();
  const hook = (text) => {
    const key = hookCheckRuns(text).map((r) => r.stamp).join('|');
    if (key && seenHooks.has(key)) return;      // the same execution, recorded twice
    if (key) seenHooks.add(key);
    out.push({ source: 'hook', text, command: null });
  };

  for (const entry of entries) {
    if (entry?.type === 'system' && entry?.subtype === 'stop_hook_summary') {
      hook((entry.hookErrors ?? []).join('\n'));
    } else if (entry?.type === 'attachment' && entry?.attachment?.hookEvent === 'Stop') {
      hook(`${entry.attachment.stderr ?? ''}\n${entry.attachment.stdout ?? ''}`);
    } else if (entry?.type === 'user' && entry?.isMeta === true && typeof entry?.message?.content === 'string') {
      if (entry.message.content.includes('Stop hook feedback')) hook(entry.message.content);
    } else if (entry?.type === 'user' && Array.isArray(entry?.message?.content)) {
      for (const block of entry.message.content) {
        if (block?.type !== 'tool_result') continue;
        const tool = toolById.get(block.tool_use_id);
        if (tool === undefined) continue;       // neither a runner nor a CI log — not a run
        const text = resultText(entry.toolUseResult, block.content);
        if (tool.source === 'ci') {
          // The CI log's OWN content is its identity; a fetch that carried no check
          // output at all (a green run, a different job) is not a run to dedupe.
          const key = checkOutputKey(text);
          if (!key || seenCi.has(key)) continue;
          seenCi.add(key);
        }
        out.push({ source: tool.source, text, command: tool.command });
      }
    }
  }
  return out;
}

// A tool result's text, whichever shape the tool reports in: Bash reports
// `{ stdout, stderr }`, an MCP tool reports content blocks the harness also copies
// onto the result block. Both are read, so neither tool family needs special-casing
// beyond this one function.
function resultText(result, blockContent) {
  if (typeof result === 'string') return unwrapJson(result);
  if (result && (typeof result.stdout === 'string' || typeof result.stderr === 'string')) {
    return `${unwrapJson(result.stdout ?? '')}\n${result.stderr ?? ''}`;
  }
  if (typeof blockContent === 'string') return unwrapJson(blockContent);
  if (Array.isArray(blockContent)) {
    return unwrapJson(blockContent.map((b) => (typeof b?.text === 'string' ? b.text : '')).join('\n'));
  }
  return result === undefined || result === null ? '' : unwrapJson(JSON.stringify(result));
}

// An MCP tool returns its payload as a JSON DOCUMENT inside a text block, so a job
// log's newlines arrive escaped and every mark below — all of them line-anchored —
// would see one enormous single line and match nothing. Decode by parsing and
// joining every string leaf with real newlines: field names never matter, so this
// holds for whichever tool or server delivers the log. Text that is not JSON is
// returned untouched, which is every Bash stdout.
function unwrapJson(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return text;
  let parsed;
  try { parsed = JSON.parse(trimmed); } catch { return text; }
  const strings = [];
  const walk = (value) => {
    if (typeof value === 'string') strings.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(parsed);
  return strings.join('\n');
}

// The check output a text carries, as one string — the identity of a CI job log for
// deduping. Built from the marked lines only, so unrelated log noise around them
// (which differs between a tailed fetch and a full one) cannot make one run look
// like two.
function checkOutputKey(text) {
  const marks = [
    ...String(text ?? '').matchAll(SUMMARY_RE),
    ...String(text ?? '').matchAll(HEADER_RE),
  ].map((m) => m[0]);
  return marks.length ? marks.join('|') : null;
}

// An empty per-scope check row. Uniform across scopes so folding is one loop:
// `runs` is observed activations, `failures` the subset that reported at least one
// blocking finding, `errors` the runs where the runner itself could not launch, and
// `blocking`/`advisory` the finding VOLUME summed over those runs (a rule blocking
// twice across two runs counts twice — the question is how often the checks caught
// something, not how many distinct problems existed).
//
// `ciRuns`/`ciFailures` are the SUBSET of `runs`/`failures` that came from a CI job
// log the session pulled in, carried separately because that source can only see a
// run that printed something: a green CI sweep prints nothing and is invisible. A
// consumer wanting a rate over runs it can see the whole of subtracts them; one
// asking "how often did the checks catch something" adds nothing and uses the total.
const emptyScope = () => Object.fromEntries(USAGE_FIELDS.checks.map((f) => [f, 0]));

// Count check activations across one capture file's entries.
//
// Runs are counted from the marks that a PASSING run also leaves — hook completion
// lines, and Bash invocations — never from the summary line, which only a run with
// findings prints. Where a runner ran without its command naming it (a `make test`
// step that wraps it), the summary lines in its output are the floor: hence the
// `max` — the two signals are alternative views of the same runs, not additive ones.
export function countChecks(entries) {
  const checks = {};
  const checkFindings = {};
  const scope = (name) => (checks[name] ??= emptyScope());
  const finding = (rule, severity) => {
    (checkFindings[rule] ??= { blocking: 0, advisory: 0 })[severity] += 1;
  };

  for (const { source, text, command } of checkOutputs(entries)) {
    const summaries = checkSummaries(text);

    if (source === 'hook') {
      // The hook only ever runs the WORK scope, and its completion line is the run.
      for (const run of hookCheckRuns(text)) {
        const work = scope('work');
        work.runs += 1;
        if (run.reason === 'runner-error') work.errors += 1;
        // A relent prints the reason instead of the findings, so its failure is
        // visible here and nowhere else.
        if (run.reason === 'loop-guard-relent') work.failures += 1;
      }
      for (const s of summaries) if (s.blocking > 0) scope(s.scope).failures += 1;
    } else if (source === 'ci') {
      // A CI log has no invocation to count — the summary lines ARE the runs, and
      // only the runs that printed. Recorded in the totals AND in the ci-only
      // counters, so the visible-in-full share stays derivable.
      for (const name of ['work', 'world']) {
        const reported = summaries.filter((s) => s.scope === name);
        if (reported.length === 0) continue;
        const failed = reported.filter((s) => s.blocking > 0).length;
        const row = scope(name);
        row.runs += reported.length;
        row.ciRuns += reported.length;
        row.failures += failed;
        row.ciFailures += failed;
      }
    } else {
      const invoked = checkInvocations(command);
      for (const name of ['work', 'world']) {
        const reported = summaries.filter((s) => s.scope === name);
        const runs = Math.max(invoked[name], reported.length);
        if (runs === 0) continue;
        scope(name).runs += runs;
        scope(name).failures += reported.filter((s) => s.blocking > 0).length;
      }
    }

    for (const s of summaries) {
      const row = scope(s.scope);
      row.blocking += s.blocking;
      row.advisory += s.advisory;
    }
    for (const f of findingHeaders(text)) finding(f.rule, f.severity);
  }
  return { checks, checkFindings };
}

// --- per-file counting ---------------------------------------------------------

// Count one capture file's entries. `mounted` is the set of skill names this repo
// mounts; a typed `/command` counts as a skill load only when it names one of them,
// which is what keeps the built-in CLI commands (`/model`, `/clear`, …) out.
//
// Stated overlap: a typed `/merge-to-main` counts in BOTH userCommands and
// skillLoads. One event, two axes, both true.
// Every string value anywhere in one entry, newline-joined — the haystack the
// executor's exec records are fished out of. They are printed by executor-side
// CODE (resolve-dispatch, record-exec) into Bash tool results, but the model may
// also quote one back, and the harness records both — so the caller dedupes on
// the full record tuple rather than trusting any one entry shape.
function entryText(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) entryText(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) entryText(v, out);
  return out;
}

// An empty per-task execution row — every status present, zeros included, same
// fixed-shape discipline as the scheduler's task-run rows.
export const emptyTaskExec = () => Object.fromEntries(TASK_EXEC_STATUSES.map((s) => [s, 0]));

// The executor-side task statuses one capture file attests: `claudinite-task-exec`
// records (run-record.mjs — the owned contract, never scraped prose), DEDUPED on
// the full (pack, task, slot, status) tuple within the file. One session runs one
// dispatch, so a record echoed by the model, or repeated across a command's
// stdout and the harness's copy of it, collapses to the one execution it names;
// a retry of the same slot is a different session, hence a different capture
// file, and still counts.
export function countTaskExecs(entries) {
  const seen = new Set();
  const taskExec = {};
  for (const entry of entries) {
    for (const rec of parseTaskExecs(entryText(entry).join('\n'))) {
      const key = `${rec.pack}/${rec.task}|${rec.slotId}|${rec.status}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const row = (taskExec[`${rec.pack}/${rec.task}`] ??= emptyTaskExec());
      row[rec.status] += 1;
    }
  }
  return taskExec;
}

// --- what Claudinite put into the session, and what the session cost --------------

// The session-start summary line the mount prints into every session — the one place
// the corpus states its own size in the terms a session actually pays: how many rule
// tokens the prompt carried before the first turn. It is a SENTENCE the hook writes,
// so it is read from the whole entry text (the hook's own output, or the assistant
// echoing it back — either is the same session, and only the first match counts).
//
// Numbers are grouped for a human reader, so the separators are stripped before
// parsing. No match is `null` — no opinion — and never zero: a repo whose mount does
// not print the line has an unknown figure, not a corpus of nothing.
const RULE_TOKENS_RE = /Claudinite loaded[^\n]*?([\d,]+)\s+rule tokens/;

export function ruleTokensIn(text) {
  const m = RULE_TOKENS_RE.exec(String(text ?? ''));
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

// What the session spent, from the usage records the transcript's own assistant
// entries carry. ASPIRATIONAL AND PROBED, never assumed: a transcript shape that
// records no usage returns null, and the consumer states the series as absent rather
// than drawing a zero line that would read as a free session.
//
// Cache reads and cache writes are counted into `in` because they are input tokens the
// turn was billed for; a consumer wanting the uncached share cannot have it from here
// and is not offered a number that looks like it.
export function tokensIn(entries) {
  let input = 0;
  let output = 0;
  let seen = false;
  for (const entry of entries) {
    const u = entry?.type === 'assistant' ? entry?.message?.usage : null;
    if (!u || typeof u !== 'object') continue;
    const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const i = n(u.input_tokens) + n(u.cache_read_input_tokens) + n(u.cache_creation_input_tokens);
    const o = n(u.output_tokens);
    if (i === 0 && o === 0) continue;
    seen = true;
    input += i;
    output += o;
  }
  return seen ? { input, output } : null;
}

export function countEntries(entries, mounted = new Set()) {
  const skillLoads = {};
  let userMessages = 0;
  let userCommands = 0;
  let ruleTokens = null;
  const load = (name) => { skillLoads[name] = (skillLoads[name] ?? 0) + 1; };

  for (const entry of entries) {
    for (const name of skillToolLoads(entry)) load(name);
    if (isUserMessage(entry)) userMessages += 1;
    const command = commandName(entry);
    if (command !== null) {
      userCommands += 1;
      if (mounted.has(command)) load(command);
    }
    if (ruleTokens === null) ruleTokens = ruleTokensIn(entryText(entry).join('\n'));
  }
  return {
    userMessages,
    userCommands,
    skillLoads,
    ruleTokens,
    tokens: tokensIn(entries),
    taskExec: countTaskExecs(entries),
    ...countChecks(entries),
  };
}

// --- day buckets ---------------------------------------------------------------

// An empty day row — the shape every counter folds through. Only the CAPTURE-derived
// scalars are zeroed: those are answered by files this fold reads in full every run,
// so zero is a fact about the day. Every other day field is left ABSENT until a source
// that can answer it does, because a source that could not be read is unknown and a
// zero written for it would read as a quiet day.
const emptyDay = () => ({
  ...Object.fromEntries(CAPTURE_DAY_FIELDS.map((f) => [f, 0])),
  skillLoads: {}, checks: {}, checkFindings: {}, tasks: {}, taskExec: {}, queue: {},
});

// An empty hour row. All four counters are zeroed: an hour inside the window with no
// runs in it genuinely had none — the run listing covers the whole window or the fold
// does not advance its watermark at all.
const emptyHour = () => ({ ...Object.fromEntries(USAGE_FIELDS.hour.map((f) => [f, 0])), taskExec: {} });

function addLoads(into, from) {
  for (const [name, n] of Object.entries(from)) into[name] = (into[name] ?? 0) + n;
}

// The check maps fold the same way skillLoads do — key-wise, zeros implicit — only
// with a fixed-shape counter object under each key instead of a bare number.
function addCounters(into, from) {
  for (const [key, row] of Object.entries(from ?? {})) {
    const target = (into[key] ??= Object.fromEntries(Object.keys(row).map((k) => [k, 0])));
    for (const [field, n] of Object.entries(row)) target[field] = (target[field] ?? 0) + n;
  }
}

// Recompute the day rows from scratch, from the live capture files. `files` is
// `[{ date, issue, sessionId, counts }]` — one entry per capture file in the raw
// window, `counts` being that file's `countEntries` result.
//
// Stateless by construction: a day is a pure function of the files stamped with it,
// so there is no ingest ledger, no double-count risk, and a counting-bug fix
// self-heals the entire visible window on its next run.
export function foldDays(files) {
  const days = {};
  const sessionsByDay = {};
  // The two PER-SESSION figures, which must not be summed over capture files: a
  // session that captured twice (a merge, then the session-end tail) writes the same
  // facts into both files, and the second is usually a superset of the first. So they
  // are collected per (day, session) and reduced at the end — the rule tokens the
  // session started with, and the largest token spend any of its captures attests.
  const perSession = {};
  const session = (date, id) => ((perSession[date] ??= new Map()).get(id)
    ?? (perSession[date].set(id, { ruleTokens: null, tokens: null }), perSession[date].get(id)));

  for (const file of files) {
    const day = (days[file.date] ??= emptyDay());
    day.captures += 1;
    if (file.issue > 0) day.merges += 1;      // issue 0 = a capture with no merge behind it
    day.userMessages += file.counts.userMessages;
    day.userCommands += file.counts.userCommands;
    addLoads(day.skillLoads, file.counts.skillLoads);
    addCounters(day.checks, file.counts.checks);
    addCounters(day.checkFindings, file.counts.checkFindings);
    addCounters(day.taskExec, file.counts.taskExec);
    (sessionsByDay[file.date] ??= new Set()).add(file.sessionId);

    const s = session(file.date, file.sessionId);
    if (s.ruleTokens === null && file.counts.ruleTokens !== null && file.counts.ruleTokens !== undefined) {
      s.ruleTokens = file.counts.ruleTokens;
    }
    const t = file.counts.tokens;
    if (t && (s.tokens === null || t.input + t.output > s.tokens.input + s.tokens.output)) s.tokens = t;
  }

  // Distinct sessions, not capture count: one session can capture more than once
  // (a merge, then the session-end tail).
  for (const [date, set] of Object.entries(sessionsByDay)) days[date].sessions = set.size;

  for (const [date, bySession] of Object.entries(perSession)) {
    const day = days[date];
    for (const { ruleTokens, tokens } of bySession.values()) {
      if (ruleTokens !== null) { day.ruleTokens += ruleTokens; day.ruleTokenSessions += 1; }
      // Absent until one session on this day attested a spend — the fields stay off
      // the row entirely on a day whose transcripts carried no usage records, which is
      // what makes "this shape does not record it" distinguishable from "it was free".
      if (tokens) {
        day.tokensIn = (day.tokensIn ?? 0) + tokens.input;
        day.tokensOut = (day.tokensOut ?? 0) + tokens.output;
        day.tokenSessions = (day.tokenSessions ?? 0) + 1;
      }
    }
  }
  return days;
}

// --- the sources outside the capture files ----------------------------------------

// Merge a day-keyed map of already-computed fields into the day rows — the shape both
// the local-git series (commits and lines) and the releases listing arrive in. A day
// the source could not speak for is simply absent from `bySource` and keeps no key,
// which is the whole point of doing this outside `emptyDay`.
export function foldDayFields(days, bySource = {}) {
  for (const [date, fields] of Object.entries(bySource)) {
    const day = (days[date] ??= emptyDay());
    for (const [field, value] of Object.entries(fields)) {
      if (typeof value === 'number' && Number.isFinite(value)) day[field] = value;
    }
  }
  return days;
}

// The queue's own record of what each occurrence came to: closed work items, per task,
// per outcome word. APPEND-ONCE past `queueFoldedThrough`, for the same reason the run
// ledger is — the items are a paged REST read where the capture files are local git —
// and safe to append because a closed item is settled: its outcome label is written at
// convergence and nothing later moves it.
//
// `records` is `[{ date, pack, task, outcome }]`, already filtered by the reader to
// items that closed past the mark.
export function foldQueueOutcomes(days, priorDays = {}, records = [], today) {
  for (const [date, row] of Object.entries(priorDays)) {
    const queue = row?.queue;
    if (!queue || !Object.keys(queue).length || !withinTaskWindow(date, today, DAY_WINDOW_DAYS)) continue;
    (days[date] ??= emptyDay()).queue = structuredClone(queue);
  }
  for (const { date, pack, task, outcome } of records) {
    if (!QUEUE_OUTCOMES.includes(outcome)) continue;
    const day = (days[date] ??= emptyDay());
    const row = (day.queue[`${pack}/${task}`] ??= Object.fromEntries(QUEUE_OUTCOMES.map((o) => [o, 0])));
    row[outcome] += 1;
  }
  return days;
}

// --- the hour tier ----------------------------------------------------------------

// How long an hour row lives. Three days: long enough for the two-day view the
// dashboard draws plus a fold outage, short enough that the tier stays a few dozen
// rows rather than a log.
export const HOUR_WINDOW_HOURS = 72;

export const withinHourWindow = (key, nowIso, hours = HOUR_WINDOW_HOURS) => {
  const age = (new Date(`${String(nowIso).slice(0, 13)}:00:00Z`) - new Date(`${key}:00:00Z`)) / 3600000;
  return Number.isFinite(age) && age >= 0 && age < hours;
};

// The hour rows for this run. Two sources meeting in one row, and they are kept in
// separate FIELDS rather than merged, because they are trued up on different clocks:
//
//   - the run counts (`scheduler`, `executor`, `failed`) are APPENDED from the runs
//     read past the watermark, so prior rows carry forward and are added to;
//   - the capture-derived counts (`agentic`, and the per-task executions behind the
//     hover) are RECOMPUTED from the capture files every run, so they overwrite.
//
// Merging them into one counter would make the second source's recompute silently
// double the first's appended total.
export function foldHours({ prior = {}, runs = [], captureHours = {}, now }) {
  const hours = {};
  for (const [key, row] of Object.entries(prior)) {
    if (!withinHourWindow(key, now)) continue;
    hours[key] = { ...emptyHour(), ...structuredClone(row), taskExec: {} };
  }
  for (const run of runs) {
    const key = hourKey(run.startedAt);
    if (!withinHourWindow(key, now)) continue;
    const row = (hours[key] ??= emptyHour());
    if (run.workflow === 'scheduler') row.scheduler += 1;
    else if (run.workflow === 'executor') row.executor += 1;
    if (run.conclusion === 'failure' || run.conclusion === 'timed_out' || run.conclusion === 'startup_failure') {
      row.failed += 1;
    }
  }
  for (const [key, capture] of Object.entries(captureHours)) {
    if (!withinHourWindow(key, now)) continue;
    const row = (hours[key] ??= emptyHour());
    row.agentic = capture.agentic;
    row.taskExec = structuredClone(capture.taskExec ?? {});
  }
  return hours;
}

// The capture files' own view of an hour: how many distinct sessions captured in it,
// and what they executed. The filename stamp is the clock — the same stamp the logs
// branch's retention rules read, machine-written by the capture step.
export function captureHours(files) {
  const out = {};
  const sessions = {};
  for (const file of files) {
    if (!file.stamp) continue;
    const key = hourKey(file.stamp);
    const row = (out[key] ??= { agentic: 0, taskExec: {} });
    (sessions[key] ??= new Set()).add(file.sessionId);
    addCounters(row.taskExec, file.counts.taskExec);
  }
  for (const [key, set] of Object.entries(sessions)) out[key].agentic = set.size;
  return out;
}

// --- task invocations -----------------------------------------------------------

// How long a task row stays in the DAY tier. Independent of the capture retention
// on purpose: these rows come from the scheduler's Actions logs, not from the logs
// branch, so nothing about them ages out when a capture file does — and a repo that
// captured nothing for a week must still show that its scheduled tasks ran. Past
// this, the day row goes and its week row carries it, exactly as the capture-derived
// days do.
export const TASK_DAY_WINDOW_DAYS = 14;

// How long a day row lives at all. Wider than the task rows and wider than the capture
// retention, because the local-git and queue series reach further back than either and
// the growth panels read a month of them. A day past this drops out of the tier; its
// week row keeps what it held.
export const DAY_WINDOW_DAYS = 30;

export function withinTaskWindow(date, today, days = TASK_DAY_WINDOW_DAYS) {
  const age = (new Date(`${today}T00:00:00Z`) - new Date(`${date}T00:00:00Z`)) / 86400000;
  return Number.isFinite(age) && age >= 0 && age < days;
}

// Carry the slot scheduler's task-invocation rows forward while they are still inside
// the day window.
//
// HISTORY ONLY, WITH NO WRITER LEFT. These rows counted what the retired slot
// scheduler printed into its own Actions log about each due task; that writer is gone
// (#974) and its logs have aged out of retention, so nothing appends to them any more
// and the reader that did was retired with them rather than left to spend two API
// calls a run finding nothing. What each occurrence came to is read from the queue's
// own closed items now (`foldQueueOutcomes`), which is the record that replaced it.
//
// So this only ages them out: a day row keeps its `tasks` counts until it leaves the
// window, and the week rows that already froze them keep them forever.
export function carryTaskRuns(days, priorDays = {}, today) {
  for (const [date, row] of Object.entries(priorDays)) {
    const tasks = row?.tasks;
    if (!tasks || !Object.keys(tasks).length || !withinTaskWindow(date, today)) continue;
    (days[date] ??= emptyDay()).tasks = structuredClone(tasks);
  }
  return days;
}

// --- week buckets --------------------------------------------------------------

// The ISO-8601 week a UTC date falls in, `YYYY-Www`. ISO weeks start Monday and
// belong to the year containing their Thursday — computed, never approximated,
// because an off-by-one here would silently mis-file a whole week's row.
export function isoWeek(date) {
  const d = new Date(`${date}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;                 // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - day + 3);              // the week's Thursday
  const year = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const offset = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - offset + 3);
  const week = 1 + Math.round((d - firstThursday) / (7 * 86400000));
  return `${year}-W${String(week).padStart(2, '0')}`;
}

// The days to fold into weeks this run: every completed day strictly after the
// watermark and strictly before today, in order. Days close strictly in order, so a
// single monotone watermark is the WHOLE exactly-once mechanism — no ingest ledger.
// `today` is excluded because its capture files are still arriving.
export function daysToFold(days, foldedThrough, today) {
  return Object.keys(days)
    .filter((d) => d < today && (!foldedThrough || d > foldedThrough))
    .sort();
}

// Add one day row into its week row, append-once. Weeks carry `days` — how many day
// rows they absorbed — so a fold outage longer than the raw retention window
// declares its own hole (`days: 5`) instead of silently under-reporting.
//
// `sessionDays` rather than `sessions`: every counter here sums exactly under
// folding EXCEPT a distinct-session count (a session spanning two days is distinct
// in each), so the week-level field is named for what it actually is — the sum of
// the day-level distinct counts — rather than claiming a precision folding cannot
// give.
// Every scalar add is `?? 0` on the WEEK side for the same reason the counter maps
// below default rather than crash: a week frozen before a field existed carries no key
// for it, and the field must start accumulating from the first day that has it instead
// of wedging the watermark or reading back as NaN.
export function addDayToWeek(week, day) {
  const w = week ?? { skillLoads: {}, checks: {}, checkFindings: {} };
  const add = (field, n) => { w[field] = (w[field] ?? 0) + n; };
  add('days', 1);
  // Every other week scalar is the sum of the day field of the same name — the two
  // exceptions are spelled once, in WEEK_FROM_DAY. Driven off the vocabulary rather
  // than a hand-written list so a field appended to both rows folds without a third
  // edit here, which is where a new counter would otherwise be silently dropped.
  //
  // A day with NO opinion on a field adds nothing rather than zero: a week that
  // absorbed five days of unreadable git history and two of readable must report the
  // two, not seven days' worth of understated lines.
  for (const field of USAGE_FIELDS.week) {
    if (field === 'days') continue;
    const value = day[WEEK_FROM_DAY[field] ?? field];
    if (typeof value === 'number' && Number.isFinite(value)) add(field, value);
  }
  addLoads(w.skillLoads, day.skillLoads);
  // A week folded before the checks were counted has no `checks` key at all —
  // default rather than crash, so the first fold after this shipped extends the
  // existing weeks instead of refusing to advance the watermark past them.
  addCounters((w.checks ??= {}), day.checks);
  addCounters((w.checkFindings ??= {}), day.checkFindings);
  // Same default-rather-than-crash treatment for the task invocations: a week
  // folded before they were counted has no `tasks` key, and grows one from the day
  // it closes forward instead of wedging the watermark behind it.
  addCounters((w.tasks ??= {}), day.tasks);
  // …and for the executor-side execution statuses (the conversation-log census).
  addCounters((w.taskExec ??= {}), day.taskExec);
  // …and for the queue's own outcome record, which arrived later still.
  addCounters((w.queue ??= {}), day.queue);
  return w;
}

// --- the whole file ------------------------------------------------------------

export { USAGE_VERSION };

// Sorted keys throughout, so a recompute that found nothing new produces a
// byte-identical file and the delivery opens no PR.
function sortKeys(obj) {
  return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));
}

// Fold one run: hour rows over the last three days, day rows recomputed from `files`
// (the live raw window), week rows carried forward from `prior` and advanced by every
// day that closed since the watermark. Pure — the caller supplies today's UTC date,
// the prior file, and whatever the outside sources answered.
//
// The three tiers answer different questions and are kept honest by different
// mechanisms: hours are for what is happening right now and expire in three days;
// days are cheap to be wrong about (recomputed every run, so a fix heals them); weeks
// are not (frozen once folded — re-freezing would need raw data the retention TTL
// deliberately destroyed), so weeks only ever absorb days that have closed and can no
// longer change.
export function foldUsage({
  files, prior = {}, today, now = null, runsFoldedThrough = null,
  queueRecords = [], queueFoldedThrough = null, runs = [], dayFields = {}, generated = null,
}) {
  const days = foldDays(files);
  // The appended rows are accumulated BEFORE the week fold, so a day that closed since
  // the last run carries them into its week in the same pass that freezes it. (A day
  // whose week is already frozen still shows a late arrival in the day tier — visible
  // there, absent from the week: the same boundary every new counter has, and the same
  // one weeks state for themselves.)
  carryTaskRuns(days, prior.days ?? {}, today);
  foldQueueOutcomes(days, prior.days ?? {}, queueRecords, today);
  foldDayFields(days, dayFields);
  const weeks = structuredClone(prior.weeks ?? {});
  let foldedThrough = prior.foldedThrough ?? null;

  for (const date of daysToFold(days, foldedThrough, today)) {
    const key = isoWeek(date);
    weeks[key] = addDayToWeek(weeks[key], days[date]);
    foldedThrough = date;
  }

  for (const date of Object.keys(days)) {
    if (!withinTaskWindow(date, today, DAY_WINDOW_DAYS)) delete days[date];
  }

  return {
    generated,
    foldedThrough,
    // How far the queue's own closed items have been read. Its own mark for the same
    // reason the run ledger has one: a different source on a different clock, and one
    // outage must not read as the other's.
    queueFoldedThrough: queueFoldedThrough ?? prior.queueFoldedThrough ?? null,
    hours: sortKeys(foldHours({
      prior: prior.hours ?? {}, runs, captureHours: captureHours(files), now: now ?? `${today}T23:59:59Z`,
    })),
    // The second watermark: how far the scheduler's own run ledger has been read.
    // Separate from `foldedThrough` because it advances on a different clock (runs,
    // not closed days) over a different source, and conflating them would make an
    // outage in one silently look like an outage in the other. Carried forward
    // unchanged when this run read no new runs.
    runsFoldedThrough: runsFoldedThrough ?? prior.runsFoldedThrough ?? null,
    days: sortKeys(days),
    weeks: sortKeys(weeks),
  };
}

// --- the file boundary ----------------------------------------------------------
// Everything above works in NAMED counters; the on-disk tuple shape is met only here.
export { encodeUsageFile as encodeUsage, decodeUsageFile as decodeUsage };

// --- the mounted-skill set -----------------------------------------------------

// The skill names this repo mounts, from the PACK REGISTRY — never from
// `.claude/skills/`, which is gitignored session state an Action checkout does not
// carry at all. Fails soft to an empty set: with no mounted set, a typed `/command`
// still counts as a userCommand and simply never counts as a skill load.
export async function mountedSkillNames(root, config) {
  try {
    const active = (await loadPacks({ localRoot: root })).filter((p) => isActive(p, config));
    return new Set(bundledSkillSources(active).keys());
  } catch { return new Set(); }
}
