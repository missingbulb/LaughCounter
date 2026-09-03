// claude-code-web-users-support — what a project can offer the people who work on it
// from Claude Code on the web, and cannot offer anyone else.
//
// THE THING THAT MAKES THIS A PACK. A web session runs for a SIGNED-IN PERSON: the
// harness puts their identity in the environment (`CLAUDE_CODE_USER_EMAIL`), and the
// session runs in a managed container rather than on their laptop. A terminal session
// has neither. So there is a class of capability — anything that has to know *who* is
// here — that exists on that surface and nowhere else, and it belongs together, behind
// one declaration a project makes once.
//
// FIRST FEATURE: PERSONAL INTERACTION PREFERENCES. How a person wants to be worked
// with — tone, summary style, end-of-turn conventions, the phrases they use to trigger
// a command. Not project conventions (those are the other packs' business), and not
// the canon's content: the canon is mounted by every fleet that adopts Claudinite, so
// it is both the wrong host for one group's preferences and the wrong authority on
// where they live.
//
// SO THE PACK CARRIES AN ADDRESS, NOT CONTENT. Its entry config names the STORE — a
// repository, and a path inside it holding one `<email>.md` per person:
//
//   { "id": "claude-code-web-users-support", "config": { "repo": "owner/name" } }
//
// and `session-start.mjs` reads that person's file into the session, fail-soft, every
// session. The engine runs it because the file is there (the pack session-start
// runner's structural discovery) and learns nothing about what it does — which is what
// lets this be a pack at all, rather than a special case wired into the session-start
// machinery of every repo that mounts the corpus.
//
// SECOND FEATURE: THE ENVIRONMENT SETUP SCRIPT. `environment-setup-command.sh` is the
// body a project pastes into its web environment's Setup script field, so the image
// carries the toolchains the base image doesn't ship. It lives here because a managed
// container is the only surface that has such a field at all — a terminal session
// installs its toolchains itself. What it installs is every active pack's business
// (the `env` declarations the engine aggregates), which is why the body is generic and
// identical everywhere.
//
// SEEDED BY DEFAULT. Any project can have people working on it from the web, so
// `--init` declares it; the adoption question below is what turns the declaration into
// a working store, and a project that wants none answers "n/a" and carries a pack that
// says so rather than doing anything.

export default {
  version: '60902.1',
  minEngineVersion: '60822.1',
  ruleRoutingGuidance: {
    belongs: 'what a project offers people working from Claude Code on the web, where the session knows who they are',
    excludes: 'project conventions and process — those are the packs that own each subject',
  },
  seededByDefault: true,
  questions: [
    {
      id: 'store',
      prompt: 'Where do this project\'s people keep their personal interaction preferences — the repository holding one `<email>.md` per person? Give an `owner/name` (a fleet usually has one repo for this), or say "n/a — none" if this project has no such store.',
      distill: 'the answer\'s `owner/name` becomes this entry\'s `config.repo` (add `config.path` only when the files do not sit in `preferences/`); "n/a" leaves the entry without a config and the preferences feature inert',
    },
  ],
  // The Setup script field belongs to a managed container's configuration, not to the
  // checkout, so no run of anything in this repo can fill it — and until someone does,
  // a web session has no toolchain and the env check halt-gates it. Declared here so
  // the install flow prints it and the adopting session files it as an issue, rather
  // than mentioning it once in a PR body nobody returns to (#1167).
  adoptionHandover: [
    {
      step: 'Paste the body of this pack\'s environment-setup-command.sh, whole and unedited, into the web '
        + 'environment\'s Setup script field, then rebuild. Quote that body inline here in a fenced block: the '
        + 'reader of this step is the person about to paste it, and sending them to find a file in the mount is '
        + 'the hop this exists to remove.',
      breaks: 'a Claude Code web session on this repo has none of the toolchains the active packs need, and the session-start env check halt-gates it before any work',
      done: 'a web session on this repo starts with no missing-requirement halt-gate',
    },
  ],
  // Both audit the repo as it stands, whatever this session touched: a store broken by
  // an earlier commit is just as silent as one broken by this one. The second is inert
  // in every repo but the one that HOLDS the store it declares.
};
