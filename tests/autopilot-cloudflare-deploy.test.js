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
  assert.match(workflow, /Container rollout stay atomically aligned/);
  assert.doesNotMatch(workflow, /git diff --quiet .*apps\/autopilot/);
  assert.match(workflow, /CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /--containers-rollout=immediate/);
  assert.match(workflow, /liveAuthority=NONE/);
  assert.match(workflow, /productionMutationAllowed=false/);
  assert.match(workflow, /AI authority=ZERO_AUTHORITY/);
});

test("Wait-for-CI polling only runs on the push trigger, never re-polls a workflow_run whose trigger already proves CI success", () => {
  // The job-level `if:` already requires github.event.workflow_run.conclusion == 'success' for
  // the workflow_run trigger -- re-polling the Actions API on that path is both redundant and
  // unsafe, since this repository's autopilot control-plane generates many workflow_run entries
  // for the same head_sha and an unpaginated query can miss the actual CI run within the poll
  // window, causing a false-negative timeout even though CI genuinely succeeded.
  const waitStepMatch = workflow.match(/- name: Wait for exact-head CI success before deploying[\s\S]*?(?=\n {6}- name:)/);
  assert.ok(waitStepMatch, "expected to find the Wait-for-CI step");
  const waitStep = waitStepMatch[0];
  assert.match(waitStep, /if: github\.event_name == 'push'/);
  assert.match(waitStep, /per_page=100/);
});

test("deployment workflow remains fail-closed and read-only toward GitHub", () => {
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.doesNotMatch(workflow, /contents: write/);
  assert.doesNotMatch(workflow, /actions: write/);
  assert.match(workflow, /Failing closed/);
});
