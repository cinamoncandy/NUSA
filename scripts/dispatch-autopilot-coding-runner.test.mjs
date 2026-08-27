import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = path.resolve('scripts/dispatch-autopilot-coding-runner.mjs');
const baseRequest = {
  schemaVersion: 1,
  kind: 'REPOSITORY_AUTOPILOT',
  repository: 'cinamoncandy/NUSA',
  head_sha: 'a'.repeat(40),
  workflow_run_id: null,
  live_authority: 'NONE',
  production_mutation_allowed: false,
  ai_authority: 'ZERO_AUTHORITY',
};

function run(request, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nusa-runner-dispatch-'));
  const requestPath = path.join(dir, 'request.json');
  const receiptPath = path.join(dir, 'receipt.json');
  fs.writeFileSync(requestPath, JSON.stringify(request));
  const result = spawnSync(process.execPath, [script, requestPath, receiptPath], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, NUSA_CODING_RUNNER_URL: '', NUSA_CODING_RUNNER_TOKEN: '', ...env },
  });
  return { result, receiptPath };
}

{
  const { result, receiptPath } = run(baseRequest);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  assert.equal(receipt.status, 'NOT_CONNECTED');
  assert.equal(receipt.reason, 'runner-secret-not-configured');
  assert.equal(receipt.repository, 'cinamoncandy/NUSA');
  assert.equal(receipt.head_sha, baseRequest.head_sha);
}

{
  const { result, receiptPath } = run(baseRequest, {
    NUSA_CODING_RUNNER_URL: 'http://runner.invalid/execute',
    NUSA_CODING_RUNNER_TOKEN: 'test-token',
  });
  assert.notEqual(result.status, 0, 'non-HTTPS runner must fail closed');
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  assert.equal(receipt.status, 'REJECTED');
  assert.equal(receipt.reason, 'runner-url-must-use-https');
}

{
  const { result, receiptPath } = run({ ...baseRequest, repository: 'evil/repo' }, {
    NUSA_CODING_RUNNER_URL: 'https://runner.invalid/execute',
    NUSA_CODING_RUNNER_TOKEN: 'test-token',
  });
  assert.notEqual(result.status, 0, 'repository drift must fail closed');
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  assert.equal(receipt.status, 'REJECTED');
  assert.equal(receipt.reason, 'repository-not-allowed');
}

console.log('PASS dispatch-autopilot-coding-runner');
