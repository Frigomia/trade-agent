import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function updateDependabotPrs(repository, run = execFileSync) {
  const root = `repos/${repository}`;
  const api = (...args) => JSON.parse(run('gh', ['api', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim() || 'null');
  const master = api(`${root}/git/ref/heads/master`).object.sha;
  const pages = api(`${root}/pulls?state=open&base=master&per_page=100`, '--paginate', '--slurp');
  const failed = [];
  let updated = 0;

  for (const pr of pages.flat()) {
    if (pr.user.login !== 'dependabot[bot]' || pr.draft ||
        pr.head.repo?.full_name !== repository || pr.base.repo.full_name !== repository ||
        pr.base.ref !== 'master' || !pr.head.ref.startsWith('dependabot/')) continue;

    try {
      // Pin master explicitly: a concurrent PR-base edit must not import another branch.
      // The merge API preserves concurrent bot commits and returns 204 when already current.
      const result = api(`${root}/merges`, '--method', 'POST',
        '-f', `base=${pr.head.ref}`, '-f', `head=${master}`);
      if (result) updated++;
    } catch {
      // gh writes the API error to stderr; continue so one conflict cannot starve other PRs.
      failed.push(pr.number);
    }
  }

  if (failed.length) throw new Error(`Could not update Dependabot PRs: ${failed.join(', ')}`);
  return updated;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.info(`Updated ${updateDependabotPrs(process.env.GITHUB_REPOSITORY)} Dependabot branches.`);
}
