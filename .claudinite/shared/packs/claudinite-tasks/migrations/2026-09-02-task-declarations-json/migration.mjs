// A member's own task declarations become data (#1633): every
// `.claudinite/local/packs/<pack>/tasks/<name>/task.mjs` is converted to a
// `task.json` pointing at the task schema, and the module is deleted.
//
// THE WRITE IS THE ENGINE'S. `taskDeclarationsToJson: true` names the registry's
// named codemod (engine/migrations/registry.mjs, `applyTaskDeclarationConversion`),
// which runs the same converter the CLI does. A record cannot carry it: the JSON is
// the module's evaluated export, which no textual rewrite produces.
//
// GATED ON THE MOUNT, BY CONTENT. Converting is only safe once the member's
// vendored `claudinite-tasks` reads `task.json` — this pack's discover goes
// through `task-declaration.mjs` from the version this record lands with, and an
// older mount would see a folder with no `task.mjs` and silently run nothing.
// The two lanes deliver on their own cadences, so `appliesTo` probes the mounted
// pack for that module rather than trusting the stamp; an unreadable mount reads
// as "not capable" and the record stays inert. The canon runs the same probe
// against its own tree (two-root form).
//
// IDEMPOTENT by construction: a folder with no `task.mjs` is nothing to convert.
//
// THE APPLY STAGE WRITES THE DESCRIPTIONS. A converted declaration has every field
// its module had and no `description`, because a description is judgment — what
// the task does, or why it exists, in the words a reader of the pack wants — and
// the code cannot write one. The module's comments went into the task's README
// (the converter's doing), so the session has the author's own words to work from.
// The stage runs once per member, on the update that delivers this record; on a
// member with no local tasks it finds nothing to write and ends.
const READER = 'packs/claudinite-tasks/task-declaration-text.mjs';
const mountReadsJson = async (read) => {
  const text = (await read(`.claudinite/shared/${READER}`)) ?? (await read(READER));
  return Boolean(text) && text.includes("'task.json'");
};

export default {
  id: 'task-declarations-json',
  landed: '2026-09-02',
  version: '60903.3',
  summary: 'a member\'s local-pack task.mjs declarations are converted to task.json, the data form the engine now reads (#1633)',

  appliesTo: mountReadsJson,
  taskDeclarationsToJson: true,

  applyStage: {
    why: 'each converted local-pack task declaration needs a description only a reader of the task can write',
    instructions: [
      'The deterministic half converted every `.claudinite/local/packs/<pack>/tasks/<name>/task.mjs`',
      'in this repo to a `task.json`, moving the module\'s comments into that task\'s `README.md`',
      'under "Why the declaration reads as it does". What it could not write is the',
      '`description` field. For every `task.json` under `.claudinite/local/packs/` that has',
      'no `description`, add one: up to fifty words on what the task does, or why it exists,',
      'read from the task\'s README, its `task.md` if it has one, and its worker. It must not',
      'restate what the other fields already say — never the cadence, the conditions, the',
      'automerge policy, or where the files live. Place it right after `id`, keep the file\'s',
      'other keys and its indentation as they are, and do not edit the vendored mount under',
      '`.claudinite/shared/`. A task.json that already carries a description is left alone.',
      'If no local task.json lacks one, there is nothing to do here.',
    ].join('\n'),
  },

  // The telemetry hook cannot list directories, and the fact this record retires
  // — a `task.mjs` under the member's local packs — is only visible by listing.
  // The fleet-visible signal is the shape check's advisory on every remaining
  // module (task-declaration-shape); the cleanup that drops the module reader is
  // gated on that advisory firing nowhere (#1633).
  legacyPresent: async () => false,
};
