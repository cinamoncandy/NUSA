const test = require("node:test");
const assert = require("node:assert/strict");
const { buildDailyAiAudit } = require("../dist/apps/cloud/src/dailyAiAudit.js");

const attribution = (opportunityId, strategyId, overrides = {}) => ({
  opportunityId,
  strategyId,
  holdingPeriodMs: 1_000,
  grossPnl: 20,
  netPnl: 15,
  marketMoveContribution: 18,
  fundingContribution: 2,
  executionContribution: -1,
  feeContribution: -2,
  slippageContribution: -1,
  timingContribution: 3,
  decayContribution: -1,
  expectedEdgeValue: 20,
  capturedEdgeValue: 15,
  edgeCaptureRatio: 0.75,
  confidenceCalibrationError: 0.1,
  reconciliationError: 0,
  ...overrides
});

const input = (overrides = {}) => ({
  periodStart: 1_000,
  periodEnd: 2_000,
  generatedAt: 2_001,
  attributions: [
    attribution("opp-1", "funding-carry"),
    attribution("opp-2", "funding-carry"),
    attribution("opp-3", "momentum", { netPnl: -10, capturedEdgeValue: -10, edgeCaptureRatio: -0.5, confidenceCalibrationError: 0.8, executionContribution: -5, feeContribution: -2, slippageContribution: -3 })
  ],
  thresholds: {
    minimumTrades: 2,
    minimumAverageCaptureRatio: 0.5,
    maximumAverageCalibrationError: 0.4,
    maximumExecutionCostRatio: 0.5,
    minimumNetPnl: 0
  },
  ...overrides
});

test("builds deterministic immutable daily audit", () => {
  const first = buildDailyAiAudit(input());
  const second = buildDailyAiAudit(input());
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.strategies));
  assert.equal(first.totalTrades, 3);
  assert.equal(first.totalNetPnl, 20);
});

test("keeps healthy strategy and flags degraded strategy without automatic mutation", () => {
  const result = buildDailyAiAudit(input());
  const carry = result.strategies.find((item) => item.strategyId === "funding-carry");
  const momentum = result.strategies.find((item) => item.strategyId === "momentum");
  assert.equal(carry.health, "HEALTHY");
  assert.equal(momentum.health, "PAPER_ONLY_RECOMMENDED");
  assert.ok(momentum.reasons.includes("NET_PNL_BELOW_THRESHOLD"));
  assert.ok(result.warnings.includes("momentum:PAPER_ONLY_RECOMMENDED"));
});

test("insufficient samples are watch only when no severe degradation exists", () => {
  const result = buildDailyAiAudit(input({ attributions: [attribution("single", "new-strategy")] }));
  assert.equal(result.strategies[0].health, "WATCH");
  assert.deepEqual(result.strategies[0].reasons, ["INSUFFICIENT_SAMPLE"]);
});

test("execution drag uses adverse execution plus fees and slippage", () => {
  const result = buildDailyAiAudit(input({ attributions: [attribution("x", "s", { expectedEdgeValue: 10, capturedEdgeValue: 2, executionContribution: -2, feeContribution: -1, slippageContribution: -1 })] }));
  assert.equal(result.totalExecutionDrag, 4);
  assert.equal(result.strategies[0].executionCostRatio, 0.4);
});

test("duplicate attribution and invalid periods fail closed", () => {
  const item = attribution("dup", "s");
  assert.throws(() => buildDailyAiAudit(input({ attributions: [item, item] })), /duplicate/);
  assert.throws(() => buildDailyAiAudit(input({ periodEnd: 999 })), /periodEnd/);
  assert.throws(() => buildDailyAiAudit(input({ generatedAt: 1_999 })), /generatedAt/);
});

test("invalid thresholds fail closed", () => {
  assert.throws(() => buildDailyAiAudit(input({ thresholds: { ...input().thresholds, minimumTrades: 0 } })), /minimumTrades/);
  assert.throws(() => buildDailyAiAudit(input({ thresholds: { ...input().thresholds, maximumAverageCalibrationError: 2 } })), /maximumAverageCalibrationError/);
});
