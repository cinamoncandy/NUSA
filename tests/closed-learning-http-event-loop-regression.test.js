const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (relative) => fs.readFileSync(path.join(__dirname, "..", relative), "utf8");

test("production closed-learning scheduler never runs synchronous Research on startup or interval", () => {
  const source = read("apps/cloud/src/closedLearningProductionRuntime.ts");
  assert.match(source, /runClosedLearningBootstrapAsync/);
  assert.match(source, /runClosedLearningRolloverAsync/);
  assert.match(source, /setTimeout\(scheduleTick, 0\)/);
  assert.match(source, /setInterval\(scheduleTick, CLOSED_LEARNING_ROLLOVER_POLL_INTERVAL_MS\)/);
  assert.doesNotMatch(source, /^\s*runClosedLearningBootstrap\(\);\s*$/m);
  assert.doesNotMatch(source, /^\s*runClosedLearningRollover\(\);\s*$/m);
});

test("production Research replay uses asynchronous child-process path", () => {
  const worker = read("apps/cloud/src/closedLearningResearchWorkerClient.ts");
  const adapter = read("apps/cloud/src/closedLearningProductionResearchAdapter.ts");
  const coordinator = read("apps/cloud/src/closedLearningLoopCoordinator.ts");

  assert.match(worker, /import \{ spawn, spawnSync \} from "node:child_process"/);
  assert.match(worker, /public replayAsync\(/);
  assert.match(worker, /public replayInitialResearchAsync\(/);
  const asyncExecute = worker.match(/private async executeAsync[\s\S]*?\r?\n  }\r?\n\r?\n  public replay\(/);
  assert.ok(asyncExecute, "async Research execution method must exist");
  assert.match(asyncExecute[0], /runAsyncProcess/);
  assert.doesNotMatch(asyncExecute[0], /runProcess\(/);

  assert.match(adapter, /await this\.options\.worker\.replayAsync/);
  assert.match(coordinator, /public async runAsync\(/);
});
