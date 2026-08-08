// The STORE this pack points at: where a repo's users keep their personal
// interaction preferences, and how one person's file is addressed inside it.
//
// One resolver, because two readers need the same answer and must never disagree:
// the session-start step that fetches a person's file, and the conformance rule that
// says whether this pack is configured at all. Anything that grows a third reader
// (a fleet sweep writing the pointer into a member) reads it from here too.
//
// THE SHAPE, on this pack's own entry in `.claudinite-checks.json`:
//
//   { "id": "claude-code-web-users-support", "config": { "repo": "owner/name", "path": "preferences" } }
//
// `repo` is required — the store is a repository, because personal preferences
// belong to a group of people rather than to any one project, and a repo is the
// smallest thing that can hold them for a whole fleet without living inside any
// member of it. `path` is where they sit in that repo and defaults to `preferences`.
// One file per person, named for their identity: `<path>/<email>.md`.
//
// Dependency-free and pure: the caller supplies the parsed config, so this module
// touches neither disk nor network and is testable standalone.

export const DEFAULT_PATH = 'preferences';

// `{ repo, path }` when the config names a usable store, else null. Null covers both
// "nothing declared" and "declared but unusable" deliberately: every caller's next
// move is the same either way, and the difference is reported once, by the rule that
// exists to report it.
export function resolveStore(config) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return null;
  if (typeof config.repo !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(config.repo)) return null;
  if (config.path !== undefined && (typeof config.path !== 'string' || config.path.includes('..') || config.path.startsWith('/'))) return null;
  const path = (config.path ?? DEFAULT_PATH).replace(/^\.\/+|\/+$/g, '');
  return { repo: config.repo, path: path || DEFAULT_PATH };
}

// Where one person's file sits inside the store, as a repo-relative path. An address
// only — whether it is read from a working tree or fetched over HTTPS is the caller's
// business.
export function fileFor(store, email) {
  return `${store.path}/${email}.md`;
}

// Is this string usable as the name of a person's file? It becomes both a path
// segment and a URL component, so an implausible one is refused rather than
// traversed with: `../../x` as an "email" would address an arbitrary file.
export const isUsableIdentity = (email) => typeof email === 'string'
  && /^[^\s/\\]+@[^\s/\\]+$/.test(email)
  && !email.includes('..');
