const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("the heartbeat lossLimit carries the day start and the last loss time, display only, from the risk session", () => {
  const runtime = fs.readFileSync(path.resolve(__dirname, "../apps/cloud/src/runtime.ts"), "utf8");
  assert.match(runtime, /periodStartedAt: session\.periodStartedAt, \.\.\.\(session\.lastIncrementAt == null \? \{\} : \{ lastLossAt: session\.lastIncrementAt \}\)/);
});

test("the contract keeps ordered day markers and drops a lossLimit whose markers are out of order", () => {
  const { buildPersonalPaperOperationsSnapshot, validatePersonalPaperOperationsSnapshot } = require("../dist/packages/contracts/src/personalPaperOperations.js");
  const heartbeat = (extra) => ({ startedAt: 1_000, lastHeartbeatAt: 1_000, lastMarketEventAt: null, lastPaperDecisionAt: null, lastPaperOrderAt: null, lastPaperFillAt: null, eventCount: 0, decisionCount: 0, paperOrderCount: 0, paperFillCount: 0, lastError: null, ...extra });
  const dashboard = { apiVersion: "1", generatedAt: 1_000, mode: "PAPER", killSwitchActive: false, overallHealth: "HEALTHY", tradingAllowed: true, headline: "PAPER healthy", issues: [], deployableCapital: 1_000, deployedCapital: 500, cashCapital: 500, reservedCapital: 0, spotCapital: 500, futuresCapital: 0, positions: [], decisions: [], liveAuthority: "NONE", productionMutationAllowed: false };
  const operations = { runtimeState: "READY", schedulerRunning: true, schedulerMode: "OBSERVE", pipelineStage: "MONITORING", transport: "ONLINE", killSwitchActive: false, accountHalted: false, pendingWrites: 0, lastEventAt: 1_000, updatedAt: 1_000 };
  const attempt = (lossLimit) => validatePersonalPaperOperationsSnapshot(buildPersonalPaperOperationsSnapshot({ dashboard, research: null, operations: { ...operations, heartbeat: heartbeat({ lossLimit }) }, paperLearning: null }, 1_000), 1_100, 500).operations.heartbeat.lossLimit;
  const base = { consecutiveLossCount: 3, maxConsecutiveLosses: 3, evaluatedAt: 900 };
  assert.deepEqual({ ...attempt({ ...base, periodStartedAt: 100, lastLossAt: 500 }) }, { ...base, periodStartedAt: 100, lastLossAt: 500 });
  assert.deepEqual({ ...attempt(base) }, base, "older runtimes omit the markers");
  assert.equal(attempt({ ...base, periodStartedAt: 100, lastLossAt: 50 }), undefined, "loss before the day start");
  assert.equal(attempt({ ...base, lastLossAt: 901 }), undefined, "loss after the evaluation");
  assert.equal(attempt({ ...base, periodStartedAt: 950 }), undefined, "day start after the evaluation");
  assert.equal(attempt({ ...base, periodStartedAt: "100" }), undefined);
});
