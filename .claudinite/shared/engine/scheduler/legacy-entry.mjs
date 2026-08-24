// A LEGACY-PATH SHIM, deleted once no fielded worker names one (#1317).
//
// The task surface moved to packs/claudinite-tasks/, and the modules beside this one
// re-export it from the paths a member still names — a vendored worker's import, a
// workflow `run:` line, a stored routine prompt. A COMMAND-LINE entry decides it is
// running as the program by comparing its own `import.meta.url` to `process.argv[1]`,
// which under a shim names the shim rather than the module, so the program would
// define its exports and do nothing. Rewriting the path here — before the re-export
// beneath the import of this module evaluates the target — is what keeps
// `node <mount>/engine/scheduler/queue/scheduler-run.mjs` doing the run it did.
if (process.argv[1]?.includes('/engine/scheduler/')) {
  process.argv[1] = process.argv[1].replace('/engine/scheduler/', '/packs/claudinite-tasks/');
}
