const test = require("node:test");
const assert = require("node:assert/strict");
const { attributeOpportunityPerformance, aggregateOpportunityAttributions } = require("../dist/apps/cloud/src/opportunityAttribution.js");

const input = (overrides = {}) => ({
  opportunityId: "opp-1",
  strategyId: "funding-carry",
  openedAt: 1_000,
  closedAt: 2_000,
  notional: 10_000,
  expectedEdgeBps: 50,
  entryReferencePrice: 100,
  entryFillPrice: 100.1,
  exitReferencePrice: 102,
  exitFillPrice: 101.9,
  side: "LONG",
  fundingContribution: 5,
  feeCost: 2,
  slippageCost: 1,
  decayLoss: 0.5,
  confidence: 0.8,
  realizedOutcome: 1,
  ...overrides
});

test("attributes opportunity pnl deterministically and reconciles components", () => {
  const result = attributeOpportunityPerformance(input());
  assert.equal(result.holdingPeriodMs, 1_000);
  assert.equal(result.expectedEdgeValue, 50);
  assert.ok(Math.abs(result.reconciliationError) < 1e-8);
  assert.deepEqual(result, attributeOpportunityPerformance(input()));
  assert.ok(Object.isFrozen(result));
});

test("supports short and neutral opportunities", () => {
  const short = attributeOpportunityPerformance(input({ opportunityId: "short", side: "SHORT", entryFillPrice: 100, exitFillPrice: 95, entryReferencePrice: 100, exitReferencePrice: 95 }));
  assert.ok(short.grossPnl > 0);
  const neutral = attributeOpportunityPerformance(input({ opportunityId: "neutral", side: "NEUTRAL" }));
  assert.equal(neutral.grossPnl, 0);
});

test("reports capture ratio and calibration error", () => {
  const result = attributeOpportunityPerformance(input({ confidence: 0.9, realizedOutcome: 0 }));
  assert.equal(result.confidenceCalibrationError, 0.9);
  assert.equal(result.edgeCaptureRatio, result.capturedEdgeValue / result.expectedEdgeValue);
});

test("rejects invalid timestamps, prices, costs, and confidence", () => {
  assert.throws(() => attributeOpportunityPerformance(input({ closedAt: 999 })), /closedAt/);
  assert.throws(() => attributeOpportunityPerformance(input({ entryFillPrice: 0 })), /entryFillPrice/);
  assert.throws(() => attributeOpportunityPerformance(input({ feeCost: -1 })), /cost inputs/);
  assert.throws(() => attributeOpportunityPerformance(input({ confidence: 2 })), /confidence/);
});

test("aggregates by strategy deterministically", () => {
  const first = attributeOpportunityPerformance(input());
  const second = attributeOpportunityPerformance(input({ opportunityId: "opp-2", strategyId: "momentum", netPnl: undefined }));
  const result = aggregateOpportunityAttributions([first, second]);
  assert.equal(result.byStrategy.length, 2);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.byStrategy));
});

test("duplicate opportunity attributions fail closed", () => {
  const first = attributeOpportunityPerformance(input());
  assert.throws(() => aggregateOpportunityAttributions([first, first]), /duplicate/);
});
