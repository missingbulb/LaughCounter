#!/usr/bin/env node
// Claude Code PreToolUse hook entry: the runner owns the process, the judge owns the
// verdict — see hook-runner.mjs and pretooluse-judge.mjs.
import { runHook } from './hook-runner.mjs';

runHook('PreToolUse', { canBlock: true, load: () => import('./pretooluse-judge.mjs') });
