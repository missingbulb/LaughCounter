export const WORKFLOW_FILE = /^\.github\/workflows\/[^/]+\.ya?ml$/;

export function workflowFiles(ctx) {
  return ctx.tracked.filter((f) => WORKFLOW_FILE.test(f));
}
