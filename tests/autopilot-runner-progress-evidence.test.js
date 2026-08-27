const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const script = path.resolve('scripts/validate-autopilot-runner-progress.mjs');

function run(evidence) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nusa-runner-progress-'));
  const input = path.join(dir, 'progress.json');
  fs.writeFileSync(input, JSON.stringify(evidence));
  return spawnSync(process.execPath, [script, input], { encoding: 'utf8' });
}

const base = {
  schemaVersion: 1,
  status: 'REQUEST_ACCEPTED',
  repository: 'cinamoncandy/NUSA',
  requested_head_sha: 'a'.repeat(40),
  request_id: 'req-123',
  idempotency_key: 'b'.repeat(64),
  live_authority: 'NONE',
  production_mutation_allowed: false,
  ai_authority: 'ZERO_AUTHORITY',
  direct_main_push: false,
  requires_pull_request: true,
  merge_only_after_exact_head_green: true,
};

test('accepts truthful disconnected state without claiming activation', () => {
  const result = run({
    ...base,
    status: 'NOT_CONNECTED',
    request_id: undefined,
    idempotency_key: undefined,
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.active, false);
  assert.equal(output.mergeReady, false);
});

test('accepts merge-ready evidence only with exact-head GREEN proof', () => {
  const produced = 'c'.repeat(40);
  const result = run({
    ...base,
    status: 'MERGE_READY',
    branch: 'autopilot/advance-repository',
    pr_number: 932,
    pr_url: 'https://github.com/cinamoncandy/NUSA/pull/932',
    produced_commit_sha: produced,
    exact_head_ci_state: 'GREEN',
    exact_head_ci_sha: produced,
    exact_head_verified: true,
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.mergeReady, true);
  assert.equal(output.exactHeadGreen, true);
});

test('fails closed on forged authority and unsafe branch behavior', () => {
  for (const [field, value] of [
    ['repository', 'evil/repo'],
    ['live_authority', 'ENABLED'],
    ['production_mutation_allowed', true],
    ['ai_authority', 'SELF_AUTHORITY'],
    ['direct_main_push', true],
    ['requires_pull_request', false],
    ['merge_only_after_exact_head_green', false],
  ]) {
    const result = run({ ...base, [field]: value });
    assert.notEqual(result.status, 0, `${field} drift must fail closed`);
  }
});

test('rejects branch, PR, and exact-head evidence drift', () => {
  const produced = 'd'.repeat(40);
  const invalidCases = [
    { status: 'BRANCH_CREATED', branch: 'feature/not-autopilot' },
    { status: 'PR_OPENED', branch: 'autopilot/x', pr_number: 12, pr_url: 'https://github.com/evil/repo/pull/12' },
    {
      status: 'CI_GREEN',
      branch: 'autopilot/x',
      pr_number: 12,
      pr_url: 'https://github.com/cinamoncandy/NUSA/pull/12',
      produced_commit_sha: produced,
      exact_head_ci_state: 'GREEN',
      exact_head_ci_sha: 'e'.repeat(40),
    },
    {
      status: 'MERGE_READY',
      branch: 'autopilot/x',
      pr_number: 12,
      pr_url: 'https://github.com/cinamoncandy/NUSA/pull/12',
      produced_commit_sha: produced,
      exact_head_ci_state: 'GREEN',
      exact_head_ci_sha: produced,
      exact_head_verified: false,
    },
  ];

  for (const evidence of invalidCases) {
    const result = run({ ...base, ...evidence });
    assert.notEqual(result.status, 0);
  }
});
