const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const wranglerPath = path.join(__dirname, '..', 'apps', 'autopilot', 'wrangler.jsonc');
const config = JSON.parse(fs.readFileSync(wranglerPath, 'utf8').replace(/^\s*\/\/.*$/gm, ''));

test('retired Sandbox Durable Object remains tombstoned and unbound', () => {
  const bindings = config.durable_objects?.bindings || [];
  assert.equal(bindings.some((binding) => binding?.name === 'Sandbox' || binding?.class_name === 'Sandbox'), false);
  assert.deepEqual(config.exports?.Sandbox, {
    type: 'durable-object',
    state: 'deleted',
  });
});
