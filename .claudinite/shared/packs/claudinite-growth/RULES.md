# claudinite-growth — authoring Claudinite content here

Rules for the content a repo authors for itself: the lessons its capture runs write into its local
packs, and the tasks that do the writing. A member's own Claudinite *status* — the mount,
the declaration, adoption, the update — is claudinite-lifecycle's.

- **Changing a local pack automatically** — adding or removing a prose rule, creating a
  check, correcting or deleting a rule a probe disproved — add a row to that pack's own
  `VERSIONS.md`, in the same commit as the change. That file is the growth lifecycle's whole
  record; no growth task keeps a standing tracker issue, and a run that changed nothing writes no
  row.

- **Wanting a job to run in Actions** — make it a task with a `code_work` command rather than
  authoring a workflow; the vendored workflows already own the trigger, the concurrency, the
  secrets and the failure reporting. Work with no cadence is a task too, on
  `frequency: 'manual'`, woken by whatever knows the event happened.
