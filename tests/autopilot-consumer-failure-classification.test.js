const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Linter } = require('eslint');

const source = fs.readFileSync('scripts/autopilot-dispatch-retry.js', 'utf8');

test('autopilot consumer has no undefined runtime identifiers', () => {
  const linter = new Linter({ configType: 'flat' });
  const messages = linter.verify(source, [{
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        Buffer: 'readonly',
        URL: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        module: 'readonly',
        process: 'readonly',
        require: 'readonly',
        setTimeout: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
    },
  }]);
  assert.deepEqual(
    messages.filter((message) => message.ruleId === 'no-undef'),
    [],
    'autopilot consumer must fail CI on undefined runtime identifiers',
  );
});

test('autopilot consumer timestamps main execution before failure classification', () => {
  assert.match(
    source,
    /async function main\(\) \{\s*const startedAt = Date\.now\(\);\s*let request;\s*try \{\s*request = readDispatchRequest\(\);/s,
  );
  assert.match(source, /attemptRecord\(\{[\s\S]*?startedAt,[\s\S]*?decision: safeProposalFailure \? "NO_ACTION" : "FAILED_CLOSED"/);
});

test('top-level consumer rejection is not silently swallowed', () => {
  assert.match(
    source,
    /main\(\)\.catch\(\(error\) => \{\s*console\.error\(error instanceof Error \? error\.message : "AUTOPILOT_GITHUB_RUNNER_UNHANDLED"\);\s*process\.exitCode = 1;/s,
  );
});
