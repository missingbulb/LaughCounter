---
name: committing
description: How a commit is cut — one concern per commit, the issue it references, a landed commit revised only by a new one, files staged by name. Use before any git commit.
metadata:
  force-load-on-tool-calls:
    - 'Bash.command /(^|[;&|]\s*|\n\s*)git\s+commit\b/'
---

# Committing

- **One concern per commit.** If two changes could each stand alone, split them; a message that
  wants numbered items is the split talking.
- **Reference the issue** — `Refs #n`, or `Fixes #n` / `Closes #n` where the commit finishes it;
  the `task-lifecycle` check reads it off the branch.
- **A landed commit is revised by a new commit**, never a rewrite of that one.
- **Stage by name** — `git add <paths>` for the files this commit is about; `-a` sweeps in whatever
  else was in progress.
