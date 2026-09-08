const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const triggerPath = join(process.cwd(), ".github", "workflows", "android-stable-release-trigger.yml");
const watchdogPath = join(process.cwd(), ".github", "workflows", "android-stable-release-watchdog.yml");

function readConcurrencyBlock(filePath) {
  const workflow = readFileSync(filePath, "utf8");
  const start = workflow.indexOf("concurrency:\n");
  const end = workflow.indexOf("\n\njobs:", start);
  assert.notEqual(start, -1, `${filePath} must define concurrency`);
  assert.notEqual(end, -1, `${filePath} concurrency block must terminate before jobs`);
  return workflow.slice(start, end);
}

test("stable dispatch controllers share one non-cancelling concurrency group", () => {
  const triggerConcurrency = readConcurrencyBlock(triggerPath);
  const watchdogConcurrency = readConcurrencyBlock(watchdogPath);

  assert.equal(triggerConcurrency, watchdogConcurrency);
  assert.match(triggerConcurrency, /group: android-stable-release-dispatch-controller/);
  assert.match(triggerConcurrency, /cancel-in-progress: false/);
});

test("both controllers retain exact-main and active-release guards", () => {
  const trigger = readFileSync(triggerPath, "utf8");
  const watchdog = readFileSync(watchdogPath, "utf8");

  assert.match(trigger, /CURRENT_MAIN=.*branches\/main/);
  assert.match(trigger, /CI_CONCLUSION/);
  assert.match(trigger, /ACTIVE_ID/);
  assert.match(trigger, /inputs\[source_sha\]=\$MAIN_SHA/);

  assert.match(watchdog, /CURRENT_MAIN=.*branches\/main/);
  assert.match(watchdog, /CI_CONCLUSION/);
  assert.match(watchdog, /ACTIVE_ID/);
  assert.match(watchdog, /inputs\[source_sha\]=\$MAIN_SHA/);
});

test("watchdog keeps bounded fail-closed retry budget", () => {
  const watchdog = readFileSync(watchdogPath, "utf8");

  assert.match(watchdog, /FAILED_ATTEMPT/);
  assert.match(watchdog, /-lt 3/);
  assert.match(watchdog, /-ge 3/);
  assert.match(watchdog, /Automatic retry budget exhausted/);
});
