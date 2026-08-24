// Task-declaration validation, published for other packs: the contract a
// `tasks/<name>/task.mjs` is held to, so a pack's own tests can exercise its task
// declarations against the same rules the scheduler applies.
export * from '../task-contract.mjs';

// Running a declaration's precondition the way the executor does, so a pack's tests
// can assert its own tasks' decisions against the real evaluator.
export { evaluatePrecondition } from '../queue/executor.mjs';
