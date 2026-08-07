const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validate, REGISTRY, POLICY, READINESS } = require('../scripts/validate-restricted-live-capability-surface.js');

function fixture(mutator) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nusa-live-surface-'));
  for (const file of [REGISTRY, POLICY, READINESS]) {
    const src = path.join(process.cwd(), file);
    const dst = path.join(root, file);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  if (mutator) mutator(root);
  return root;
}
function read(root, file) { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); }
function write(root, file, value) { fs.writeFileSync(path.join(root, file), JSON.stringify(value, null, 2)); }

test('baseline capability surface passes', () => assert.equal(validate(fixture()).pass, true));
for (const permission of ['order:submit','order:cancel','broker:execute','transport:dial','credential:resolve','cash:mutate','position:mutate']) {
  test(`prohibited permission fails closed: ${permission}`, () => {
    const root = fixture((dir) => {
      const registry = read(dir, REGISTRY);
      registry.contracts[0].permissions.push(permission);
      write(dir, REGISTRY, registry);
    });
    const result = validate(root);
    assert.equal(result.pass, false);
    assert.ok(result.failures.some((x) => x.includes('PROHIBITED_LIVE_PERMISSION')));
  });
}
test('connected execution transport fails closed', () => {
  const root = fixture((dir) => { const v = read(dir, READINESS); v.executionTransportConnected = true; write(dir, READINESS, v); });
  assert.equal(validate(root).pass, false);
});
test('credential resolution enabled fails closed', () => {
  const root = fixture((dir) => { const v = read(dir, READINESS); v.credentials.resolutionEnabled = true; write(dir, READINESS, v); });
  assert.equal(validate(root).pass, false);
});
test('any mutation counter fails closed', () => {
  const root = fixture((dir) => { const v = read(dir, READINESS); v.mutationCounters.orders = 1; write(dir, READINESS, v); });
  assert.equal(validate(root).pass, false);
});
