const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const workflow = fs.readFileSync(path.resolve(".github/workflows/autopilot-release-main-ci-continuation.yml"), "utf8").replace(/\r\n/g, "\n");

test("post-Release continuation reuses canonical CI without adding authority", () => {
  assert.match(workflow, /workflow_run:\s*\n\s*workflows: \[Autopilot Execution Consumer\]/);
  assert.match(workflow, /types: \[completed\]/);
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /if:\s*github\.event\.workflow_run\.conclusion == 'success' \|\| github\.event\.workflow_run\.conclusion == 'failure'/);
  assert.doesNotMatch(workflow, /^\s*if:\s*github\.event\.workflow_run\.conclusion == 'success'\s*$/m);
  assert.match(workflow, /group: nusa-release-main-ci-continuation/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /permissions: \{\}/);
  assert.equal((workflow.match(/actions: write/g) || []).length, 1);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /contents: write/);
  assert.doesNotMatch(workflow, /pull-requests: write/);
  assert.doesNotMatch(workflow, /issues: write/);
  assert.doesNotMatch(workflow, /repository_dispatch/);
  assert.doesNotMatch(workflow, /LIVE|ACTIVE|NUSA_GITHUB_TOKEN|NUSA_WEBHOOK_SECRET/);
});

test("continuation checks exact current protected main in canonical ci.yml before dispatch", () => {
  assert.match(workflow, /branches\/main/);
  assert.match(workflow, /actions\/workflows\/ci\.yml\/runs\?branch=main&head_sha=\$current_main&per_page=100/);
  assert.match(workflow, /\.path == "\.github\/workflows\/ci\.yml"/);
  assert.match(workflow, /\.head_branch == "main"/);
  assert.match(workflow, /\.head_sha ==/);
  assert.match(workflow, /if \[ "\$existing" -gt 0 \]; then/);
  assert.match(workflow, /actions\/workflows\/ci\.yml\/dispatches/);
  assert.match(workflow, /\{\"ref\":\"main\"\}/);
  assert.equal((workflow.match(/actions\/workflows\/ci\.yml\/dispatches/g) || []).length, 1);
  assert.equal((workflow.match(/actions\/workflows\/ci\.yml\/runs/g) || []).length, 1);
  assert.doesNotMatch(workflow, /actions\/runs\?head_sha=/);
});
