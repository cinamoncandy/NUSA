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

test("deployment workflow remains fail-closed and read-only toward GitHub", () => {
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.doesNotMatch(workflow, /contents: write/);
  assert.doesNotMatch(workflow, /actions: write/);
  assert.match(workflow, /No parent commit is available; conservatively requesting an immediate Container rollout/);
  assert.match(workflow, /Failing closed/);
});
