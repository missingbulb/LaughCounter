// claudinite-growth task: adopt-requested-packs — adopt the packs this repo's
// `add-packs` work-list issues ask for, in THIS repo, by this repo's own agent.
//
// THE MEMBER HALF OF THE FLEET FAN-OUT (#749, folded onto the queue's own request
// mode in #1119). A fleet enforcer (the claudinite-fleet-sheepdog pack's
// fleet-add-missing-packs task) decides a member is missing packs — a weekly
// fingerprint scan SUSPECTS them, or the owner REQUESTS them by hand with config
// and interview answers decided — and, per member, converges one `add-packs`
// work-list issue HERE, marked `task:origin:ad-hoc` with a `Task:` field naming
// this task. THE ISSUE IS THEN THE WORK ITEM: this repo's own hourly scheduler run
// adopts it, its own executor picks it up, and its agent adopts with the repo
// checked out and lands one reviewed PR here. No agent anywhere needs cross-repo
// access, which is the failure the first design hit in production.
//
// There is no code-work phase and no gate in front of the agent: an item exists
// only because an issue was marked, so "is there work?" is answered by the item's
// existence. (Before the fold it was answered by counting labelled issues, because
// the enforcer woke a standing item that had no idea why it was awake.)
//
// `frequency: 'manual'` — never due on any cadence. The work only exists when the
// fleet places it. (A member whose run died is re-asked by clearing the issue's
// status, which the enforcer does whenever it rewrites a changed ask, and by the
// fleet's next weekly visit.) A repo outside any fleet simply never runs this.
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
  // Adopting packs is a declaration edit, an interview transcription, a re-vendor, a
  // scaffold and a PR. Generous, because it is a runaway bound and not a scheduling
  // knob.
  agent_execution_timeout: 3600,

  // Never due on its own — `manual` means the scheduler run never instantiates this task,
  // so an item exists ONLY because the fleet enforcer (or a human) created one,
  // and that IS the request. Hence run: true. The queue evaluates this verdict at
  // pick (tasks-dispatch DESIGN §6.4), unlike the slot mechanism where a forced
  // run bypassed it; a no-go here has no anchor to roll to, so it would close the
  // enforcer's own item `task:obsolete` without running.
  precondition() {
    return { run: true, reason: 'a work item for this manual lever exists, which is the request to run it' };
  },
};
