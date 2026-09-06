#!/usr/bin/env node
// Claude Code UserPromptSubmit hook entry: the runner owns the process, the judge owns the
// verdict — see hook-runner.mjs and user-prompt-submit-judge.mjs.
import { runHook } from './hook-runner.mjs';

runHook('UserPromptSubmit', { canBlock: false, load: () => import('./user-prompt-submit-judge.mjs') });
