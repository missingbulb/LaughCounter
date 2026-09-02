# References — rationale behind this pack's rules and checks

Maintenance and review material for the `writing-pack-prose` references convention: each entry
carries the reason a rule or check exists, written so a periodic review can reaffirm — or
retire — it. Entry keys are file-scoped stable identifiers (gaps allowed, never renumbered): an
end-of-line `(n)` marker in `RULES.md` cites `RULES-n`, one in a skill cites
`<skill-name>-n`, and `check:` entries cover checks. No session loads this file for daily work.

- **(verify-in-production-1)** #1121 was filed against a scope its PR then dropped, so the
  verification was moot before the merge it waited on. Retire the merge-first rule only if a
  verification can track its PR's live diff.
- **(verify-in-production-2)** #1460 was filed and then hand-verified twelve minutes later — the
  artifact was readable all along and the issue was pure overhead. The bar stays "could not be
  watched now" for as long as filing costs a queue run.
- **(verify-in-production-3)** One executor batch spent five of its seven claimed items
  rediscovering unreadable artifacts and parking `needs-human-action` (#1184, #1253, #1268,
  #1288, #1291), before the coded form existed for the URL-readable ones among them. Retire only
  if queue sessions gain a way to read those surfaces.
- **(verify-in-production-4)** Three cross-repo `Verify:` items each parked minutes after being
  picked, on `repository "…" is not configured for this session` (#1349, #1351, #1396) — the
  queue's agent sessions are scoped to the filing repo alone. Retire only if those sessions gain
  cross-repo scope.
- **(verify-in-production-5)** Hand-set `task:status:*` labels produced an item closed wearing a
  live status (#1220) and one labelled `done` but left open (#1265); the done label hides the
  item from the leash. Retire only if the queue's transitions are enforced server-side.
- **(verify-in-production-6)** #1160's retry re-armed `Not-before:` from the field's old value,
  which the hourly release pass had already left in the past, so the item went ready on the next
  pass and a daily retry spent a session an hour.
- **(do-later-1)** #1160 carried its `Model:` line six paragraphs below its waits, where a retry
  rewriting `Not-before:` had no one block to edit and readers could not see what the run would
  do.
- **(writing-tests-1)** A UI-snapshot coverage gate parked behavioral leaves `9.1`–`9.3`/`3.4`
  and an unreachable `8.6` on cases that render none of them (#429).
- **(writing-tests-2)** The SPA-render fallback's CI test renders a `data:` URL whose script
  fills an empty root, not a live SPA (#310) — the live target was bot-blocked from CI.
- **(writing-tests-3)** A hostname-apex helper passed its hand-picked tests but mis-stripped
  `tel-aviv.gov.il` → `gov.il`; the gap only surfaced when the function was run over the actual
  list of existing URLs.
- **(check:declared-check-spec-keys)** The engine's declaration load drops a key it cannot place
  instead of throwing, because refusing it wedges a member holding an older engine (#1400); this
  check is where the typo half of that trade is caught. Retire it only if the load can refuse
  unknown keys again without wedging any fleet lane.
- **(check:reference-integrity)** Converted from `repo-text-sweeps`' prose in #552. The
  evidence for a blocking check is that nothing else catches it: a removed doc, module, or
  renamed path leaves dangling links, imports and index entries behind that **no test
  necessarily fails on** — a README docs-index link to a deleted file stays green. The prose
  also fixed the timing the check cannot enforce: grep the tree for the old path in the same
  change as the removal, not later. Reaffirm while dangling references stay invisible to the
  suite; retire only if the test suite starts failing on them.
- **(check:markdown-link-labels)** Converted from `repo-text-sweeps`' prose in #552. The
  mechanism a review needs is the sweep that produces it: a Markdown link carries its path
  **twice** — ``[`old/path.md`](old/path.md)`` holds it in both the visible label and the
  target — so a `sed` anchored on the `](href)` form rewrites the target and leaves the label
  reading the old path, and the doc then points right while *reading* wrong. Both the plain
  `[old/path.md]` and backticked label forms need the same rewrite. Reaffirm while Markdown
  duplicates the path across label and target; retire only if that stops being true.
