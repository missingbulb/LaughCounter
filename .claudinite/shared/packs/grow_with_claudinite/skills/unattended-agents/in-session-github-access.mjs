import { patternRule } from '../../../../engine/checks/helpers/pattern-rules.mjs';

const FIX = 'reach GitHub through the session’s injected MCP-backed I/O (a gh(path) reader for reads, a semantic io object for writes); move any work that needs an account-wide credential into a workflow_dispatch-only executor';

export default patternRule({
  id: 'in-session-github-access',
  severity: 'blocking',
  description: 'In-session routine code reaches GitHub through the MCP tools, not a REST client + GITHUB_TOKEN',
  doc: 'skills/unattended-agents/SKILL.md',
  why: 'a routine runs in an MCP-only session with no shell GitHub REST credential; a REST client / GITHUB_TOKEN in its own steps cannot authenticate there — that belongs in a workflow_dispatch-only CI executor',
  files: /^(routines|migrations)\/.*\.mjs$/,
  exclude: /\.test\.mjs$/,
  skipLines: /^\s*(\/\/|\*|\/\*)/,
  line: [
    {
      match: /process\.env\.(GITHUB_TOKEN|GH_TOKEN|FLEET_GITHUB_TOKEN)/,
      what: 'reads a GitHub REST token from the environment — in-session routine code has no REST credential',
      fix: FIX,
    },
    {
      match: /\bmakeGh\s*\(|from\s+['"][^'"]*\bfleet-api/,
      what: 'uses the REST client (makeGh / fleet-api) — in-session routine code has no REST credential',
      fix: FIX,
    },
    {
      match: /['"`]https?:\/\/api\.github\.com/,
      what: 'targets the GitHub REST API (api.github.com) directly — in-session routine code has no REST credential',
      fix: FIX,
    },
  ],
});
