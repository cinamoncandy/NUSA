const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPaperDashboardSections } = require("../dist/apps/desktop/src/paperDashboardProjection.js");
const { AiCioSnapshotPublisher } = require("../dist/apps/desktop/src/aiCioSnapshotPublisher.js");

const input = (overrides = {}) => ({
  generatedAt: 10_000,
  markPrice: 120,
  referenceEquity: 1_000,
  runtimeAvailable: true,
  account: {
    cash: 880,
    equity: 1_120,
    unrealizedPnl: 40,
    position: { market: "KRW-BTC", quantity: 2, averagePrice: 100, realizedPnl: 10 },
    orders: [{ id: "1" }]
  },
  control: { status: "RUNNING", strategyId: "sma", autoTradeEnabled: false, orderQuantity: 0.1, events: [] },
  ...overrides
});

test("projects only verified Paper portfolio values and marks missing engines unavailable", () => {
  const result = buildPaperDashboardSections(input());
  assert.equal(result.portfolio.availability, "AVAILABLE");
  assert.equal(result.portfolio.totalEquity, 1_120);
  assert.equal(result.portfolio.deployableCapital + result.portfolio.reservedCapital, result.portfolio.totalEquity);
  assert.equal(result.portfolio.grossExposureRatio, 240 / 1_120);
  for (const name of ["strategies", "committee", "research"]) {
    assert.equal(result[name].availability, "UNAVAILABLE");
  }
  assert.equal(result.opportunities.availability, "AVAILABLE");
  assert.equal(result.opportunities.activeCount, 1);
  assert.equal(result.opportunities.totalAllocatedCapital, 240);
  assert.equal(result.opportunities.topOpportunityId, "paper:KRW-BTC");
  assert.equal(result.execution.availability, "AVAILABLE");
  assert.equal(result.execution.fillQuality, 1);
  assert.deepEqual(result.execution.reasons, ["PAPER_SYNTHETIC_EXECUTION"]);
  assert.equal(result.risk.availability, "AVAILABLE");
  assert.equal(result.risk.dailyDrawdownRatio, 0);
  assert.equal(result.risk.portfolioHeatRatio, 240 / 1_120);
  assert.equal(result.risk.liquidationBufferRatio, 1);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.portfolio));
});

test("incomplete operational sources publish a visible BLOCKED snapshot, never healthy", () => {
  let published = null;
  const publisher = new AiCioSnapshotPublisher({ publish(value) { published = value; }, clear() { published = null; } }, {
    mode: "PAPER",
    maximumSectionAgeMs: 1_000,
    maximumEnvelopeAgeMs: 500
  });
  const envelope = publisher.publishIfComplete(buildPaperDashboardSections(input()), 10_000);
  assert.equal(envelope.snapshot.status, "BLOCKED");
  assert.equal(envelope.snapshot.tradingPermitted, false);
  assert.equal(published, envelope);
});

test("runtime failure is represented as blocked risk and immutable evidence", () => {
  const result = buildPaperDashboardSections(input({ runtimeAvailable: false }));
  assert.equal(result.portfolio.status, "BLOCKED");
  assert.equal(result.execution.availability, "INVALID");
  assert.equal(result.execution.fillQuality, 0);
  assert.equal(result.risk.availability, "INVALID");
  assert.equal(result.risk.killSwitchActive, true);
  assert.deepEqual(result.risk.reasons, ["PAPER_RUNTIME_UNAVAILABLE"]);
  assert.ok(Object.isFrozen(result.risk.reasons));
  assert.equal(result.opportunities.status, "BLOCKED");
  assert.equal(result.opportunities.availability, "INVALID");
});

test("opportunities reports zero active count and omits topOpportunityId with a flat Paper position", () => {
  const result = buildPaperDashboardSections(input({
    account: {
      cash: 1_120, equity: 1_120, unrealizedPnl: 0,
      position: { market: "KRW-BTC", quantity: 0, averagePrice: 0, realizedPnl: 10 },
      orders: []
    }
  }));
  assert.equal(result.opportunities.activeCount, 0);
  assert.equal(result.opportunities.totalAllocatedCapital, 0);
  assert.equal(result.opportunities.topOpportunityId, undefined);
  assert.equal(result.opportunities.availability, "AVAILABLE");
});

test("projection is deterministic and rejects invalid accounting inputs", () => {
  assert.deepEqual(buildPaperDashboardSections(input()), buildPaperDashboardSections(input()));
  assert.throws(() => buildPaperDashboardSections(input({ markPrice: 0 })), /markPrice/);
  assert.throws(() => buildPaperDashboardSections(input({ referenceEquity: 0 })), /referenceEquity/);
  assert.throws(() => buildPaperDashboardSections(input({ account: { ...input().account, equity: Number.NaN } })), /equity/);
  assert.throws(() => buildPaperDashboardSections(input({ account: { ...input().account, cash: -1 } })), /cash/);
});

test("Paper drawdown is deterministic and capped for a depleted account", () => {
  const loss = buildPaperDashboardSections(input({
    referenceEquity: 2_000,
    account: { ...input().account, cash: 260, equity: 500 }
  }));
  assert.equal(loss.risk.dailyDrawdownRatio, 0.75);
  assert.equal(loss.risk.killSwitchActive, false);
});

test("strategyWarmup connects the real SMA warm-up state to the strategies section, leaving committee unavailable", () => {
  const warmingUp = buildPaperDashboardSections(input({ strategyWarmup: { current: 3, required: 20 } }));
  assert.equal(warmingUp.strategies.availability, "AVAILABLE");
  assert.equal(warmingUp.strategies.status, "CAUTION");
  assert.deepEqual(warmingUp.strategies.reasons, ["STRATEGY_WARMING_UP"]);
  assert.equal(warmingUp.strategies.warningStrategies, 1);
  assert.equal(warmingUp.strategies.blockedStrategies, 0);
  // Only the TECHNICAL/SMA source is connected; the other ten committee roles remain honestly unavailable.
  assert.equal(warmingUp.committee.availability, "UNAVAILABLE");
  assert.deepEqual(warmingUp.committee.reasons, ["SOURCE_NOT_CONNECTED"]);

  const warmedUp = buildPaperDashboardSections(input({ strategyWarmup: { current: 20, required: 20 } }));
  assert.equal(warmedUp.strategies.status, "HEALTHY");
  assert.deepEqual(warmedUp.strategies.reasons, []);
  assert.equal(warmedUp.strategies.warningStrategies, 0);
});

test("strategyWarmup reports a stopped or paused strategy as caution, and a faulted control plane as blocked", () => {
  const stopped = buildPaperDashboardSections(input({
    strategyWarmup: { current: 20, required: 20 },
    control: { status: "STOPPED", strategyId: "sma", autoTradeEnabled: false, orderQuantity: 0.1, events: [] }
  }));
  assert.equal(stopped.strategies.status, "CAUTION");
  assert.deepEqual(stopped.strategies.reasons, ["STRATEGY_STOPPED"]);

  const faulted = buildPaperDashboardSections(input({
    strategyWarmup: { current: 20, required: 20 },
    control: { status: "FAULTED", strategyId: "sma", autoTradeEnabled: false, orderQuantity: 0.1, events: [] }
  }));
  assert.equal(faulted.strategies.status, "BLOCKED");
  assert.deepEqual(faulted.strategies.reasons, ["CONTROL_PLANE_FAULTED"]);
  assert.equal(faulted.strategies.blockedStrategies, 1);
});

test("preserves an explicitly verified research section instead of replacing it with a placeholder", () => {
  const research = Object.freeze({
    status: "BLOCKED", availability: "AVAILABLE", generatedAt: 10_000,
    reasons: Object.freeze(["MONTE_CARLO_EVIDENCE_NOT_RECORDED"]),
    walkForwardPassed: true, monteCarloPassed: false, costStressPassed: true, paperPromotionEligible: false
  });
  const result = buildPaperDashboardSections(input({ research }));
  assert.equal(result.research, research);
  assert.equal(result.research.availability, "AVAILABLE");
  assert.equal(result.research.paperPromotionEligible, false);
});
