const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "autopilot-cloudflare-deploy.yml"), "utf8");
const readiness = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "cloudflare-deployment-readiness.yml"), "utf8");

test("Cloudflare deployment recovers after a CI-only repair merge", () => {
  assert.match(workflow, /workflow_run:\s*\n\s*workflows: \[CI\]/);
  assert.match(workflow, /github\.event\.workflow_run\.head_sha/);
  assert.match(workflow, /Wait for exact-head CI success before deploying/);
  assert.match(workflow, /Verify exact current main revision/);
  assert.match(workflow, /deploymentRevision/);
  assert.match(workflow, /CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /liveAuthority=NONE/);
  assert.match(workflow, /productionMutationAllowed=false/);
  assert.match(workflow, /AI authority=ZERO_AUTHORITY/);
});

test("deployment is Worker-only and has no paid Cloudflare Containers rollout", () => {
  assert.match(workflow, /Workers Free-compatible runtime/);
  assert.match(workflow, /wrangler@4\.127\.1 deploy/);
  assert.match(workflow, /--var "NUSA_DEPLOYMENT_REVISION:\$\{HEAD_SHA\}"/);
  assert.doesNotMatch(workflow, /Determine Container rollout mode/);
  assert.doesNotMatch(workflow, /CONTAINERS_ROLLOUT/);
  assert.doesNotMatch(workflow, /--containers-rollout/);
  assert.doesNotMatch(workflow, /containers list/);
});

test("deployment authenticates read-only before attempting Cloudflare mutation", () => {
  const preflightIndex = workflow.indexOf("Verify Cloudflare deployment credentials and account access");
  const deployIndex = workflow.indexOf("Deploy exact CI-verified revision to Cloudflare Workers Free-compatible runtime");
  assert.ok(preflightIndex >= 0);
  assert.ok(deployIndex > preflightIndex);
  assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(workflow, /wrangler@4\.127\.1 whoami/);
  assert.match(workflow, /Cloudflare authentication\/account preflight failed/);
  assert.match(workflow, /Cloudflare token\/account preflight passed/);
});

test("daily read-only readiness guard detects broken Cloudflare credentials before deployment day", () => {
  assert.match(readiness, /schedule:/);
  assert.match(readiness, /cron: "30 0 \* \* \*"/);
  assert.match(readiness, /workflow_dispatch:/);
  assert.match(readiness, /permissions:\s*\n\s*contents: read/);
  assert.doesNotMatch(readiness, /contents: write/);
  assert.match(readiness, /wrangler@4\.127\.1 whoami/);
  assert.match(readiness, /CLOUDFLARE_API_TOKEN/);
  assert.match(readiness, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(readiness, /deploymentRevision/);
  assert.match(readiness, /liveAuthority == "NONE"/);
  assert.match(readiness, /productionMutationAllowed == false/);
  assert.doesNotMatch(readiness, /wrangler@4\.127\.1 deploy/);
});

test("deployment accepts a direct workflow_dispatch with exact head_sha for GITHUB_TOKEN-dispatched CI runs", () => {
  assert.match(workflow, /workflow_dispatch:\s*\n\s*inputs:\s*\n\s*head_sha:/);
  assert.match(workflow, /required: true/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /inputs\.head_sha/);
});

test("deployment workflow remains read-only toward GitHub contents and cannot mutate the repository", () => {
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.doesNotMatch(workflow, /contents: write/);
  assert.match(workflow, /Skipping stale push/);
  assert.match(workflow, /HUMAN_ONLY blocker/);
  assert.match(workflow, /Failing closed/);
});

test("successful deploy directly dispatches Runtime Proof instead of relying on workflow_run chaining", () => {
  assert.match(workflow, /permissions:[^]*actions: write/);
  assert.match(workflow, /Dispatch Runtime Proof directly for fresh observability/);
  assert.match(workflow, /does not fire workflow_run listeners/);
  assert.match(workflow, /actions\/workflows\/autopilot-cloudflare-runtime-proof\.yml\/dispatches/);
  assert.match(workflow, /-f ref=main/);
  const dispatchIndex = workflow.indexOf("Dispatch Runtime Proof directly");
  assert.ok(dispatchIndex > 0);
  assert.match(workflow.slice(dispatchIndex, dispatchIndex + 400), /if: steps\.revision\.outputs\.current == 'true'/);
});
