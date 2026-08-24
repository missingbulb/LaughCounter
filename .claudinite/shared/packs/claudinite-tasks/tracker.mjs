// A STANDING TRACKER — the one issue a recurring task logs every run to. This is a
// LIBRARY, not a phase: nothing in the scheduler knows a task has a tracker, no
// declaration carries one, and no task is expected to want one. A task that keeps
// an aggregated record calls these from its OWN code-work and passes the number to
// its agentic phase through the ordinary hand-off payload (`delivered.issue`,
// rendered into the work item by queue/code-work-run.mjs).
//
// It exists because two tasks had each grown a private copy of the same search, and
// the copies had already diverged in a way that matters — one filtered `is:open`,
// which never matches a tracker at rest and so opens a second one the moment
// anybody closes the first.
//
// TWO PROPERTIES THE LOOKUP IS SHAPED AROUND:
//
//   EXACT MATCH, NEVER THE SEARCH'S OWN RANKING. GitHub's `in:title` search is a
//   text match, so a title that is a prefix or near-twin of another task's comes
//   back too — and where sibling tasks keep sibling trackers, the top-ranked hit is
//   not reliably the right one. Every result is re-filtered on the trimmed title
//   being EQUAL to the one asked for.
//
//   A FAILED SEARCH IS NOT AN ABSENT TRACKER. `findTracker` returns null only for
//   a search that ran and matched nothing; anything else throws, because a caller
//   that treats a rate-limited search as "none exists" opens a fresh tracker on
//   every failure.
//
// Creation is deliberately a SEPARATE call. Whether a run with nothing to say
// should mint a tracker at all is the task's judgment — a sweep that found nothing
// may hold that its own scan is not news — so this module never creates as a side
// effect of looking.

// The exact-title filter, pure so the ranking question is settled in a test rather
// than against a live repo's issue list. Lowest number wins: if a past race left
// two, every later run converges on the first and the duplicate stays inert.
export function pickTracker(items, title) {
  const want = title.trim();
  const exact = (items ?? [])
    .filter((i) => (i.title ?? '').trim() === want)
    .map((i) => ({ number: i.number, state: i.state }));
  if (!exact.length) return null;
  return exact.sort((a, b) => a.number - b.number)[0];
}

// The tracker titled exactly `title`, or null if no issue carries it. Searches
// EVERY state: a tracker's resting state is closed, so a state-filtered lookup
// misses all of them.
//
// A tracker found OPEN is closed on the way back. Creation has closed since #951,
// but that only ever covered a tracker this code minted — one that predates the
// fix, or whose closing PATCH failed, had nothing anywhere that would ever look at
// its state again, so it sat open indefinitely (#904, open from 2026-08-16). The
// repair rides the lookup because every task's own run performs one, which is the
// only pass guaranteed to reach every tracker in the fleet.
export async function findTracker(gh, repo, title) {
  const want = title.trim();
  const q = encodeURIComponent(`repo:${repo} in:title "${want}"`);
  const { status, json } = await gh(`/search/issues?q=${q}&per_page=100`);
  if (status !== 200 || !Array.isArray(json?.items)) {
    throw new Error(`could not search for the tracker ${JSON.stringify(want)}: search returned ${status}`);
  }
  const exact = json.items.filter((i) => (i.title ?? '').trim() === want);
  const found = pickTracker(exact, want);
  if (!found) return null;
  // Fail-soft, and deliberately so: an unclosable tracker is untidy, never a
  // reason to fail the run that was about to write its record.
  if (found.state === 'open') {
    await gh(`/repos/${repo}/issues/${found.number}`, {
      method: 'PATCH',
      body: { state: 'closed', state_reason: 'completed' },
    }).catch(() => {});
  }
  return { number: found.number, duplicates: exact.length - 1 };
}

// Create the tracker and close it — TWO calls, because issue creation always lands
// an issue open and ignores a `state` argument, so the single-call version left
// every tracker open across the fleet (#951).
export async function createTracker(gh, repo, title, body = null) {
  const want = title.trim();
  const created = await gh(`/repos/${repo}/issues`, {
    method: 'POST',
    body: { title: want, body: body ?? trackerSeedBody(want) },
  });
  if (created.status >= 300 || !created.json?.number) {
    throw new Error(`could not create the tracker ${JSON.stringify(want)}: create returned ${created.status}`);
  }
  const number = created.json.number;
  const closed = await gh(`/repos/${repo}/issues/${number}`, {
    method: 'PATCH',
    body: { state: 'closed', state_reason: 'completed' },
  });
  return { number, leftOpen: closed.status >= 300 };
}

// Find it, or create it — for a task that writes to its tracker on every run and
// therefore always wants one. A task whose run may have nothing to record calls
// `findTracker` alone and creates only once it has something to write.
export async function findOrCreateTracker(gh, repo, title) {
  const found = await findTracker(gh, repo, title);
  if (found) return { ...found, created: false };
  const made = await createTracker(gh, repo, title);
  return { number: made.number, duplicates: 0, created: true, leftOpen: made.leftOpen };
}

// What a freshly-created tracker says before its first run writes to it. It names
// its own contract, because whoever finds it next finds it closed and empty.
export function trackerSeedBody(title) {
  return [
    `Standing tracker for the Claudinite task that logs to **${title}**.`,
    '',
    'This issue is a living document: the **body** is rewritten to the current picture each run,',
    'and each run adds a dated comment. Its closed state carries no meaning — nothing opens,',
    'closes or reopens it, and no run should be read as "resolved" because it is closed.',
    '',
    '_No run has written here yet._',
  ].join('\n') + '\n';
}

// Write a run's state to the tracker: the BODY replaced with the current picture,
// and optionally one dated comment appended. The state is untouched, in either
// direction — the body is the live picture, the comments are the trail.
export async function writeTracker(gh, repo, number, { body, comment = null } = {}) {
  if (body !== undefined && body !== null) {
    const patched = await gh(`/repos/${repo}/issues/${number}`, { method: 'PATCH', body: { body } });
    if (patched.status >= 300) throw new Error(`could not refresh tracker #${number}: PATCH returned ${patched.status}`);
  }
  if (comment) {
    const posted = await gh(`/repos/${repo}/issues/${number}/comments`, { method: 'POST', body: { body: comment } });
    if (posted.status >= 300) throw new Error(`could not comment on tracker #${number}: POST returned ${posted.status}`);
  }
  return number;
}
