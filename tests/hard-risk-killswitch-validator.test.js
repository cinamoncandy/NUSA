const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

test('hard risk and kill switch validator passes', () => {
  const result = spawnSync(process.execPath, ['scripts/validate-hard-risk-killswitch.js'], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
