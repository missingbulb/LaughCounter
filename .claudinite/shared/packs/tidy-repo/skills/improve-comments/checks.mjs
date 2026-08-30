import { basename } from 'node:path';
import { finding } from '../../../../engine/checks/helpers/findings.mjs';
import { COMMENT_CHECKABLE, commentOnly } from '../../../../engine/checks/helpers/code-scanning.mjs';

// The write-surface gate for the improve-comments pass. Its skill bounds every edit
// to comments in code files and to `README.md` documents; the pass runs unattended
// and writes the repo's OWN SOURCE — the one surface no other tidy-repo task
// touches — so the boundary needs a machine guarantee rather than a prose request.
//
// THE PERMISSION IS READ, NEVER ASSERTED. A file passes because its code is
// identical once the comments are stripped from both sides, not because the run
// says it only touched comments. That is the whole point: a run that quietly
// renamed a variable while "improving comments" is exactly what this catches, and
// a run cannot talk its way past a text comparison.
//
// THREE SHAPES FAIL, and each is deliberate rather than an oversight:
//   - a file whose language `commentOnly` cannot parse counts as code, so a comment
//     edit in one reds the run. Answering "I could not look" as a pass would make
//     the gate silently narrower than the languages a repo actually holds;
//   - an ADDED or DELETED code file is never comment-only, whatever it holds — a
//     whole file is a whole file, and this pass does not add or remove them;
//   - a DELETED `README.md` is not an improvement to a README. Modifying one is the
//     pass's business; deciding a document should not exist is not;
//   - ANY change under `.claudinite/`, comment-only or not. The mount is not the
//     repo's own source: `shared/` is vendored and the next converge replaces it
//     whole (that half is already invisible to every check — repo-context drops
//     the shared prefix), and `.claudinite/local/` is what the growth tasks write.
//     The task's precondition keeps the mount out of a round's scope; this is what
//     holds when a run reaches for one anyway.
//
// RELEVANCE IS THE PINNED COMMIT SUBJECT, the same self-gating shape
// claudinite-growth's capture gate uses: the run marks itself, so this rule can run
// everywhere tidy-repo is active — at the session Stop hook and on every PR — and
// costs ~nothing on a branch that is not this pass.
export const IMPROVE_COMMENTS_RUN = /^Claudinite tidy: improve comments/;

const isReadme = (p) => basename(p).toLowerCase() === 'readme.md';

// The same prefix the task's precondition filters its scope by (MOUNT_PREFIX in
// tasks/improve-comments/task.mjs); that task imports nothing, so the two are held
// in step by the test beside this check rather than by a shared constant.
const MOUNT_PREFIX = '.claudinite/';
const inMount = (p) => p.startsWith(MOUNT_PREFIX);

const rule = {
  id: 'improve-comments-scope',
  severity: 'blocking',
  scope: 'work',
  doc: 'packs/tidy-repo/skills/improve-comments/SKILL.md',
  description: 'An improve-comments run changes only comments in code files outside the .claudinite/ mount, and README.md documents',
  why: 'the pass runs unattended against the repo\'s own source, and its whole safety case is that a comment cannot change behaviour — a run that also moved a line has made an unreviewed code change wearing a housekeeping title',

  run(work) {
    if (work.onDefaultBranch()) return [];
    if (!work.commits.some((m) => IMPROVE_COMMENTS_RUN.test(m))) return [];

    const deleted = new Set(work.deleted);
    return [...new Set([...work.changedFiles, ...work.deleted])]
      .filter((p) => inMount(p) || (isReadme(p) ? deleted.has(p) : !commentOnly(p, work.readBase(p), work.read(p))))
      .sort()
      .map((p) => finding(rule, inMount(p)
        ? {
          file: p,
          what: `an improve-comments run changed ${p}, which is inside the ${MOUNT_PREFIX} mount`,
          fix: `revert ${p} — the mount is not this repo's source: the next converge replaces it whole, so a comment improved there is gone by morning; take the change to the canon instead`,
        }
        : isReadme(p)
        ? {
          file: p,
          what: `an improve-comments run deleted ${p} — a README may be improved, never removed`,
          fix: 'restore the file; deciding a document should not exist is a change that gets reviewed, not a comment pass',
        }
        : unparseable(p)
          ? {
            file: p,
            what: `an improve-comments run changed ${p}, whose language the comment parser cannot read`,
            fix: `revert ${p} — outside the parser's set a file counts as code, so nothing here can show the change was only comments; leave them to a change that gets reviewed`,
          }
          : {
            file: p,
            what: work.readBase(p) === null || deleted.has(p)
              ? `an improve-comments run added or deleted ${p}, which is never a comment-only change`
              : `an improve-comments run changed more than the comments in ${p}`,
            fix: 'keep the branch to comment text in code files and to README.md content — a rename, a moved line or a reformat is its own change, with its own review',
          }));
  },
};

// Whether the file's language is one `commentOnly` can parse at all. Only used to
// pick the remedy: a run told "you changed more than comments" about a `.py` file
// it only commented would go looking for a code edit that isn't there.
function unparseable(p) {
  const dot = p.lastIndexOf('.');
  return !COMMENT_CHECKABLE.has(dot === -1 ? '' : p.slice(dot).toLowerCase());
}

export default [rule];
