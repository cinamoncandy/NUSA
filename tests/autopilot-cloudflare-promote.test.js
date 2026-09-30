const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const yaml = require("js-yaml");

const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "autopilot-cloudflare-promote.yml"), "utf8");

test("promotion write authority is confined to the gated promotion job", () => {
  const document = yaml.load(workflow);
  assert.deepEqual(document.permissions, {});
  assert.deepEqual(document.jobs.verify.permissions, { contents: "read" });
  assert.deepEqual(document.jobs.promote.permissions, { contents: "write" });
  assert.equal(document.jobs.promote.needs, "verify");
  assert.match(document.jobs.promote.if, /outputs.current == 'true'.*outputs.deploy == 'true'/);
  const push = document.jobs.promote.steps.find((step) => step.run?.includes("git push origin"));
  assert.ok(push);
  assert.ok(push.run.indexOf('"$latest_main" != "$HEAD_SHA"') < push.run.indexOf("git push origin"));
  assert.ok(document.jobs.verify.steps.every((step) => !step.run?.includes("git push")));
});

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
