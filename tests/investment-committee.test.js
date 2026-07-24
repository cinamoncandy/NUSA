const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateInvestmentCommittee } = require("../dist/apps/cloud/src/investmentCommittee.js");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { SqliteInvestmentCommitteeStore } = require("../dist/packages/storage/src/investmentCommitteeStore.js");

const weights = {
  MACRO: 1, NEWS: 1, QUANT: 1, TECHNICAL: 1, ONCHAIN: 1, DERIVATIVES: 1,
  FLOW: 1, EXECUTION: 1.5, RISK: 2, PORTFOLIO: 1.5, CIO: 2
};
const opinion = (member, signal = "BUY", overrides = {}) => ({
  member, signal, confidence: 0.9, edge: 0.08, expectedReturn: 0.1, expectedRisk: 0.03,
  timeHorizonMs: 60_000, reasons: [`${member} reason`], observedAt: 1_000, ...overrides
});
const safety = (overrides = {}) => ({
  killSwitchActive: false, unresolvedRecovery: false, strategySuspended: false,
  executionQualityScore: 90, minimumExecutionQualityScore: 80,
  netEdge: 0.05, portfolioHeat: 0.4, maximumPortfolioHeat: 0.8,
  drawdown: 0.02, maximumDrawdown: 0.1,
  marginBuffer: 0.3, minimumMarginBuffer: 0.15,
  fundingCarrySafe: true, probabilityFresh: true, featureFingerprintMatches: true,
  ...overrides
});

const committee = () => [
  opinion("MACRO"), opinion("NEWS"), opinion("QUANT"), opinion("EXECUTION"),
  opinion("RISK", "HOLD", { edge: 0.02 }), opinion("PORTFOLIO"), opinion("CIO")
];

test("approves a strong positive deterministic consensus", () => {
  const result = evaluateInvestmentCommittee(committee(), weights, safety(), 1_100);
  assert.ok(["APPROVE", "APPROVE_PARTIAL"].includes(result.decision));
  assert.ok(result.consensus.weightedSignalScore > 0.55);
  assert.equal(result.consensus.vetoReasons.length, 0);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.consensus));
});

test("kill switch and unresolved recovery force emergency exit", () => {
  const result = evaluateInvestmentCommittee(committee(), weights, safety({ killSwitchActive: true, unresolvedRecovery: true }), 1_100);
  assert.equal(result.decision, "EMERGENCY_EXIT");
  assert.ok(result.reasons.includes("KILL_SWITCH_ACTIVE"));
  assert.ok(result.reasons.includes("UNRESOLVED_RECOVERY"));
});

test("hard safety veto cannot be overridden by unanimous buy votes", () => {
  const result = evaluateInvestmentCommittee(committee().map((item) => ({ ...item, signal: "BUY", confidence: 1 })), weights, safety({ netEdge: -0.01 }), 1_100);
  assert.equal(result.decision, "REJECT");
  assert.ok(result.consensus.vetoReasons.includes("NET_EDGE_NON_POSITIVE"));
});

test("stale probability and fingerprint mismatch reject", () => {
  const result = evaluateInvestmentCommittee(committee(), weights, safety({ probabilityFresh: false, featureFingerprintMatches: false }), 1_100);
  assert.equal(result.decision, "REJECT");
  assert.deepEqual(result.consensus.vetoReasons, ["FEATURE_FINGERPRINT_MISMATCH", "PROBABILITY_STALE"]);
});

test("high disagreement waits and reports elevated entropy", () => {
  const opinions = [
    opinion("MACRO", "BUY"), opinion("NEWS", "EXIT"), opinion("QUANT", "BUY"),
    opinion("EXECUTION", "EXIT"), opinion("RISK", "BUY"), opinion("CIO", "EXIT")
  ];
  const result = evaluateInvestmentCommittee(opinions, weights, safety(), 1_100);
  assert.equal(result.decision, "WAIT");
  assert.ok(result.consensus.entropy > 0.9);
  assert.ok(["HIGH", "CRITICAL"].includes(result.consensus.conflictLevel));
});

test("duplicate members, future opinions and invalid confidence fail closed", () => {
  assert.throws(() => evaluateInvestmentCommittee([opinion("MACRO"), opinion("MACRO")], weights, safety(), 1_100), /duplicate committee member/);
  assert.throws(() => evaluateInvestmentCommittee([opinion("MACRO", "BUY", { observedAt: 1_200 })], weights, safety(), 1_100), /future/);
  assert.throws(() => evaluateInvestmentCommittee([opinion("MACRO", "BUY", { confidence: 2 })], weights, safety(), 1_100), /exceeds maximum/);
});

test("same inputs produce identical immutable outputs", () => {
  const first = evaluateInvestmentCommittee(committee(), weights, safety(), 1_100);
  const second = evaluateInvestmentCommittee(committee(), weights, safety(), 1_100);
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first.reasons));
  assert.ok(Object.isFrozen(first.consensus.vetoReasons));
});


test("committee store verifies empty startup, replay and snapshot tampering", () => {
  const db = new SqliteDatabase(":memory:");
  const store = new SqliteInvestmentCommitteeStore(db);
  assert.doesNotThrow(() => store.verify());
  store.append({ outcome: "PAPER_ONLY", confidence: 0.8, edge: 0.05, risk: 0.2, reasons: Object.freeze(["test"]), decidedAt: 1_100 });
  assert.doesNotThrow(() => new SqliteInvestmentCommitteeStore(db).verify());
  db.connection.exec("UPDATE investment_committee_snapshot SET hash = 'tampered' WHERE id = 1");
  assert.throws(() => store.verify(), /snapshot mismatch/);
  db.close();
});
