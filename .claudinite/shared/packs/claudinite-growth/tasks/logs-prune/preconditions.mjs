import { resolveRetentionDays } from './prune-logs.mjs';

// logs-prune's own precondition term. The prune's trigger is a CLOCK crossing a
// boundary — the oldest capture aged past this repo's retention — and
// no built-in movement condition can say that: it must keep firing on exactly the
// repos that went quiet, which is where logs sit long enough to expire.

export const terms = {
  'log-past-retention': {
    signals: ['conversationLogs'],
    holds(signals) {
      const logs = signals.conversationLogs ?? {};
      if (logs.present !== true) {
        return { holds: false, reason: 'no conversation-logs branch — nothing captured yet' };
      }
      // The signal reports what the declaration SAYS (null when nothing declares a
      // numeric `retention_days`) and knows nothing about this pack's policy — it is
      // keyed by the parameter rather than by the pack, deliberately. So the default
      // and the opt-out are applied here, through the same resolver the worker uses,
      // and a repo that declared itself out is declined before it costs an item.
      const retention = resolveRetentionDays(logs.retentionDays);
      if (retention === null) {
        return { holds: false, reason: `retention_days is ${logs.retentionDays} — capture-only by this repo's own choice, so the prune deletes nothing` };
      }
      const oldest = logs.oldestLogAgeDays;
      // An unreadable branch tree leaves `oldestLogAgeDays` null, which is unknown
      // rather than expired — and the safe reading of unknown is "delete nothing".
      if (!(typeof oldest === 'number' && oldest > retention)) {
        return { holds: false, reason: `no log older than retention ${retention}d — nothing to prune` };
      }
      return { holds: true, reason: `oldest log ${oldest.toFixed(1)}d old vs retention ${retention}d` };
    },
  },
};
