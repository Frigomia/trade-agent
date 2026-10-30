import assert from 'node:assert/strict';
import test from 'node:test';
import { updateDependabotPrs } from './update-dependabot-prs.mjs';

const repository = 'Frigomia/trade-agent';
const master = 'tested-master-sha';
const pr = (number, changes = {}) => ({
  number,
  user: { login: 'dependabot[bot]' },
  draft: false,
  head: { ref: `dependabot/uv/backend/package-${number}`, repo: { full_name: repository } },
  base: { ref: 'master', sha: 'do-not-trust-the-pr-base-sha', repo: { full_name: repository } },
  ...changes,
});

function fixture(pages, merge = () => JSON.stringify({ sha: 'merged' })) {
  const updates = [];
  return {
    updates,
    run(command, args) {
      assert.equal(command, 'gh');
      const [api, endpoint, ...options] = args;
      assert.equal(api, 'api');
      if (endpoint.endsWith('/git/ref/heads/master')) return JSON.stringify({ object: { sha: master } });
      if (endpoint.includes('/pulls?')) {
        assert.deepEqual(options, ['--paginate', '--slurp']);
        return JSON.stringify(pages);
      }
      assert.equal(endpoint, `repos/${repository}/merges`);
      assert.equal(options[0], '--method');
      assert.equal(options[1], 'POST');
      const fields = Object.fromEntries(options.filter((_, index) => index >= 3 && index % 2 === 1)
        .map(field => field.split('=')));
      updates.push(fields);
      return merge(fields);
    },
  };
}

test('updates every eligible Dependabot PR across pages, including zero-approval and failing PRs', () => {
  const fake = fixture([
    [pr(1), pr(2, { user: { login: 'human' } }), pr(3, { draft: true }),
      pr(4, { head: { ref: 'dependabot/package', repo: { full_name: 'attacker/fork' } } }),
      pr(5, { head: { ref: 'feature/human', repo: { full_name: repository } } }),
      pr(6, { base: { ref: 'feature/retargeted', repo: { full_name: repository } } })],
    [pr(7)],
  ]);
  assert.equal(updateDependabotPrs(repository, fake.run), 2);
  assert.deepEqual(fake.updates, [
    { base: 'dependabot/uv/backend/package-1', head: master },
    { base: 'dependabot/uv/backend/package-7', head: master },
  ]);
});

test('already-current branches return 204 and do not count as updates', () => {
  const fake = fixture([[pr(1)]], () => '');
  assert.equal(updateDependabotPrs(repository, fake.run), 0);
});

test('a conflict does not starve later PRs and the overall run still fails', () => {
  const fake = fixture([[pr(1), pr(2)]], fields => {
    if (fields.base.endsWith('-1')) throw new Error('HTTP 409: merge conflict');
    return JSON.stringify({ sha: 'merged' });
  });
  assert.throws(() => updateDependabotPrs(repository, fake.run), /Could not update Dependabot PRs: 1/);
  assert.equal(fake.updates.length, 2);
});

test('failure to list PRs fails closed without writing any branches', () => {
  const fake = fixture([]);
  assert.throws(() => updateDependabotPrs(repository, (command, args) => {
    if (args[1].includes('/pulls?')) throw new Error('GitHub unavailable');
    return fake.run(command, args);
  }), /GitHub unavailable/);
  assert.deepEqual(fake.updates, []);
});
