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
// pack's own README stating its boundary.
//
// WHY IT LANDS UNATTENDED (#1453). This ceiling used to be `open-pr`, on the
// reasoning that a new pack switches on checks in the member's CI and so should
// always be reviewed. In practice the review never came: ClaudiniteCanary#133 did
// its work correctly, opened its PR, and sat parked for approval for ELEVEN days
// while the adoption never reached the repo it was for. A gate nobody walks through
// is not a safeguard, it is where the work stops.
//
// What that trades away, stated because it is a reversal: a member's gate surface
// can now change with no human in front of it. The adoption PR still runs that
// member's own checks before it merges, so a pack whose checks fail there cannot
// land — but a pack whose checks pass and is merely unwanted now arrives unasked.
// The fleet enforcer's `add-packs` issue remains the place to say no, before the
// work is placed rather than after it is done.
//
// Self-contained (imports nothing): the whole contract is this default export.

export default {
  id: 'adopt-requested-packs',
  frequency: 'manual',                   // fired by the fleet enforcer when it places work here — never due on its own
  // Never due on its own: an item exists only because a work list was pushed here,
  // and that IS the request.
  preconditions: ['none'],
  agent_model: 'sonnet',                 // applies existing packs by an existing skill; confirmation judgment is bounded and reviewed
  expected_outcome: 'pr',
  // Lands unattended (see the note above on what that trades away) within what an
  // adoption actually writes: the declaration, the re-vendored mount (this pack's
  // merge-rules.json declares both) and the regenerated rules index. A pack whose
  // adoption scaffolds workflow files parks for review — fail-safe, and rare.
  automerge: ['claudinite-shared-packs', 'claudinite-settings-updates', 'generated-file-changes'],
  agent_instructions: 'task.md',
  // Adopting packs is a declaration edit, an interview transcription, a re-vendor, a
  // scaffold and a PR. Generous, because it is a runaway bound and not a scheduling
  // knob.
  agent_execution_timeout: 3600,
};
