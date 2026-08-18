# claude-code-web-users-support — for the people working on this from the web

A Claude Code **web** session runs for a signed-in person, in a managed container. A
terminal session does neither. This pack is where the capabilities that depend on that
difference live — anything a project can offer only when the session knows **who** is
here, or only because the environment it runs in is one somebody configured.

## Personal interaction preferences

This project reads each person's **personal interaction preferences** at session start:
how they want to be worked with — tone, summary style, end-of-turn conventions, the
phrases they use to trigger a defined command. If the current user has a file in the
store, its contents are already in this session's context, injected under this pack's
marker by [`session-start.mjs`](session-start.mjs).

**They are not project conventions.** Conventions belong to the packs that own each
subject and load as prose. What this carries is *personal*: the same rules travel with
a person across every project they work in, and two people on one project can want
different things. Where a preference triggers a command whose mechanics are a project
convention, the mechanics stay in their own doc and the preference owns only the
trigger phrase.

**The pack holds an address, not the content.** Preferences belong to a group of people
rather than to any one repository, so this project's declaration names the **store** —
a repo, and a path inside it holding one `<email>.md` per person:

```json
{ "id": "claude-code-web-users-support", "config": { "repo": "owner/name", "path": "preferences" } }
```

`path` is optional and defaults to `preferences`. Reading is **local-first**: when this
repo *is* the store, the working copy wins over the default branch, so an edit in
progress is what the session sees.

**Every miss is fail-soft.** No identity (a terminal session has none), no configured
store, no file for this person, a fetch that fails — each is one plain-text note and the
session proceeds on default interaction behavior. Nothing here is load-bearing, and a
nice-to-have must never be able to stop a session from starting.

### If this repo *is* the store

The file name is the **whole address**: the reader builds `<path>/<email>.md` from the
identity the harness supplies, and there is no index, no registry and no fallback. So
every file under `path` is either the store's own `README.md` or one person's
`<identity>.md`; anything else sits in the tree looking fine and is never opened. Two
consequences worth holding: the name must be that person's identity **exactly**, because
it becomes a case-sensitive `raw.githubusercontent.com` path segment that a local
checkout would happily serve either way; and the store is **flat**, because grouping
people into subdirectories makes their files unaddressable.

### Adding or changing a preference

Edit that person's file **in the store repo** — never here, and never in the canon. One
distilled preference per bullet, in the imperative: a preference is a rule the assistant
can act on, not a description of a mood. A preference that turns out to be a project
convention in disguise belongs in the pack that owns its subject instead.

## The web environment's Setup script

Only a managed container has a **Setup script** field, and the web base image ships no
toolchains — so a web session can run a project's tests only if somebody pasted one in.
The body to paste is [`environment-setup-command.sh`](environment-setup-command.sh),
whole and unedited: it installs every active pack's declared requirement, so it is
identical for every project and never changes as those requirements do. Re-paste it (and
rebuild) when a session-start check reports a missing requirement — never hand-edit a
project-specific step into it; that step belongs in the owning pack's `env` declaration.
