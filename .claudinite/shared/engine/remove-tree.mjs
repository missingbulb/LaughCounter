// REMOVING A DIRECTORY GIT MAY STILL BE WRITING INTO.
//
// A recursive delete walks the tree and unlinks as it goes, so anything that
// appears in a directory between the walk and its rmdir makes the rmdir throw
// ENOTEMPTY. Git is a prolific source of exactly that: a `git` child that has
// returned still leaves its own housekeeping — auto-gc, packing, index and lock
// files under `.git/` — running for a moment afterwards, and under a parallel
// `node --test` there is always another core to run it on.
//
// The symptom is a delete that fails on a healthy tree, which reads as a broken
// test rather than a race: a red CI on a change that touched none of it. This
// repo has now closed that finding three times — #235, #258, and #1219 — each
// time by fixing the one call site that happened to fail, because each site
// spelled its own delete. So the retry lives HERE, once, and the sites that
// delete a git tree call this rather than rmSync.
//
// `maxRetries` is Node's own answer: rmSync retries EBUSY, EMFILE, ENFILE,
// ENOTEMPTY and EPERM with a linear backoff of `retryDelay` ms more each time.
// Three tries over ~300ms outlasts git's housekeeping without making a genuinely
// undeletable tree hang a run.
//
// It is the SECOND line of defense, not the first. Where the caller controls the
// git environment, keeping git's own background work in the foreground is the
// real fix — `GIT_ENV` in engine-tests/helpers.mjs does exactly that, and says so.
// This covers everything deleted by code that does not, or cannot, set it.

import { rmSync } from 'node:fs';

export const REMOVE_TREE_OPTIONS = { recursive: true, force: true, maxRetries: 3, retryDelay: 50 };

// Remove `path` and everything under it. `force` means a path that is already
// gone is success, so this is safe to call in a `finally` that may run twice.
export function removeTree(path) {
  rmSync(path, REMOVE_TREE_OPTIONS);
}
