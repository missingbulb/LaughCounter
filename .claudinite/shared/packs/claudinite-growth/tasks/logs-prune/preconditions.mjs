// logs-prune's own precondition term. The prune's trigger is a CLOCK crossing a
// boundary — the oldest capture aged past this repo's configured retention — and
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
      const retention = logs.retentionDays;
      if (typeof retention !== 'number') {
        return { holds: false, reason: 'retention_days is unset — capture-only adoption, so the prune deletes nothing' };
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
