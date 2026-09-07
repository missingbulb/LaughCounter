# claudinite-growth — authoring Claudinite content here

- **Recording a local pack change** — automatic work writes no changelog file there: the commit
  and its PR are the record. A local pack is neither versioned nor distributed, so such a file
  only aggregates unrelated changes into one line several runs a day contend for. A shared canon
  pack's version and its `VERSIONS.md` row are the canon's own tasks' to write, after the change
  lands — never the change's.

- **Wanting a job to run in Actions** — make it a task with a `code_work` command rather than
  authoring a workflow; the vendored workflows already own the trigger, the concurrency, the
  secrets and the failure reporting. Work with no cadence is a task too, with no
  `preconditions`, woken by whatever knows the event happened.

- **Describing another pack's artifact** — point at the pack that owns it
  instead: the parenthetical costs this pack a version and a `VERSIONS.md` row every time that
  artifact changes, and the reader rarely needed it. (RULES-2)
