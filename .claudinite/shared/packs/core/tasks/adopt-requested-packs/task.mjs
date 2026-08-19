// grow_with_claudinite task: adopt-requested-packs — adopt the packs this repo's
// `add-packs` work-list issues ask for, in THIS repo, by this repo's own agent.
//
// THE MEMBER HALF OF THE FLEET FAN-OUT (#749). A fleet enforcer (the sheepdog
// pack's fleet-add-missing-packs task) decides a member is missing packs — a weekly
// fingerprint scan SUSPECTS them, or the owner REQUESTS them by hand with config and
// interview answers decided — and, per member, converges one `add-packs` work-list
// issue HERE and dispatches THIS repo's scheduler with `wake: adopt-requested-packs`.
// This task is what that firing runs: prework counts the repo's own open work-list
// issues and requests the agent iff any exist; the agent adopts with the repo
// checked out, under this repo's own executor and grant, and lands one reviewed PR
// here. The enforcer dispatches, the member executes — no agent anywhere needs
// cross-repo access, which is the failure the first design hit in production.
//
// `frequency: 'manual'` — never due on any cadence. The work only exists when the
// fleet places it, and the fleet fires this scheduler in the same breath; a cadence
// would only re-ask a question whose answer arrives by push. (A member whose forced
// run died is re-fired by the fleet's next weekly visit — the retry loop lives
// there, not in a local schedule.) A repo outside any fleet simply never runs this.
//
// WHY sonnet: the deciding is mostly done. A REQUESTED issue carries the exact
// declaration entries to write; a SUSPECTED one needs the bounded judgment "is this
// fingerprint's suspicion right for this repo", made against a checkout, with the
// pack's own README stating its boundary — and the outcome is ceilinged at
// `open-pr`, so it always lands in front of a reviewer.
//
// Self-contained (imports nothing): the whole contract is this default export.

export default {
  id: 'adopt-requested-packs',
  frequency: 'manual',                   // fired by the fleet enforcer when it places work here — never due on its own
  precondition_signals: [],              // no signal — the work list arrives by push, not by observation
  agent_model: 'sonnet',                 // applies existing packs by an existing skill; confirmation judgment is bounded and reviewed
  expected_outcome: 'open-pr',           // a new pack switches on checks in this repo's CI — always reviewed, never auto-merged
  agent_instructions: 'task.md',
  prework: 'node worker.mjs',
  prework_timeout: 120,                  // one labeled-issue list against this repo's own API
  // Adopting packs is a declaration edit, an interview transcription, a re-vendor, a
  // scaffold and a PR. Generous, because it is a runaway bound and not a scheduling
  // knob.
  agent_execution_timeout: 3600,

  // Never due on its own — `manual` means the tick never instantiates this task,
  // so an item exists ONLY because the fleet enforcer (or a human) created one,
  // and that IS the request. Hence run: true. The queue evaluates this verdict at
  // pick (tasks-dispatch DESIGN §6.4), unlike the slot mechanism where a forced
  // run bypassed it; a no-go here has no anchor to roll to, so it would close the
  // enforcer's own item `outcome:obsolete` without running.
  precondition() {
    return { run: true, reason: 'a work item for this manual lever exists, which is the request to run it' };
  },
};
