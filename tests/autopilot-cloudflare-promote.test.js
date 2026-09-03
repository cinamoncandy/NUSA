const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "autopilot-cloudflare-promote.yml"), "utf8");

test("Cloudflare Promote accepts a direct workflow_dispatch with exact head_sha for GITHUB_TOKEN-dispatched CI runs", () => {
  assert.match(workflow, /workflow_dispatch:\s*\n\s*inputs:\s*\n\s*head_sha:/);
  assert.match(workflow, /required: true/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /inputs\.head_sha/);
});

test("Promote still verifies exact current main revision before promoting", () => {
  assert.match(workflow, /Verify exact current main revision/);
  assert.match(workflow, /Skipping stale CI revision/);
  assert.match(workflow, /Promote exact verified revision to Cloudflare production branch/);
});

test("Promote preserves fail-closed authority invariants", () => {
  assert.match(workflow, /liveAuthority=NONE/);
  assert.match(workflow, /productionMutationAllowed=false/);
  assert.match(workflow, /AI authority=ZERO_AUTHORITY/);
});
