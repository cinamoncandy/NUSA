const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAiCioDashboard } = require("../dist/apps/cloud/src/dashboardAggregator.js");
const { buildAiCioDashboardViewModel } = require("../dist/apps/mobile/src/aiCioDashboard.js");

const section = (overrides = {}) => ({ status: "HEALTHY", generatedAt: 1_000, reasons: [], ...overrides });
const input = (overrides = {}) => ({
  generatedAt: 1_000,
  maximumSectionAgeMs: 5_000,
  portfolio: section({ totalEquity: 10_000, deployableCapital: 7_000, reservedCapital: 3_000, grossExposureRatio: 0.4, netExposureRatio: 0.25 }),
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
  assert.equal(view.title, "NUSA AI CIO");
  assert.equal(view.tradingEnabled, true);
  assert.ok(Object.isFrozen(view.metrics));
});

test("kill switch blocks dashboard trading", () => {
  const result = buildAiCioDashboard(input({ risk: section({ killSwitchActive: true, dailyDrawdownRatio: 0.01, liquidationBufferRatio: 0.8, portfolioHeatRatio: 0.4 }) }), 1_500);
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.tradingPermitted, false);
  assert.ok(result.warnings.includes("KILL_SWITCH_ACTIVE"));
});

test("stale section cautions and disables trading", () => {
  const result = buildAiCioDashboard(input({ maximumSectionAgeMs: 100 }), 1_500);
  assert.equal(result.status, "CAUTION");
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
  assert.throws(() => buildAiCioDashboard(input({ portfolio: section({ totalEquity: 10_000, deployableCapital: 9_000, reservedCapital: 2_000, grossExposureRatio: 0.4, netExposureRatio: 0.2 }) }), 1_500), /must equal total equity/);
  assert.throws(() => buildAiCioDashboard(input({ risk: section({ generatedAt: 2_000, killSwitchActive: false, dailyDrawdownRatio: 0.01, liquidationBufferRatio: 0.8, portfolioHeatRatio: 0.4 }) }), 1_500), /future/);
});


test("all unavailable sections produce NO_DATA without invented health", () => {
  const unavailable = (value) => section({ ...value, availability: "UNAVAILABLE" });
  const result = buildAiCioDashboard(input({
    portfolio: unavailable({ totalEquity: 100_000, deployableCapital: 70_000, reservedCapital: 30_000, grossExposureRatio: 0.4, netExposureRatio: 0.2 }),
    opportunities: unavailable({ activeCount: 0, totalAllocatedCapital: 0, reservedCash: 0 }),
    strategies: unavailable({ totalTrades: 0, totalNetPnl: 0, portfolioCaptureRatio: 0, blockedStrategies: 0, warningStrategies: 0 }),
    committee: unavailable({ decision: "WAIT", confidence: 0, edge: 0, risk: 0, conflictLevel: "LOW" }),
    execution: unavailable({ fillQuality: 0, slippageBps: 0, latencyMs: 0 }),
    research: unavailable({ walkForwardPassed: false, monteCarloPassed: false, costStressPassed: false, paperPromotionEligible: false }),
    risk: unavailable({ killSwitchActive: false, dailyDrawdownRatio: 0, liquidationBufferRatio: 0, portfolioHeatRatio: 0 })
  }), 1_500);
  assert.equal(result.status, "NO_DATA");
  assert.equal(result.tradingPermitted, false);
});

test("one unavailable required section blocks and stale availability cautions", () => {
  assert.equal(buildAiCioDashboard(input({ execution: section({ availability: "UNAVAILABLE", fillQuality: 0, slippageBps: 0, latencyMs: 0 }) }), 1_500).status, "BLOCKED");
  assert.equal(buildAiCioDashboard(input({ execution: section({ availability: "STALE", fillQuality: 0.9, slippageBps: 2, latencyMs: 50 }) }), 1_500).status, "CAUTION");
});

test("dashboard rejects section time after aggregation time and both capital mismatch directions", () => {
  assert.throws(() => buildAiCioDashboard(input({ risk: section({ generatedAt: 1_200, killSwitchActive: false, dailyDrawdownRatio: 0, liquidationBufferRatio: 1, portfolioHeatRatio: 0 }) }), 1_500), /future/);
  assert.throws(() => buildAiCioDashboard(input({ portfolio: section({ totalEquity: 100_000, deployableCapital: 60_000, reservedCapital: 30_000, grossExposureRatio: 0, netExposureRatio: 0 }) }), 1_500), /must equal/);
});

test("availability and freshness warnings identify sections by stable names", () => {
  const unavailable = buildAiCioDashboard(input({
    committee: section({ availability: "UNAVAILABLE", decision: "WAIT", confidence: 0, edge: 0, risk: 0, conflictLevel: "HIGH" })
  }), 1_500);
  assert.ok(unavailable.warnings.includes("SECTION_COMMITTEE_UNAVAILABLE"));
  assert.ok(unavailable.warnings.every((warning) => !/^SECTION_\\d+_/.test(warning)));

  const stale = buildAiCioDashboard(input({
    research: section({ availability: "STALE", walkForwardPassed: true, monteCarloPassed: true, costStressPassed: true, paperPromotionEligible: true })
  }), 1_500);
  assert.ok(stale.warnings.includes("SECTION_RESEARCH_STALE"));
});

test("invalid operational metrics fail closed before publication", () => {
  assert.throws(() => buildAiCioDashboard(input({ maximumSectionAgeMs: 0 }), 1_500), /maximumSectionAgeMs/);
  assert.throws(() => buildAiCioDashboard(input({
    opportunities: section({ activeCount: 1, totalAllocatedCapital: -1, reservedCash: 0 })
  }), 1_500), /opportunity capital/);
  assert.throws(() => buildAiCioDashboard(input({
    opportunities: section({ activeCount: 1, totalAllocatedCapital: 1, reservedCash: 0, topOpportunityScore: 1.1 })
  }), 1_500), /topOpportunityScore/);
  assert.throws(() => buildAiCioDashboard(input({
    strategies: section({ totalTrades: 1, totalNetPnl: 0, portfolioCaptureRatio: 0, blockedStrategies: 0.5, warningStrategies: 0 })
  }), 1_500), /safe integers/);
  assert.throws(() => buildAiCioDashboard(input({
    execution: section({ fillQuality: 1, slippageBps: -0.1, latencyMs: 0 })
  }), 1_500), /slippageBps/);
  assert.throws(() => buildAiCioDashboard(input({
    committee: section({ decision: " ", confidence: 0, edge: 0, risk: 0, conflictLevel: "LOW" })
  }), 1_500), /committee labels/);
});
