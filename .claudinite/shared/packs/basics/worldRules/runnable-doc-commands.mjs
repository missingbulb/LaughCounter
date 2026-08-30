import { finding } from '../../../engine/checks/helpers/findings.mjs';

// A `node <path>` written in a doc is a command an agent will run, and nothing
// opens it until one does. A link has `deadLinks`; a check's `doc:` field is
// grepped by hand; a runnable command in prose had neither, which is how both of
// the tasks pack's operational documents spent two months telling every unattended
// session to run `<engine>/scheduler/…` after #1326 moved that code to
// `packs/claudinite-tasks/` (#1475). The docs are the entire stored prompt of a
// member's routine endpoints, so the first instruction each session receives named
// a path that resolves nowhere.
//
// WHAT IT CAN JUDGE. Only paths the corpus owns. A pack's prose legitimately names
// files in the *consuming* repo (`node tools/build.mjs`), which cannot exist here,
// so two shapes are checkable and the rest is skipped:
//
//   1. PLACEHOLDER-ROOTED (`node <engine>/hooks/session-end-command.mjs`) — whatever
//      the placeholder turns out to mean, the remainder is a real path suffix or the
//      command names nothing. This is the shape that broke: the placeholder's own
//      definition drifted, and the suffix went with it.
//   2. MOUNT-ROOTED (`node .claudinite/shared/packs/…`) — the mount mirrors the
//      canon, so the path below it resolves against this tree directly.
//
// A bare filename (`node worker.mjs`, run from a task directory) and a plain
// relative path are the consuming repo's business and are left alone.
const COMMAND = /\bnode\s+((?:<[a-z-]+>|[\w.@/-])[\w.@/<>-]*\.mjs)\b/g;
const MOUNT = /^\.claudinite\/shared\//;
const PLACEHOLDER = /^<[a-z-]+>\//;

// Only the pack docs this repo AUTHORS. The vendored copy under
// `.claudinite/shared/packs/` is canon output a member may never edit, so a finding
// there is one its owner cannot act on.
const AUTHORED_DOC = /^(\.claudinite\/local\/)?packs\/.+\.md$/;

const rule = {
  id: 'runnable-doc-commands',
  severity: 'blocking',
  description: 'Every `node <path>` a pack doc tells an agent to run names a file this repo carries',
  doc: 'packs/basics/README.md',
  why: 'a command in prose is opened only when an agent runs it, so a path left behind by a move goes on instructing every session that follows the doc, with nothing red anywhere',

  run(ctx) {
    const out = [];
    // Suffix matching needs the whole tracked set, not just this doc's neighbours:
    // a mount path and a canon path are the same file reached two ways.
    const paths = ctx.files;
    const resolves = (suffix) => paths.some((f) => f === suffix || f.endsWith(`/${suffix}`));

    for (const file of ctx.files.filter((f) => AUTHORED_DOC.test(f))) {
      const text = ctx.read(file);
      if (text === null) continue;
      for (const [, path] of text.matchAll(COMMAND)) {
        if (PLACEHOLDER.test(path)) {
          const suffix = path.replace(PLACEHOLDER, '');
          if (resolves(suffix)) continue;
          out.push(finding(rule, {
            file,
            what: `tells an agent to run \`node ${path}\`, and no file in this repo ends with \`${suffix}\``,
            fix: `point the command at the file that owns that code now — and prefer a base the doc can derive from its own location, so the next move cannot silently orphan it again`,
          }));
        } else if (MOUNT.test(path)) {
          const inCanon = path.replace(MOUNT, '');
          if (ctx.exists(path) || ctx.exists(inCanon)) continue;
          out.push(finding(rule, {
            file,
            what: `tells an agent to run \`node ${path}\`, which the mount does not carry`,
            fix: `name the module that does the job now; a mount path is vendored canon, so \`${inCanon}\` is where it must exist`,
          }));
        }
      }
    }
    return out;
  },
};

export default rule;
