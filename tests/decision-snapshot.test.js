const test = require("node:test");
const assert = require("node:assert/strict");
const { buildDecisionSnapshot } = require("../dist/apps/desktop/src/decisionSnapshot.js");
const { DecisionSnapshotService } = require("../dist/apps/desktop/src/decisionSnapshotService.js");

const envelope = (decision = "BUY") => ({
  mode: "PAPER",
  generatedAt: 1000,
  snapshot: {
    committee: { decision, confidence: 0.9, edge: 0.2, risk: 0.1, conflictLevel: "LOW", reasons: ["Trend supports the candidate"] },
    warnings: [],
    status: "HEALTHY",
    tradingPermitted: false,
    portfolio: {}, opportunities: {}, strategies: {}, execution: {}, research: {}, risk: {}
  }
});

test("decision snapshot is recommendation-only and deterministic", () => {
  const result = buildDecisionSnapshot(envelope(), 1000);
  assert.equal(result.recommendation, "BUY");
  assert.equal(result.productionMutationAllowed, false);
  assert.equal(result.recommendationOnly, true);
  assert.deepEqual(result, buildDecisionSnapshot(envelope(), 1000));
});

test("unknown committee decisions fail closed to WAIT", () => {
  assert.equal(buildDecisionSnapshot(envelope("UNKNOWN"), 1000).recommendation, "WAIT");
});

test("missing dashboard data returns NO_DATA", () => {
  assert.deepEqual(new DecisionSnapshotService({ current: () => null }, () => 1000).get(), { ok: false, status: "NO_DATA", message: "Decision data is not available" });
});
