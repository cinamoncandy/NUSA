const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

test('Restricted LIVE governance validator passes', () => {
  const result = spawnSync(process.execPath, ['scripts/validate-live-governance-state.js'], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
