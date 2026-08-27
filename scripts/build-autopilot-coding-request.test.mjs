import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = path.resolve('scripts/build-autopilot-coding-request.mjs');

function run(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nusa-autopilot-'));
  const eventPath = path.join(dir, 'event.json');
  fs.writeFileSync(eventPath, JSON.stringify({ client_payload: payload }));
  return spawnSync(process.execPath, [script, eventPath], { cwd: dir, encoding: 'utf8' });
}

const base = {
  kind: 'REPOSITORY_AUTOPILOT',
  repository: 'cinamoncandy/NUSA',
  head_sha: 'a'.repeat(40),
  workflow_run_id: null,
  reason: 'continue-from:main_push',
  live_authority: 'NONE',
  production_mutation_allowed: false,
  ai_authority: 'ZERO_AUTHORITY',
};

{
  const result = run(base);
  assert.equal(result.status, 0, result.stderr);
  const request = JSON.parse(result.stdout.trim());
  assert.equal(request.requestedAction, 'DISCOVER_AND_IMPLEMENT_HIGHEST_VALUE_SAFE_REPOSITORY_WORK');
  assert.equal(request.productionMutationAllowed, false);
  assert.equal(request.aiAuthority, 'ZERO_AUTHORITY');
}

for (const [field, value] of [
  ['repository', 'evil/repo'],
  ['head_sha', 'not-a-sha'],
  ['live_authority', 'ENABLED'],
  ['production_mutation_allowed', true],
  ['ai_authority', 'SELF_AUTHORITY'],
]) {
  const result = run({ ...base, [field]: value });
  assert.notEqual(result.status, 0, `${field} drift must fail closed`);
}

{
  const result = run({ ...base, kind: 'CI_RECOVERY' });
  assert.equal(result.status, 0, result.stderr);
  const request = JSON.parse(result.stdout.trim());
  assert.equal(request.requestedAction, 'CLASSIFY_AND_REPAIR_CI_FAILURE');
}

console.log('PASS build-autopilot-coding-request');
