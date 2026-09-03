# claude-code-web-users-support — working from Claude Code on the web

- **A person asking to change one of their personal preferences** — edit their `<email>.md` in the
  preferences store repo this pack names, never here and never in the canon; a project convention
  in disguise belongs in the pack owning its subject, and a preference triggering a command owns
  only the trigger phrase.

- **A person asking to record their personal preferences with no file yet** — create it in that
  store repo, named for their exact identity plus `.md`, case included: the reader opens
  `<path>/<email>.md` and nothing else, so any other name is silently never read.

- **A web session halt-gated on a missing toolchain requirement** — re-paste
  [`environment-setup-command.sh`](environment-setup-command.sh) whole and unedited into the
  environment's Setup script field, then rebuild; a project-specific step belongs in its own
  pack's `env` declaration, never in that body.
