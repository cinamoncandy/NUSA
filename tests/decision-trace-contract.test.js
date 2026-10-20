const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("the operations contract keeps a well-formed decision trace and drops a malformed one on its own", () => {
  const { buildPersonalPaperOperationsSnapshot, validatePersonalPaperOperationsSnapshot } = require("../dist/packages/contracts/src/personalPaperOperations.js");
  const heartbeat = (extra) => ({ startedAt: 1_000, lastHeartbeatAt: 1_000, lastMarketEventAt: null, lastPaperDecisionAt: null, lastPaperOrderAt: null, lastPaperFillAt: null, eventCount: 0, decisionCount: 0, paperOrderCount: 0, paperFillCount: 0, lastError: null, ...extra });
  const dashboard = { apiVersion: "1", generatedAt: 1_000, mode: "PAPER", killSwitchActive: false, overallHealth: "HEALTHY", tradingAllowed: true, headline: "PAPER healthy", issues: [], deployableCapital: 1_000, deployedCapital: 500, cashCapital: 500, reservedCapital: 0, spotCapital: 500, futuresCapital: 0, positions: [], decisions: [], liveAuthority: "NONE", productionMutationAllowed: false };
  const operations = { runtimeState: "READY", schedulerRunning: true, schedulerMode: "OBSERVE", pipelineStage: "MONITORING", transport: "ONLINE", killSwitchActive: false, accountHalted: false, pendingWrites: 0, lastEventAt: 1_000, updatedAt: 1_000 };
  const attempt = (extra) => validatePersonalPaperOperationsSnapshot(buildPersonalPaperOperationsSnapshot({ dashboard, research: null, operations: { ...operations, heartbeat: heartbeat(extra) }, paperLearning: null }, 1_000), 1_100, 500).operations.heartbeat;
  const zeros = () => new Array(288).fill(0);
  const good = { since: 500, bucketMs: 300_000, decisions: Object.assign(zeros(), { 3: 4 }), orders: zeros() };
  assert.equal(attempt({ decisionTrace: good, windowDecisionCount: 4 }).decisionTrace.decisions[3], 4);
  for (const bad of [
    { ...good, bucketMs: 60_000 },
    { ...good, decisions: zeros().slice(1) },
    { ...good, orders: Object.assign(zeros(), { 0: -1 }) },
    { ...good, decisions: Object.assign(zeros(), { 5: 1.5 }) },
    { ...good, since: -1 },
    [1, 2],
  ]) {
    const hb = attempt({ decisionTrace: bad, windowDecisionCount: 4 });
    assert.equal(hb.decisionTrace, undefined);
    assert.equal(hb.windowDecisionCount, 4, "other display fields survive");
  }
});

test("the runtime reports the trace only with the canonical PAPER boundary and records decisions and orders", () => {
  const body = fs.readFileSync("apps/cloud/src/runtime.ts", "utf8").replace(/\r\n/g, "\n");
  assert.match(body, /const paper = productionPaperBoundary == null \? \{\} : \{[^\n]*decisionTrace: decisionTrace\.snapshot\(Date\.now\(\)\)/);
  assert.match(body, /buyWindow\.decisions \+= state\.decisions\.length;\n\s*decisionTrace\.record\("decision", state\.decisions\.length, Date\.now\(\)\);/);
  assert.match(body, /buyWindow\.orders \+= result\.orders\.length;\n\s*decisionTrace\.record\("order", result\.orders\.length, Date\.now\(\)\);/);
});
