---
name: working-with-generated-files
description: Working with a file a test or tool generates — naming it, changing the generator rather than the file, and resolving its merge conflicts by regenerating. Loaded for any edit of a GENERATED file.
metadata:
  force-load-on-file-edits-paths:
    - "**/*GENERATED*"
---

# Working with generated files

- **Working with a file a test or tool generates** — put `GENERATED` in its name, and don't
  hand-edit it; change the generator. Never resolve its merge conflict by hand: clear the
  markers with either side, re-run the generator against the merged inputs, and commit that
  output. Consider automating the clear with a `merge=ours` `.gitattributes` entry, and
  `git rerere` for a conflict that recurs.
