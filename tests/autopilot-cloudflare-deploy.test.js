const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "autopilot-cloudflare-deploy.yml"), "utf8");
const readiness = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "cloudflare-deployment-readiness.yml"), "utf8");

test("Cloudflare deployment recovers after a CI-only repair merge", () => {
  assert.match(workflow, /workflow_run:\s*\n\s*workflows: \[CI\]/);
  assert.match(workflow, /github\.event\.workflow_run\.head_sha/);
  assert.match(workflow, /Determine whether Worker deployment is needed/);
  assert.match(workflow, /deploymentRevision/);
  assert.match(workflow, /Worker and Container rollout stay atomically aligned/);
  assert.doesNotMatch(workflow, /git diff --quiet .*apps\/autopilot/);
  assert.match(workflow, /CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /liveAuthority=NONE/);
  assert.match(workflow, /productionMutationAllowed=false/);
  assert.match(workflow, /AI authority=ZERO_AUTHORITY/);
});

test("Container rollout is immediate only for container-definition changes and otherwise reuses the deployed image", () => {
  assert.match(workflow, /fetch-depth: 2/);
  assert.match(workflow, /Determine Container rollout mode/);
  assert.match(workflow, /git rev-parse HEAD\^/);
  assert.match(workflow, /apps\/autopilot\/Dockerfile\|apps\/autopilot\/wrangler\\\.jsonc/);
  assert.match(workflow, /rollout=immediate/);
  assert.match(workflow, /rollout=none/);
  assert.match(workflow, /Container definition unchanged; reusing the deployed image/);
  assert.match(workflow, /CONTAINERS_ROLLOUT: \$\{\{ steps\.container\.outputs\.rollout \}\}/);
  assert.match(workflow, /--containers-rollout="\$\{CONTAINERS_ROLLOUT\}"/);
  assert.doesNotMatch(workflow, /--containers-rollout=immediate\s*$/m);
});

test("deployment authenticates read-only before attempting Cloudflare mutation", () => {
  const preflightIndex = workflow.indexOf("Verify Cloudflare deployment credentials and account access");
  const deployIndex = workflow.indexOf("Deploy exact CI-verified revision to Cloudflare");
  assert.ok(preflightIndex >= 0);
  assert.ok(deployIndex > preflightIndex);
  assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(workflow, /wrangler@4\.127\.1 whoami/);
  assert.match(workflow, /Deployment was not attempted/);
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

test("deployment waits for the canonical exact-head CI beyond the default API page", () => {
  assert.match(workflow, /actions\/workflows\/ci\.yml\/runs\?head_sha=\$HEAD_SHA&status=completed&per_page=100/);
  assert.match(workflow, /actions\/runs\/\$CI_RUN_ID/);
  assert.match(workflow, /CI_RUN_ID.*workflow_run\.id/);
  assert.match(workflow, /actions\/runs\/\$CI_RUN_ID.*\.head_sha == \"'\"\$HEAD_SHA\"'\"/s);
  assert.match(workflow, /\.path == \"\.github\/workflows\/ci\.yml\"/);
  assert.match(workflow, /\.head_sha == \"'\"\$HEAD_SHA\"'\"/);
  assert.match(workflow, /HEAD_SHA.*\^\[0-9a-fA-F\]\{40\}\$/);
});

test("deployment workflow remains fail-closed and read-only toward GitHub", () => {
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.doesNotMatch(workflow, /contents: write/);
  assert.doesNotMatch(workflow, /actions: write/);
  assert.match(workflow, /No parent commit is available; conservatively requesting an immediate Container rollout/);
  assert.match(workflow, /Failing closed/);
});
