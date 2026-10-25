const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("the operations contract keeps a consistent learning-loop object and drops an inconsistent or malformed one on its own", () => {
  const { buildPersonalPaperOperationsSnapshot, validatePersonalPaperOperationsSnapshot } = require("../dist/packages/contracts/src/personalPaperOperations.js");
  const heartbeat = (extra) => ({ startedAt: 1_000, lastHeartbeatAt: 1_000, lastMarketEventAt: null, lastPaperDecisionAt: null, lastPaperOrderAt: null, lastPaperFillAt: null, eventCount: 0, decisionCount: 0, paperOrderCount: 0, paperFillCount: 0, lastError: null, ...extra });
  const dashboard = { apiVersion: "1", generatedAt: 1_000, mode: "PAPER", killSwitchActive: false, overallHealth: "HEALTHY", tradingAllowed: true, headline: "PAPER healthy", issues: [], deployableCapital: 1_000, deployedCapital: 500, cashCapital: 500, reservedCapital: 0, spotCapital: 500, futuresCapital: 0, positions: [], decisions: [], liveAuthority: "NONE", productionMutationAllowed: false };
  const operations = { runtimeState: "READY", schedulerRunning: true, schedulerMode: "OBSERVE", pipelineStage: "MONITORING", transport: "ONLINE", killSwitchActive: false, accountHalted: false, pendingWrites: 0, lastEventAt: 1_000, updatedAt: 1_000 };
  const attempt = (extra) => validatePersonalPaperOperationsSnapshot(buildPersonalPaperOperationsSnapshot({ dashboard, research: null, operations: { ...operations, heartbeat: heartbeat(extra) }, paperLearning: null }, 1_000), 1_100, 500).operations.heartbeat;
  const good = { experiments: 15, configurations: 192, discoveryPasses: 15, holdoutPasses: 0, overfitRatePercent: 100, paperPeriodsConsumed: 68, paperNetBp: -17, paperExcessBp: 2, shadowSince: 1_000, shadowTrades: 580, shadowWins: 115, shadowGrossGainBp: 3900, shadowGrossLossBp: 5684, shadowFeeBp: 5799, evaluatedAt: 1_000 };
  assert.equal(attempt({ learningLoop: good, windowDecisionCount: 4 }).learningLoop.shadowTrades, 580);
  assert.equal(attempt({ learningLoop: { evaluatedAt: 1_000, paperNetBp: -17 }, windowDecisionCount: 4 }).learningLoop.paperNetBp, -17);
  for (const bad of [
    { ...good, extra: 1 },
    { ...good, evaluatedAt: -1 },
    { ...good, discoveryPasses: 200 },
    { ...good, holdoutPasses: 16 },
    { ...good, shadowWins: 581 },
    { ...good, overfitRatePercent: 101 },
    { ...good, shadowFeeBp: -1 },
    { ...good, shadowTrades: 1.5 },
    { ...good, paperNetBp: 1e9 },
    [1, 2],
  ]) {
    const hb = attempt({ learningLoop: bad, windowDecisionCount: 4 });
    assert.equal(hb.learningLoop, undefined);
    assert.equal(hb.windowDecisionCount, 4, "other display fields survive");
  }
});

test("the runtime copies only consistent integers from the closed-learning status and never sends an empty object", () => {
  const body = fs.readFileSync("apps/cloud/src/runtime.ts", "utf8").replace(/\r\n/g, "\n");
  assert.match(body, /\.\.\.learningFunnelHeartbeat\(\), \.\.\.learningLoopHeartbeat\(\)/);
  assert.match(body, /if \(Object\.keys\(out\)\.length === 0\) return \{\};/);
  assert.match(body, /out\.discoveryPasses > out\.configurations/);
  assert.match(body, /out\.shadowWins > out\.shadowTrades/);
});
