// Signal collection for ONE picked task (tasks-dispatch DESIGN §5, §6.4). The
// tick performs no GitHub read beyond the issue list, so the whole cost of
// signals moved here — where exactly one task's declared union is collected, once
// per period per task, at the moment its verdict is asked for.
//
// The lookback is that task's own period plus an hour of slack: stateless, and
// overlap is absorbed by the preconditions' own dedupe, exactly as the slot
// scheduler's window did for the widest due task.

import { periodMs } from './anchors.mjs';

export const windowStart = (task, now) =>
  new Date(new Date(now).getTime() - (periodMs(task.decl.frequency) ?? 86400e3) - 3600e3).toISOString();

// A collector factory bound to this run's repo context; the returned function is
// the `collectSignalsFor` seam the executor calls.
export function collectSignalsForTask({ gh, repo, root, config, defaultBranch }) {
  return async function collectFor(task, now) {
    const { collectSignals } = await import('../signals/index.mjs');
    const { buildSignalContext } = await import('../signals/context.mjs');
    const names = task.decl.precondition_signals ?? [];
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
    });
    return collectSignals(gh, ctx, names);
  };
}
