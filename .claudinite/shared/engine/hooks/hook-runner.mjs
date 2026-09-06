// The one door every per-call hook goes through: each engine/hooks/*-command.mjs
// hands this runner its event and its judge, and nothing else in a hook touches
// the process. Claude Code runs a hook on every tool call, prompt and result,
// and reads exactly one thing as a block — exit 2 with the reason on stderr.
// Every other non-zero exit, a timeout, and stdout that is not JSON is a
// "non-blocking error" the harness prints beside every call it happens on, and
// a hook that hangs holds the call for the harness's own timeout. So a hook
// here is a guest:
//  - a judge returns a verdict — `{ block, reason }` where the event allows one,
//    `{ context }` to inject, or nothing — and never exits, writes or throws
//    on purpose;
//  - the runner writes that verdict: exit 2 only for a block on an event that
//    can block, else exit 0 with one complete JSON `hookSpecificOutput`, or
//    nothing at all;
//  - everything else — a payload that is not JSON, an engine module that fails
//    to load, a registry that throws, a pack whose import never settles, a
//    closed stdout — ends in exit 0 with a `done exit=0 <why>` line in the hook
//    log, which is where such a failure is then read from. A block on an event
//    that cannot block is injected as context and logged, never exit 2.
import { hooklog } from '../checks/helpers/hook-log.mjs';

// How long a hook may take before it gives up and lets the action through:
// far under the harness's own timeout, so a stuck registry costs one slow call
// and a log line rather than an error printed on the call. Tests shorten it.
export const DEADLINE_MS = Number(process.env.CLAUDINITE_HOOK_DEADLINE_MS) || 5000;

// `load` imports the judge module lazily, so an engine that fails to load is a
// caught rejection here rather than a crash before any handler exists.
export function runHook(event, { canBlock = false, load }) {
  const bail = (why) => { hooklog(event, `done exit=0 ${why}`); process.exit(0); };
  process.on('uncaughtException', (e) => bail(`hook-failed ${e?.message ?? e}`));
  process.on('unhandledRejection', (e) => bail(`hook-failed ${e?.message ?? e}`));
  process.stdout.on('error', () => process.exit(0));
  process.stderr.on('error', () => process.exit(0));
  setTimeout(() => bail(`deadline ${DEADLINE_MS}ms`), DEADLINE_MS);
  let input = '';
  process.stdin.on('error', () => bail('stdin-failed'));
  process.stdin.on('data', (d) => { input += d; });
  process.stdin.on('end', () => {
    settle(event, canBlock, load, input).catch((e) => bail(`hook-failed ${e?.message ?? e}`));
  });
}

async function settle(event, canBlock, load, input) {
  let payload = null;
  try { payload = JSON.parse(input); } catch { /* not a payload: nothing to judge */ }
  if (!payload || typeof payload !== 'object') return process.exit(0);
  const { judge } = await load();
  const verdict = (await judge(payload)) ?? {};
  let context = typeof verdict.context === 'string' ? verdict.context : '';
  if (typeof verdict.block === 'string' && verdict.block) {
    if (canBlock) {
      process.stderr.write(verdict.block, () => process.exit(2));
      return;
    }
    hooklog(event, `block-unsupported ${verdict.reason ?? ''}`.trimEnd());
    context = [verdict.block, context].filter(Boolean).join('\n');
  }
  if (!context) return process.exit(0);
  const out = JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } });
  process.stdout.write(out, () => process.exit(0));
}
