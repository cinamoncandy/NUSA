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

test('post-#1803 deployment explicitly clears the global release freeze while code defaults fail closed', () => {
  const source = read('apps/autopilot/src/index.ts');
  const wrangler = read('apps/autopilot/wrangler.jsonc');
  assert.match(source, /NUSA_GLOBAL_RELEASE_FREEZE\?\.trim\(\)\.toLowerCase\(\) !== "false"/);
  assert.match(wrangler, /"NUSA_GLOBAL_RELEASE_FREEZE"\s*:\s*"false"/);
});

test('Audit fails closed under global freeze or active exact HOLD', () => {
  const source = read('apps/autopilot/src/worker.ts');
  assert.match(source, /GLOBAL_RELEASE_FREEZE_ACTIVE/);
  assert.match(source, /readPersistentControlPlaneHold/);
  assert.match(source, /persistedHold\?\.state === "ACTIVE"/);
  assert.match(source, /CONTROL_PLANE_HOLD_ACTIVE/);
});

test('Release checks the same durable exact-bound HOLD before authorization and merge', () => {
  const worker = read('apps/autopilot/src/worker.ts');
  const release = read('.github/workflows/autopilot-deterministic-audit-release.yml');
  assert.match(worker, /\/control-plane\/release-check/);
  assert.match(worker, /RELEASE_CONTROL_CLEAR/);
  assert.match(worker, /RELEASE_CONTROL_FAILED_CLOSED/);
  assert.match(worker, /RELEASE_CONTROL_UNAUTHORIZED/);
  assert.match(worker, /GLOBAL_RELEASE_FREEZE_ACTIVE/);
  assert.match(worker, /CONTROL_PLANE_HOLD_READ_FAILED/);
  assert.match(worker, /CONTROL_PLANE_HOLD_ACTIVE/);
  assert.match(worker, /verifyGithubReleaseControlOidcToken/);
  assert.match(worker, /readPersistentControlPlaneHold/);
  assert.match(worker, /repository: request\.repository/);
  assert.match(worker, /headSha: request\.headSha\.toLowerCase\(\)/);
  assert.match(worker, /baseSha: request\.baseSha\.toLowerCase\(\)/);
  assert.match(worker, /liveAuthority:\s*"NONE"/);
  assert.match(worker, /productionMutationAllowed:\s*false/);
  assert.match(worker, /aiAuthority:\s*"ZERO_AUTHORITY"/);
  assert.match(release, /id-token:\s*write/);
  assert.match(release, /ACTIONS_ID_TOKEN_REQUEST_URL/);
  assert.match(release, /audience.*nusa-autopilot/);
  assert.match(release, /\/control-plane\/release-check/g);
  assert.match(release, /RELEASE_CONTROL_CLEAR/);
  assert.match(release, /prNumber: Number\(process\.env\.PR_NUMBER\)/);
  assert.match(release, /headSha: process\.env\.EXPECTED_HEAD/);
  assert.match(release, /baseSha: process\.env\.AUDITED_BASE/);
  const firstCheck = release.indexOf('- name: Verify durable control-plane Release clearance');
  const mint = release.indexOf('- name: Mint dedicated release authority token');
  const publish = release.indexOf('- name: Publish exact-head release authorization');
  const secondCheck = release.indexOf('- name: Re-verify durable control-plane clearance before merge');
  const merge = release.indexOf('- name: Canonical expected-head merge');
  const revoke = release.indexOf('- name: Revoke authorization if exact-head merge did not complete');
  assert.ok(firstCheck >= 0 && firstCheck < mint && mint < publish && publish < secondCheck && secondCheck < merge && merge < revoke);
  assert.match(release, /failure\(\) && steps\.authorize\.outputs\.published == 'true'/);
  assert.match(release, /state=failure/);
});
