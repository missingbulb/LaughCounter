// A legacy-path shim — see ./legacy-entry.mjs. The wiring converge split in two
// (#1317): distribution wiring is the engine's, the two workflow files are the tasks
// pack's. A fielded caller still names this one path and its old signature, so both
// halves are re-exported here and `convergeWiring` keeps taking the scheduler stub it
// used to. Deleted once no fielded worker or stored prompt names this path.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { convergeWiring as convergeDistribution } from '../converge-wiring.mjs';
import { convergeWorkflows } from '../../packs/claudinite-tasks/converge-workflows.mjs';

export * from '../converge-wiring.mjs';
export * from '../../packs/claudinite-tasks/converge-workflows.mjs';

export async function convergeWiring(root, fullName, stubText, { badges = false, workflows = true, seedLocalPack = false, executorStub = null, secretNames = [], dailyHour = undefined } = {}) {
  const wrote = workflows
    ? convergeWorkflows(root, fullName, { schedulerStub: stubText, executorStub, secretNames, dailyHour }).changed
    : [];
  const { changed, ...rest } = await convergeDistribution(root, fullName, { badges, seedLocalPack });
  return { changed: [...wrote, ...changed], ...rest };
}

// The old CLI, whole: a stored prompt or a hand-run command still names this path, and
// the shared `legacy-entry.mjs` cannot redirect it — the file it would point at is the
// pack's own converge-workflows.mjs, which takes different arguments. So this one shim
// carries its own main rather than borrowing one.
async function main() {
  const argv = process.argv.slice(2);
  const badges = argv.includes('--badges');
  const seedLocalPack = argv.includes('--seed-local-pack');
  const fullName = argv.find((a) => !a.startsWith('--')) || process.env.GITHUB_REPOSITORY || process.env.CLAUDINITE_REPO;
  if (!fullName) { console.error('converge-wiring: need owner/repo (argv or GITHUB_REPOSITORY)'); process.exit(1); }
  const root = process.env.CLAUDINITE_REPO_ROOT || process.cwd();
  const { loadConfig } = await import('../checks/helpers/repo-context.mjs');
  const { stubsDir, declaredSecrets } = await import('../../packs/claudinite-tasks/converge-workflows.mjs');
  const stubs = stubsDir(root);
  const stubPath = join(stubs, 'claudinite-scheduler.yml');
  const executorPath = join(stubs, 'claudinite-executor.yml');
  const { changed, error } = await convergeWiring(root, fullName, existsSync(stubPath) ? readFileSync(stubPath, 'utf8') : '', {
    badges,
    seedLocalPack,
    workflows: existsSync(stubPath),
    executorStub: existsSync(executorPath) ? readFileSync(executorPath, 'utf8') : null,
    secretNames: await declaredSecrets(root, loadConfig(root)),
    dailyHour: loadConfig(root)?.taskScheduler?.dailyHour,
  });
  if (error) console.log(`! ${error}`);
  console.log(changed.length ? `converge-wiring: ${changed.join(', ')}` : 'converge-wiring: already converged');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
