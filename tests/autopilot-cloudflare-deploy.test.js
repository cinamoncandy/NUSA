const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "autopilot-cloudflare-deploy.yml"), "utf8");

test("Cloudflare deployment recovers after a CI-only repair merge", () => {
  assert.match(workflow, /workflow_run:\s*\n\s*workflows: \[CI\]/);
  assert.match(workflow, /github\.event\.workflow_run\.head_sha/);
  assert.match(workflow, /Determine whether Worker deployment is needed/);
  assert.match(workflow, /deploymentRevision/);
  assert.match(workflow, /git diff --quiet .*apps\/autopilot/);
  assert.match(workflow, /CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /liveAuthority=NONE/);
  assert.match(workflow, /productionMutationAllowed=false/);
  assert.match(workflow, /AI authority=ZERO_AUTHORITY/);
});

test("deployment workflow remains fail-closed and read-only toward GitHub", () => {
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.doesNotMatch(workflow, /contents: write/);
  assert.doesNotMatch(workflow, /actions: write/);
  assert.match(workflow, /Failing closed/);
});
