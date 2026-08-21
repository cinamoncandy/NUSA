const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildAiCioCommandCenterEnvelope,
  validateAiCioCommandCenterEnvelope
} = require("../dist/apps/desktop/src/ai/aiCioCommandCenterAdapter.js");

const section = (extra = {}) => ({ status: "HEALTHY", generatedAt: 1_000, reasons: [], ...extra });
const snapshot = (overrides = {}) => ({
  generatedAt: 1_000,
  status: "HEALTHY",
  tradingPermitted: true,
  portfolio: section({ totalEquity: 1_000, deployableCapital: 700, reservedCapital: 300, grossExposureRatio: 0.3, netExposureRatio: 0.2 }),
  opportunities: section({ activeCount: 1, totalAllocatedCapital: 200, reservedCash: 500, topOpportunityId: "opp-1", topOpportunityScore: 0.8 }),
  strategies: section({ totalTrades: 10, totalNetPnl: 12, portfolioCaptureRatio: 0.8, blockedStrategies: 0, warningStrategies: 0 }),
  committee: section({ decision: "APPROVE", confidence: 0.8, edge: 0.1, risk: 0.2, conflictLevel: "LOW" }),
  execution: section({ fillQuality: 0.95, slippageBps: 2, latencyMs: 100 }),
  research: section({ walkForwardPassed: true, monteCarloPassed: true, costStressPassed: true, paperPromotionEligible: true }),
  risk: section({ killSwitchActive: false, dailyDrawdownRatio: 0.01, liquidationBufferRatio: 1, portfolioHeatRatio: 0.2 }),
  warnings: [],
  ...overrides
});

test("builds a versioned immutable PAPER envelope", () => {
  const result = buildAiCioCommandCenterEnvelope({ mode: "PAPER", snapshot: snapshot(), maximumAgeMs: 500 }, 1_100);
  assert.equal(result.version, 1);
  assert.equal(result.expiresAt, 1_500);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.snapshot));
  assert.ok(Object.isFrozen(result.snapshot.portfolio));
});

test("rejects stale and future snapshots", () => {
  assert.throws(() => buildAiCioCommandCenterEnvelope({ mode: "PAPER", snapshot: snapshot(), maximumAgeMs: 50 }, 1_100), /stale/);
  assert.throws(() => buildAiCioCommandCenterEnvelope({ mode: "PAPER", snapshot: snapshot({ generatedAt: 1_200 }), maximumAgeMs: 500 }, 1_100), /future/);
});

test("validates transport version, expiry, and timestamp integrity", () => {
  const result = buildAiCioCommandCenterEnvelope({ mode: "DRY_RUN", snapshot: snapshot(), maximumAgeMs: 500 }, 1_100);
  assert.deepEqual(validateAiCioCommandCenterEnvelope(result, 1_200), result);
  assert.throws(() => validateAiCioCommandCenterEnvelope({ ...result, version: 2 }, 1_200), /unsupported/);
  assert.throws(() => validateAiCioCommandCenterEnvelope({ ...result, snapshot: { ...result.snapshot, generatedAt: 999 } }, 1_200), /mismatch/);
  assert.throws(() => validateAiCioCommandCenterEnvelope(result, 1_501), /stale/);
});

test("clones the source so later mutation cannot alter the envelope", () => {
  const source = snapshot();
  const result = buildAiCioCommandCenterEnvelope({ mode: "PAPER", snapshot: source, maximumAgeMs: 500 }, 1_100);
  source.portfolio.totalEquity = 999_999;
  assert.equal(result.snapshot.portfolio.totalEquity, 1_000);
});
