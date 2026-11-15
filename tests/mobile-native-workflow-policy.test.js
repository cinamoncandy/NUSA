const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workflowPath = path.join(__dirname, "..", ".github", "workflows", "mobile-native.yml");
const workflow = fs.readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n");
const releaseIntent = "if: github.event_name != 'pull_request' || contains(github.event.pull_request.labels.*.name, 'release-candidate')";

function jobBlock(name) {
  const marker = `  ${name}:\n`;
  const start = workflow.indexOf(marker);
  assert.ok(start >= 0, `missing job: ${name}`);
  const rest = workflow.slice(start + marker.length);
  const next = rest.search(/^  [a-z0-9-]+:\n/m);
  return next < 0 ? rest : rest.slice(0, next);
}

test("Mobile Native supports explicit Android release intent and label changes", () => {
  assert.match(workflow, /workflow_dispatch:(?: \{\})?\n/);
  assert.match(workflow, /types: \[opened, synchronize, reopened, labeled, unlabeled\]/);
  assert.equal(workflow.split(releaseIntent).length - 1, 1);
});

test("ordinary pull requests keep foundation and Android debug unconditional (iOS was removed on 2026-11-15)", () => {
  for (const name of ["foundation-smoke", "android-debug"]) {
    assert.doesNotMatch(jobBlock(name), /^    if:/m, `${name} must not be gated by release intent`);
  }
  assert.match(jobBlock("android-debug"), /assembleDebug/);
  assert.doesNotMatch(workflow, /ios-debug|macos-/i);
});

test("Android release candidate remains gated and no iOS release candidate exists", () => {
  const android = jobBlock("android-release-candidate");
  assert.ok(android.includes(releaseIntent));
  assert.match(android, /assembleRelease/);
  assert.doesNotMatch(workflow, /ios-release-candidate/i);
});
