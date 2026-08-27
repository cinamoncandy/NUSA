import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = path.resolve('scripts/verify-autopilot-runner-progress-github.mjs');
const sha = 'a'.repeat(40);
const mergeSha = 'b'.repeat(40);
const required = [
  'CI',
  'Restricted LIVE Activation Rehearsal',
  'Restricted LIVE Transport Credential Readiness',
  'Restricted LIVE Capability Surface Guard',
  'Actual PAPER Public-Market Runtime Evidence',
  'Read-only Broker Credential Integration',
];

function evidence(overrides = {}) {
  return {
    schemaVersion: 1,
    status: 'CI_GREEN',
    repository: 'cinamoncandy/NUSA',
    requested_head_sha: 'c'.repeat(40),
    request_id: 'req-1',
    idempotency_key: 'd'.repeat(64),
    branch: 'autopilot/test',
    pr_number: 42,
    pr_url: 'https://github.com/cinamoncandy/NUSA/pull/42',
    produced_commit_sha: sha,
    exact_head_ci_state: 'GREEN',
    exact_head_ci_sha: sha,
    exact_head_verified: true,
    live_authority: 'NONE',
    production_mutation_allowed: false,
    ai_authority: 'ZERO_AUTHORITY',
    direct_main_push: false,
    requires_pull_request: true,
    merge_only_after_exact_head_green: true,
    ...overrides,
  };
}

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function run(input, apiBase) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nusa-runner-evidence-'));
  const file = path.join(dir, 'evidence.json');
  fs.writeFileSync(file, JSON.stringify(input));
  const result = spawnSync(process.execPath, [script, file], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_TOKEN: 'test-token', NUSA_GITHUB_API_BASE_URL: apiBase },
  });
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
}

function apiFixture({ workflows = required, merged = false, mergeCommitSha = mergeSha } = {}) {
  return (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/repos/cinamoncandy/NUSA/git/ref/heads/autopilot/test')) {
      res.end(JSON.stringify({ object: { sha } }));
      return;
    }
    if (req.url === '/repos/cinamoncandy/NUSA/pulls/42') {
      res.end(JSON.stringify({
        state: merged ? 'closed' : 'open',
        merged_at: merged ? '2026-08-28T00:00:00Z' : null,
        merge_commit_sha: mergeCommitSha,
        base: { ref: 'main' },
        head: { ref: 'autopilot/test', sha, repo: { full_name: 'cinamoncandy/NUSA' } },
      }));
      return;
    }
    if (req.url.startsWith(`/repos/cinamoncandy/NUSA/actions/runs?head_sha=${sha}`)) {
      res.end(JSON.stringify({
        workflow_runs: workflows.map((name) => ({ name, head_sha: sha, status: 'completed', conclusion: 'success' })),
      }));
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  };
}

test('accepts CI_GREEN only when exact PR head and all required workflows are green', async () => {
  await withServer(apiFixture(), async (apiBase) => {
    const result = run(evidence(), apiBase);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.pullRequestVerified, true);
    assert.equal(output.exactHeadCiVerified, true);
    assert.equal(output.mergeVerified, false);
  });
});

test('rejects forged CI_GREEN when any required workflow is missing', async () => {
  await withServer(apiFixture({ workflows: required.slice(0, -1) }), async (apiBase) => {
    const result = run(evidence(), apiBase);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /github-evidence-required-workflow-not-green:Read-only Broker Credential Integration/);
  });
});

test('rejects MERGED when GitHub merge SHA disagrees with runner claim', async () => {
  await withServer(apiFixture({ merged: true, mergeCommitSha: 'e'.repeat(40) }), async (apiBase) => {
    const result = run(evidence({ status: 'MERGED', merge_sha: mergeSha }), apiBase);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /github-evidence-merge-sha-mismatch/);
  });
});
