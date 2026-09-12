const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('#1883 already-merged recovery cannot post-facto manufacture Release provenance', () => {
  const workflow = read('.github/workflows/autopilot-already-merged-audit-convergence.yml');
  assert.match(workflow, /RELEASE_PROVENANCE_MISSING/);
  assert.doesNotMatch(workflow, /Already-merged deterministic Audit provenance PASS/);
  assert.doesNotMatch(workflow, /workflows\/wo-0059-actual-paper-runtime\.yml\/dispatches/);
  assert.doesNotMatch(workflow, /autopilot-cloudflare-promote\.yml\/dispatches/);
  assert.doesNotMatch(workflow, /android-stable-release-trigger\.yml\/dispatches/);
  assert.doesNotMatch(workflow, /windows-desktop-stable-release\.yml\/dispatches/);
});

test('deployment receipt attests runtime convergence but never Release completion', () => {
  const workflow = read('.github/workflows/deployment-convergence-receipt.yml');
  assert.match(workflow, /CONVERGENCE_STATUS=CONVERGENCE_INCOMPLETE/);
  assert.match(workflow, /CONVERGENCE_STATUS=CONVERGED/);
  assert.match(workflow, /RELEASE_STATUS=RELEASE_PROVENANCE_UNKNOWN/);
  assert.doesNotMatch(workflow, /RELEASE_STATUS=RELEASE_COMPLETE/);
  assert.doesNotMatch(workflow, /STATUS=PASS/);
});

test('deployment watchdog stays a runtime repair loop and cannot assert Release authority', () => {
  const workflow = read('.github/workflows/deployment-convergence-watchdog.yml');
  assert.match(workflow, /Deployment Convergence Receipt/);
  assert.doesNotMatch(workflow, /RELEASE_COMPLETE/);
  assert.doesNotMatch(workflow, /nusa\/release-authorized/);
  assert.doesNotMatch(workflow, /DETERMINISTIC_AUDIT_PASS/);
});


test('RELEASE_COMPLETE has one production classifier and outer workflow success cannot mint it elsewhere', () => {
  const productionRoots = ['apps/autopilot/src', '.github/workflows'];
  const offenders = [];
  const walk = (relative) => {
    const absolute = path.join(root, relative);
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (/\.(?:ts|ya?ml)$/i.test(entry.name) && !/\.test\.ts$/i.test(entry.name)) {
        const text = read(child);
        const canMint = /(?:return\s+[\"']RELEASE_COMPLETE[\"']|RELEASE_STATUS\s*=\s*RELEASE_COMPLETE|release_status\s*:\s*[\"']?RELEASE_COMPLETE)/.test(text);
        if (canMint && child !== 'apps/autopilot/src/releaseCompletion.ts') offenders.push(child);
      }
    }
  };
  productionRoots.forEach(walk);
  assert.deepEqual(offenders, []);
  const evaluator = read('apps/autopilot/src/releaseCompletion.ts');
  assert.match(evaluator, /TrustedReleaseAuthorityPolicy/);
  assert.doesNotMatch(evaluator, /authorization\.expectedAppId/);
});
