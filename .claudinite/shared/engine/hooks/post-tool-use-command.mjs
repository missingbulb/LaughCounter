#!/usr/bin/env node
// Claude Code PostToolUse hook entry: the runner owns the process, the judge owns the
// verdict — see hook-runner.mjs and post-tool-use-judge.mjs.
import { runHook } from './hook-runner.mjs';

runHook('PostToolUse', { canBlock: false, load: () => import('./post-tool-use-judge.mjs') });
