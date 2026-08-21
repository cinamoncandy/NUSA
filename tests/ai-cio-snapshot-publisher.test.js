const test = require("node:test");
const assert = require("node:assert/strict");
const { AiCioSnapshotPublisher } = require("../dist/apps/desktop/src/ai/aiCioSnapshotPublisher.js");

const now = 10_000;
const section = (overrides = {}) => ({ status: "HEALTHY", generatedAt: now, reasons: [], ...overrides });
const complete = (overrides = {}) => ({
  portfolio: section({ totalEquity: 1_000, deployableCapital: 800, reservedCapital: 200, grossExposureRatio: 0.2, netExposureRatio: 0.1 }),
  opportunities: section({ activeCount: 1, totalAllocatedCapital: 100, reservedCash: 700, topOpportunityId: "opp-1", topOpportunityScore: 0.8 }),
  strategies: section({ totalTrades: 10, totalNetPnl: 20, portfolioCaptureRatio: 0.8, blockedStrategies: 0, warningStrategies: 0 }),
  committee: section({ decision: "APPROVE", confidence: 0.8, edge: 0.1, risk: 0.2, conflictLevel: "LOW" }),
  execution: section({ fillQuality: 0.95, slippageBps: 2, latencyMs: 50 }),
  research: section({ walkForwardPassed: true, monteCarloPassed: true, costStressPassed: true, paperPromotionEligible: true }),
  risk: section({ killSwitchActive: false, dailyDrawdownRatio: 0.01, liquidationBufferRatio: 0.8, portfolioHeatRatio: 0.2 }),
  ...overrides
});

const sink = () => ({
  published: null,
  clears: 0,
  publish(value) { this.published = value; },
  clear() { this.published = null; this.clears += 1; }
});

const publisher = (target) => new AiCioSnapshotPublisher(target, {
  mode: "PAPER",
  maximumSectionAgeMs: 1_000,
  maximumEnvelopeAgeMs: 500
});

test("publishes only a complete fresh AI CIO snapshot", () => {
  const target = sink();
  const result = publisher(target).publishIfComplete(complete(), now);
  assert.equal(result.version, 1);
  assert.equal(result.mode, "PAPER");
  assert.equal(result.snapshot.status, "HEALTHY");
  assert.equal(target.published, result);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.snapshot));
});

test("missing section clears the previous snapshot and returns null", () => {
  const target = sink();
  const service = publisher(target);
  service.publishIfComplete(complete(), now);
  const sections = complete();
  delete sections.risk;
  assert.equal(service.publishIfComplete(sections, now), null);
  assert.equal(target.published, null);
  assert.equal(target.clears, 1);
});

test("stale or future section clears instead of publishing partial truth", () => {
  for (const generatedAt of [now - 1_001, now + 1]) {
    const target = sink();
    const result = publisher(target).publishIfComplete(complete({ risk: section({ generatedAt, killSwitchActive: false, dailyDrawdownRatio: 0, liquidationBufferRatio: 1, portfolioHeatRatio: 0 }) }), now);
    assert.equal(result, null);
    assert.equal(target.published, null);
    assert.equal(target.clears, 1);
  }
});

test("invalid complete input clears and rethrows", () => {
  const target = sink();
  assert.throws(() => publisher(target).publishIfComplete(complete({
    portfolio: section({ totalEquity: 100, deployableCapital: 90, reservedCapital: 20, grossExposureRatio: 0.2, netExposureRatio: 0.1 })
  }), now), /must equal total equity/);
  assert.equal(target.published, null);
  assert.equal(target.clears, 1);
});

test("configuration and clock fail closed", () => {
  const target = sink();
  assert.throws(() => new AiCioSnapshotPublisher(target, { mode: "PAPER", maximumSectionAgeMs: 0, maximumEnvelopeAgeMs: 1 }), /maximumSectionAgeMs/);
  assert.throws(() => publisher(target).publishIfComplete(complete(), -1), /now/);
});
