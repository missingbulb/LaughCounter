# claudinite-growth — authoring Claudinite content here

Rules for the content a repo authors for itself: the lessons its capture runs write into its local
packs, and the tasks that do the writing. A member's own Claudinite *status* — the mount,
the declaration, adoption, the update — is claudinite-lifecycle's.

- **Recording a local pack change** — automatic work writes no changelog file there: the commit
  and its PR are the record. A local pack is neither versioned nor distributed, so such a file
  only aggregates unrelated changes into one line several runs a day contend for. A shared canon
  pack still gets its `VERSIONS.md` row, which is what tells a member what a bump shipped.

- **Wanting a job to run in Actions** — make it a task with a `code_work` command rather than
  authoring a workflow; the vendored workflows already own the trigger, the concurrency, the
  secrets and the failure reporting. Work with no cadence is a task too, on
  `frequency: 'manual'`, woken by whatever knows the event happened.
