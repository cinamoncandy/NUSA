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

test("Mobile Native supports explicit release intent and label changes", () => {
  assert.match(workflow, /workflow_dispatch:\n/);
  assert.match(workflow, /types: \[opened, synchronize, reopened, labeled, unlabeled\]/);
  assert.equal(workflow.split(releaseIntent).length - 1, 2);
});

test("ordinary pull requests keep foundation and both debug jobs unconditional", () => {
  for (const name of ["foundation-smoke", "android-debug", "ios-debug"]) {
    assert.doesNotMatch(jobBlock(name), /^    if:/m, `${name} must not be gated by release intent`);
  }
  assert.match(jobBlock("android-debug"), /assembleDebug/);
  assert.match(jobBlock("ios-debug"), /-configuration Debug/);
});

test("release candidate jobs are gated but preserve release build commands", () => {
  const android = jobBlock("android-release-candidate");
  const ios = jobBlock("ios-release-candidate");
  assert.match(android, new RegExp(releaseIntent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(ios, new RegExp(releaseIntent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(android, /assembleRelease/);
  assert.match(ios, /-configuration Release/);
});
