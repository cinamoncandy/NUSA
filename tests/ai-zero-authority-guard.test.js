const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('AI zero-authority architecture guard passes', () => {
  const root = path.resolve(__dirname, '..');
  const output = execFileSync(process.execPath, ['scripts/validate-ai-zero-authority.js'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.match(output, /AI_ZERO_AUTHORITY_GUARD PASS/);
});

test('AI authority invariants are explicit in orchestrator output', () => {
  const orchestrator = require('node:fs').readFileSync(
    path.join(__dirname, '..', 'apps', 'cloud', 'src', 'ai', 'multiAgentOrchestrator.ts'),
    'utf8',
  );
  assert.match(orchestrator, /realOrderAuthority:\s*false/);
  assert.match(orchestrator, /realTransferAuthority:\s*false/);
  assert.match(orchestrator, /productionMutationAllowed:\s*false/);
  assert.match(orchestrator, /liveAuthority:\s*['"]NONE['"]/);
});
