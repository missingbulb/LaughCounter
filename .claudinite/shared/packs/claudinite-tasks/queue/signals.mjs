// Signal collection for ONE task (tasks-dispatch DESIGN §5, §6.4): exactly that
// task's declared union, collected at the moment a verdict is asked for. Two
// callers ask — the scheduler run at the task's anchor (#1115; a read it cannot
// make fails open there) and the executor at pick, which re-derives rather than
// trusting the anchor's answer forward.
//
// The lookback is that task's own period plus an hour of slack: stateless, and
// overlap is absorbed by the preconditions' own dedupe, exactly as the slot
// scheduler's window did for the widest due task.

import { periodMs } from './anchors.mjs';
import { parseWorkItemBody } from './work-item.mjs';
import { taskSignalNames } from '../task-contract.mjs';

const lookbackMs = (task) => (periodMs(task.decl.frequency) ?? 86400e3) + 3600e3;

export const windowStart = (task, now) =>
  new Date(new Date(now).getTime() - lookbackMs(task)).toISOString();

// The same lookback in DAYS — what a precondition term needs when its dimension
// carries an age rather than a windowed flag of its own (the conversation-logs
// branch reports how old its newest capture is, not whether one landed).
export const windowDays = (task) => lookbackMs(task) / 86400e3;

// A collector factory bound to this run's repo context; the returned function is
// the `collectSignalsFor` seam the executor calls.
export function collectSignalsForTask({ gh, repo, root, config, defaultBranch }) {
  return async function collectFor(task, now, item = null) {
    const { collectSignals } = await import('../signals/index.mjs');
    const { buildSignalContext } = await import('../signals/context.mjs');
    const names = taskSignalNames(task.decl, task.terms);
    const packConfigFor = (packId) => config.packConfig?.[packId] ?? {};
    const sinceIso = windowStart(task, now);

    // The fleet aggregate is a full enumeration over a wider credential, so it is
    // built only when THIS task declares it and only where that credential exists.
    // Absent, the collector returns null and a fleet task's precondition declines
    // rather than crashing.
    let fleet = null;
    if (names.includes('fleet')) {
      const { readFleet, makeFleetGh } = await import('../signals/fleet.mjs');
      const fleetGh = makeFleetGh();
      if (fleetGh) {
        fleet = await readFleet(fleetGh, { owner: repo.split('/')[0], canonRepo: repo, sinceIso });
        if (fleet.error) console.log(`! fleet enumeration: ${fleet.error}`);
      } else {
        console.log('- this task declares the `fleet` signal but FLEET_GITHUB_TOKEN is not set');
      }
    }

    const ctx = buildSignalContext({
      root, repo, defaultBranch, now: new Date(now).toISOString(), sinceIso, config, fleet, packConfigFor,
      // The occurrence's own facts, for the collector that reads one named object
      // rather than a window (the request read, DESIGN §16.4).
      item: item ? parseWorkItemBody(item.body) : null,
    });
    return collectSignals(gh, ctx, names);
  };
}
