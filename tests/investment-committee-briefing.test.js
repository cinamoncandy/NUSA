const test = require("node:test");
const assert = require("node:assert/strict");
const { buildInvestmentCommitteeBriefing } = require("../dist/apps/mobile/src/investmentCommitteeBriefing.js");

const result = (overrides = {}) => ({
  decision: "APPROVE",
  consensus: {
    weightedSignalScore: 0.8,
    weightedConfidence: 0.84,
    weightedEdge: 0.113,
    weightedRisk: 0.04,
    agreementScore: 0.79,
    disagreementScore: 0.21,
    entropy: 0.3,
    conflictLevel: "LOW",
    vetoReasons: []
  },
  reasons: ["POSITIVE_CONSENSUS"],
  decidedAt: 1_000,
  ...overrides
});

const input = (overrides = {}) => ({
  asset: "btc",
  strategyId: "carry",
  strategyVersion: "1.0.0",
  result: result(),
  generatedAt: 1_000,
  maximumAgeMs: 100,
  ...overrides
});

test("builds an actionable immutable committee briefing", () => {
  const briefing = buildInvestmentCommitteeBriefing(input(), 1_050);
  assert.equal(briefing.asset, "BTC");
  assert.equal(briefing.strategy, "carry@1.0.0");
  assert.equal(briefing.status, "ACTIONABLE");
  assert.equal(briefing.confidencePercent, 84);
  assert.equal(briefing.edgePercent, 11.3);
  assert.ok(Object.isFrozen(briefing));
  assert.ok(Object.isFrozen(briefing.reasons));
});

test("vetoes and emergency decisions are blocked", () => {
  const briefing = buildInvestmentCommitteeBriefing(input({ result: result({
    decision: "EMERGENCY_EXIT",
    consensus: { ...result().consensus, conflictLevel: "CRITICAL", vetoReasons: ["KILL_SWITCH_ACTIVE"] },
    reasons: ["KILL_SWITCH_ACTIVE"]
  }) }), 1_050);
  assert.equal(briefing.status, "BLOCKED");
  assert.deepEqual(briefing.vetoes, ["KILL_SWITCH_ACTIVE"]);
});

test("wait, paper-only, partial approval, and high conflict are cautionary", () => {
  for (const decision of ["WAIT", "PAPER_ONLY", "APPROVE_PARTIAL"]) {
    assert.equal(buildInvestmentCommitteeBriefing(input({ result: result({ decision }) }), 1_050).status, "CAUTION");
  }
  const highConflict = result({ consensus: { ...result().consensus, conflictLevel: "HIGH" } });
  assert.equal(buildInvestmentCommitteeBriefing(input({ result: highConflict }), 1_050).status, "CAUTION");
});

test("future and stale briefings fail closed", () => {
  assert.throws(() => buildInvestmentCommitteeBriefing(input({ generatedAt: 1_100 }), 1_050), /future/);
  assert.throws(() => buildInvestmentCommitteeBriefing(input({ generatedAt: 900 }), 1_050), /stale/);
});

test("same inputs produce deterministic output", () => {
  assert.deepEqual(buildInvestmentCommitteeBriefing(input(), 1_050), buildInvestmentCommitteeBriefing(input(), 1_050));
});
