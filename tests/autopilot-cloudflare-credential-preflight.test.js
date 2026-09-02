const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflow = fs.readFileSync(
  path.resolve('.github/workflows/autopilot-cloudflare-credential-preflight.yml'),
  'utf8',
).replace(/\r\n/g, '\n');

test('Cloudflare credential preflight never executes untrusted PR head code', () => {
  assert.match(workflow, /pull_request_target:/);
  assert.match(workflow, /Resolve current protected main/);
  assert.match(workflow, /Checkout trusted current main only/);
  assert.match(workflow, /ref: \$\{\{ steps\.main\.outputs\.sha \}\}/);
  assert.match(workflow, /PR head is never checked out/);
  assert.doesNotMatch(workflow, /github\.event\.pull_request\.head\.sha/);
  assert.doesNotMatch(workflow, /github\.head_ref/);
});

test('preflight reuses existing runtime cadence instead of adding a scheduler', () => {
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /Autopilot Cloudflare Deploy/);
  assert.match(workflow, /Autopilot Cloudflare Runtime Proof/);
  assert.doesNotMatch(workflow, /^\s*schedule:/m);
  assert.doesNotMatch(workflow, /cron:/);
});

test('preflight treats token self-verify as informational, not fail-closed', () => {
  assert.match(workflow, /user\/tokens\/verify/);
  assert.match(workflow, /informational only/);
  assert.match(workflow, /payload\.result\?\.status === 'active'/);
  assert.match(workflow, /catch \{/);
  assert.match(workflow, /non-JSON response/);
  const tokenVerifyStep = workflow.slice(workflow.indexOf('user/tokens/verify') - 400, workflow.indexOf('user/tokens/verify') + 80);
  assert.doesNotMatch(tokenVerifyStep, /--fail-with-body/);
});

test('preflight verifies the free-tier Worker has no paid Container or Sandbox binding', () => {
  assert.match(workflow, /accounts\/\$CLOUDFLARE_ACCOUNT_ID/);
  assert.match(workflow, /observed !== expected/);
  assert.match(workflow, /wrangler@4\.127\.1 whoami/);
  assert.match(workflow, /Verify free-tier Worker configuration has no paid Container binding/);
  assert.match(workflow, /Array\.isArray\(config\.containers\)/);
  assert.match(workflow, /binding\?\.name === 'Sandbox'/);
  assert.match(workflow, /Workers Free-compatible configuration verified/);
  assert.doesNotMatch(workflow, /wrangler@4\.127\.1 containers list/);
  assert.doesNotMatch(workflow, /--containers-rollout/);
  assert.doesNotMatch(workflow, /wrangler@4\.127\.1 deploy/);
});

test('preflight waits boundedly for exact-main deploy and live Worker revision', () => {
  assert.match(workflow, /actions\/runs\?head_sha=\$CURRENT_MAIN&status=completed&per_page=100/);
  assert.match(workflow, /Autopilot Cloudflare Deploy/);
  assert.match(workflow, /autopilot-cloudflare-deploy\.yml/);
  assert.match(workflow, /for attempt in \$\(seq 1 18\); do/);
  assert.match(workflow, /waiting for exact-main deploy visibility\/success/);
  assert.match(workflow, /waiting for Worker deployment revision/);
  assert.match(workflow, /if \[\[ "\$attempt" -lt 18 \]\]; then sleep 10; fi/);
  assert.match(workflow, /DEPLOY_CONCLUSION.*success/s);
  assert.match(workflow, /deploymentRevision mismatch/);
  assert.match(workflow, /health\.liveAuthority !== 'NONE'/);
  assert.match(workflow, /health\.productionMutationAllowed !== false/);
  assert.match(workflow, /health\.aiAuthority !== 'ZERO_AUTHORITY'/);
});

test('failed preflight freezes existing Release through canonical P0 serialization', () => {
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /if: \$\{\{ failure\(\) \}\}/);
  assert.match(workflow, /P0: Cloudflare deployment credential\/runtime baseline unhealthy/);
  assert.match(workflow, /Refs #903/);
  assert.match(workflow, /nusa-cloudflare-credential-preflight-p0/);
  assert.doesNotMatch(workflow, /pull-requests: write/);
  assert.doesNotMatch(workflow, /contents: write/);
});

test('pull_request_target can never clear the canonical P0 freeze', () => {
  assert.match(workflow, /if: \$\{\{ success\(\) && github\.event_name != 'pull_request_target' \}\}/);
  assert.match(workflow, /state='closed'/);
});

test('preflight preserves fail-closed authority invariants', () => {
  assert.match(workflow, /BLOCKED_HUMAN/);
  assert.match(workflow, /liveAuthority=NONE/);
  assert.match(workflow, /productionMutationAllowed=false/);
  assert.match(workflow, /AI authority=ZERO_AUTHORITY/);
});
