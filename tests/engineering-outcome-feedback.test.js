import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = path.resolve('scripts/evaluate-engineering-outcome.mjs');

function run(overrides = {}) {
  const input = {
    schemaVersion: 1,
    metric: 'ci_p95_ms',
    direction: 'LOWER_IS_BETTER',
    neutralTolerance: 5,
    baseline: { source: 'GITHUB', evidenceRef: 'run:100', value: 100 },
    postMerge: { source: 'GITHUB', evidenceRef: 'run:101', value: 80 },
    liveAuthority: 'NONE',
    productionMutationAllowed: false,
    aiAuthority: 'ZERO_AUTHORITY',
    ...overrides,
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nusa-outcome-'));
  const file = path.join(dir, 'input.json');
  fs.writeFileSync(file, JSON.stringify(input));
  const result = spawnSync(process.execPath, [script, file], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
}

function output(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('classifies verified improvement only with complete GitHub evidence', () => {
  const result = output(run());
  assert.equal(result.classification, 'VERIFIED_IMPROVEMENT');
  assert.equal(result.recommendation, 'KEEP');
  assert.equal(result.evidenceComplete, true);
  assert.equal(result.delta, -20);
});

test('classifies regression and requires rework or rollback', () => {
  const result = output(run({ postMerge: { source: 'GITHUB', evidenceRef: 'run:102', value: 120 } }));
  assert.equal(result.classification, 'REGRESSION');
  assert.equal(result.recommendation, 'REWORK_OR_ROLLBACK');
});

test('classifies movement inside tolerance as neutral', () => {
  const result = output(run({ postMerge: { source: 'GITHUB', evidenceRef: 'run:103', value: 97 } }));
  assert.equal(result.classification, 'NEUTRAL');
});

test('missing or non-GitHub evidence cannot become verified', () => {
  const result = output(run({ baseline: { source: 'UNKNOWN', evidenceRef: '', value: 100 } }));
  assert.equal(result.classification, 'INSUFFICIENT');
  assert.equal(result.recommendation, 'COLLECT_EVIDENCE');
  assert.equal(result.evidenceComplete, false);
  assert.equal(result.delta, null);
});

test('supports higher-is-better metrics', () => {
  const result = output(run({
    metric: 'verified_value_per_hour',
    direction: 'HIGHER_IS_BETTER',
    baseline: { source: 'GITHUB', evidenceRef: 'pr:1', value: 2 },
    postMerge: { source: 'GITHUB', evidenceRef: 'pr:2', value: 3 },
    neutralTolerance: 0,
  }));
  assert.equal(result.classification, 'VERIFIED_IMPROVEMENT');
});

test('fails closed on authority drift', () => {
  const result = run({ liveAuthority: 'LIVE' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /outcome-evidence-live-authority-drift/);
});
