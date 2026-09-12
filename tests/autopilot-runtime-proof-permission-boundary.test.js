const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/autopilot-cloudflare-runtime-proof.yml'), 'utf8');
const runtimeStart = workflow.indexOf('  runtime-proof:');
const dispatchStart = workflow.indexOf('  credential-preflight-dispatch:');
const runtimeProof = workflow.slice(runtimeStart, dispatchStart);
const trustedDispatch = workflow.slice(dispatchStart);

test('#1860 PR-executed runtime proof has read-only token authority', () => {
  assert.ok(runtimeStart >= 0 && dispatchStart > runtimeStart);
  assert.match(workflow, /pull_request:/);
  assert.match(runtimeProof, /permissions:\r?\n\s+contents: read/);
  assert.doesNotMatch(runtimeProof, /actions: write/);
  assert.match(runtimeProof, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(runtimeProof, /node scripts\/verify-autopilot-cloudflare-runtime\.mjs/);
  assert.doesNotMatch(runtimeProof, /actions\/workflows\/autopilot-cloudflare-credential-preflight\.yml\/dispatches/);
});

test('#1860 Actions-write token is isolated in trusted no-checkout dispatch job', () => {
  assert.match(trustedDispatch, /permissions:\r?\n\s+contents: read\r?\n\s+actions: write/);
  assert.match(trustedDispatch, /github\.event_name != 'pull_request'/);
  assert.match(trustedDispatch, /github\.event_name != 'workflow_dispatch' \|\| github\.ref == 'refs\/heads\/main'/);
  assert.match(trustedDispatch, /test \"\$SOURCE_BRANCH\" = 'main'/);
  assert.match(trustedDispatch, /test \"\$SOURCE_REPOSITORY\" = \"\$GITHUB_REPOSITORY\"/);
  assert.match(trustedDispatch, /branches\/main/);
  assert.match(trustedDispatch, /actions\/workflows\/autopilot-cloudflare-credential-preflight\.yml\/dispatches/);
  assert.doesNotMatch(trustedDispatch, /actions\/checkout@/);
  assert.doesNotMatch(trustedDispatch, /verify-autopilot-cloudflare-runtime\.mjs/);
});

test('#1860 workflow has exactly one credential-preflight dispatch mutation', () => {
  const mutations = workflow.match(/actions\/workflows\/autopilot-cloudflare-credential-preflight\.yml\/dispatches/g) ?? [];
  assert.equal(mutations.length, 1);
});
