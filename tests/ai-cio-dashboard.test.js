const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAiCioDashboard } = require("../dist/apps/cloud/src/dashboardAggregator.js");
const { buildAiCioDashboardViewModel } = require("../dist/apps/mobile/src/aiCioDashboard.js");

const section = (overrides = {}) => ({ status: "HEALTHY", generatedAt: 1_000, reasons: [], ...overrides });
const input = (overrides = {}) => ({
  generatedAt: 1_000,
  maximumSectionAgeMs: 5_000,
  portfolio: section({ totalEquity: 10_000, deployableCapital: 7_000, reservedCapital: 2_000, grossExposureRatio: 0.4, netExposureRatio: 0.25 }),
  opportunities: section({ activeCount: 2, totalAllocatedCapital: 3_000, reservedCash: 4_000, topOpportunityId: "BTC", topOpportunityScore: 0.8 }),
  strategies: section({ totalTrades: 20, totalNetPnl: 120, portfolioCaptureRatio: 0.8, blockedStrategies: 0, warningStrategies: 0 }),
  committee: section({ decision: "APPROVE", confidence: 0.8, edge: 0.1, risk: 0.2, conflictLevel: "LOW" }),
  execution: section({ fillQuality: 0.95, slippageBps: 4, latencyMs: 120 }),
  research: section({ walkForwardPassed: true, monteCarloPassed: true, costStressPassed: true, paperPromotionEligible: true }),
  risk: section({ killSwitchActive: false, dailyDrawdownRatio: 0.01, liquidationBufferRatio: 0.8, portfolioHeatRatio: 0.4 }),
  ...overrides
});

test("builds a healthy immutable command center", () => {
  const result = buildAiCioDashboard(input(), 1_500);
  assert.equal(result.status, "HEALTHY");
  assert.equal(result.tradingPermitted, true);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.warnings));
  const view = buildAiCioDashboardViewModel(result);
  assert.equal(view.title, "DOKKAEBI AI CIO");
  assert.equal(view.tradingEnabled, true);
  assert.ok(Object.isFrozen(view.metrics));
});

test("kill switch blocks dashboard trading", () => {
  const result = buildAiCioDashboard(input({ risk: section({ killSwitchActive: true, dailyDrawdownRatio: 0.01, liquidationBufferRatio: 0.8, portfolioHeatRatio: 0.4 }) }), 1_500);
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.tradingPermitted, false);
  assert.ok(result.warnings.includes("KILL_SWITCH_ACTIVE"));
});

test("stale section fails closed", () => {
  const result = buildAiCioDashboard(input({ maximumSectionAgeMs: 100 }), 1_500);
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.tradingPermitted, false);
  assert.ok(result.warnings.some((item) => item.includes("STALE")));
});

test("research gate blocks otherwise healthy dashboard", () => {
  const result = buildAiCioDashboard(input({ research: section({ walkForwardPassed: true, monteCarloPassed: false, costStressPassed: true, paperPromotionEligible: false }) }), 1_500);
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.warnings.includes("RESEARCH_GATE_NOT_PASSED"));
});

test("committee rejection disables trading", () => {
  const result = buildAiCioDashboard(input({ committee: section({ decision: "REJECT", confidence: 0.7, edge: 0.02, risk: 0.6, conflictLevel: "HIGH" }) }), 1_500);
  assert.equal(result.tradingPermitted, false);
});

test("invalid capital and future data fail closed", () => {
  assert.throws(() => buildAiCioDashboard(input({ portfolio: section({ totalEquity: 10_000, deployableCapital: 9_000, reservedCapital: 2_000, grossExposureRatio: 0.4, netExposureRatio: 0.2 }) }), 1_500), /exceed total equity/);
  assert.throws(() => buildAiCioDashboard(input({ risk: section({ generatedAt: 2_000, killSwitchActive: false, dailyDrawdownRatio: 0.01, liquidationBufferRatio: 0.8, portfolioHeatRatio: 0.4 }) }), 1_500), /future/);
});
