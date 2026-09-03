const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('scripts/autopilot-dispatch-retry.js', 'utf8');

test('autopilot consumer timestamps main execution before failure classification', () => {
  assert.match(
    source,
    /async function main\(\) \{\s*const request = readDispatchRequest\(\);\s*const startedAt = Date\.now\(\);/s,
  );
  assert.match(source, /attemptRecord\(\{[\s\S]*?startedAt,[\s\S]*?decision: safeProposalFailure \? "NO_ACTION" : "FAILED_CLOSED"/);
});

test('top-level consumer rejection is not silently swallowed', () => {
  assert.match(
    source,
    /main\(\)\.catch\(\(error\) => \{\s*console\.error\(error instanceof Error \? error\.message : "AUTOPILOT_GITHUB_RUNNER_UNHANDLED"\);\s*process\.exitCode = 1;/s,
  );
});
