const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('shared coordinator owns durable exact-bound HOLD storage', () => {
  const source = read('apps/autopilot/src/executionCoordinator.ts');
  assert.match(source, /control-plane-hold-v1/);
  assert.match(source, /applyPersistentControlPlaneHold/);
  assert.match(source, /readPersistentControlPlaneHold/);
  assert.match(source, /clearPersistentControlPlaneHold/);
  assert.match(source, /CONTROL_PLANE_HOLD_REPLAY_AFTER_CLEAR/);
});

test('autonomous publisher cannot create a Ready-for-review PR', () => {
  const source = read('apps/autopilot/src/githubValidatedPatchPublisher.ts');
  assert.match(source, /draft:\s*true/);
  assert.doesNotMatch(source, /draft:\s*false/);
});

test('global freeze persists HOLD before a Ready event can advance', () => {
  const source = read('apps/autopilot/src/index.ts');
  const persist = source.indexOf('await applyPersistentControlPlaneHold');
  const ready = source.indexOf('dispatch.reason === "pull-request:ready_for_review"');
  assert.ok(persist >= 0 && ready > persist);
  assert.match(source, /GLOBAL_RELEASE_FREEZE/);
  assert.match(source, /CONTROL_PLANE_HOLD_ACTIVE/);
  assert.match(source, /NUSA_GLOBAL_RELEASE_FREEZE/);
});

test('Audit fails closed under global freeze or active exact HOLD', () => {
  const source = read('apps/autopilot/src/worker.ts');
  assert.match(source, /GLOBAL_RELEASE_FREEZE_ACTIVE/);
  assert.match(source, /readPersistentControlPlaneHold/);
  assert.match(source, /persistedHold\?\.state === "ACTIVE"/);
  assert.match(source, /CONTROL_PLANE_HOLD_ACTIVE/);
});
