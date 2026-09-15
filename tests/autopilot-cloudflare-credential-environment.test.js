const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'autopilot-cloudflare-credential-preflight.yml'), 'utf8');
const preflightStart = workflow.indexOf('  preflight:');
const preflight = workflow.slice(preflightStart);

function step(name) {
  const start = preflight.indexOf(`      - name: ${name}`);
  assert.ok(start >= 0, `missing step: ${name}`);
  const next = preflight.indexOf('\n      - name:', start + 1);
  const nextUses = preflight.indexOf('\n      - uses:', start + 1);
  const ends = [next, nextUses].filter((value) => value > start);
  return preflight.slice(start, ends.length ? Math.min(...ends) : preflight.length);
}

test('#1862 credential preflight is gated by its dedicated deployment environment', () => {
  assert.ok(preflightStart >= 0);
  assert.match(preflight, /environment:\s*nusa-cloudflare-deployment/);
  const header = preflight.slice(0, preflight.indexOf('    steps:'));
  assert.doesNotMatch(header, /CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID/);
});

test('#1862 Cloudflare credentials exist only on the four steps that require them', () => {
  const credentialSteps = [
    'Validate Cloudflare credential inputs',
    'Check Cloudflare API token self-verification (informational only)',
    'Verify configured Cloudflare account is accessible',
    'Verify Wrangler account authentication',
  ];
  for (const name of credentialSteps) assert.match(step(name), /secrets\.CLOUDFLARE_/);

  const occurrences = workflow.match(/secrets\.CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)/g) ?? [];
  assert.equal(occurrences.length, 7);
  assert.doesNotMatch(step('Install locked dependencies'), /CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID/);
  assert.doesNotMatch(step('Require successful exact-main Cloudflare deployment'), /secrets\.CLOUDFLARE_/);
  assert.doesNotMatch(step('Open or refresh canonical P0 Release blocker on failure'), /secrets\.CLOUDFLARE_/);
});

test('#1862 trusted-main and fail-closed authority boundaries remain intact', () => {
  assert.match(workflow, /pull_request_target:/);
  assert.match(workflow, /Checkout trusted current main only/);
  assert.match(workflow, /ref: \$\{\{ steps\.main\.outputs\.sha \}\}/);
  assert.doesNotMatch(workflow, /github\.event\.pull_request\.head|pull_request\.head\.sha/);
  assert.match(workflow, /liveAuthority=NONE/);
  assert.match(workflow, /productionMutationAllowed=false/);
  assert.match(workflow, /AI authority=ZERO_AUTHORITY/);
});
