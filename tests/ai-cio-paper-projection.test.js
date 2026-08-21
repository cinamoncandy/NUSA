const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPaperDashboardSections } = require("../dist/apps/desktop/src/paper/paperDashboardProjection.js");
const { AiCioSnapshotPublisher } = require("../dist/apps/desktop/src/ai/aiCioSnapshotPublisher.js");
const { buildStrategyAnalytics } = require("../dist/apps/desktop/src/strategy/strategyAnalytics.js");

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
  assert.equal(result.opportunities.availability, "UNAVAILABLE");
  assert.equal(result.opportunities.status, "BLOCKED");
  assert.deepEqual(result.opportunities.reasons, ["OPPORTUNITY_ANALYTICS_NOT_CONNECTED"]);
  assert.equal(result.opportunities.activeCount, 0);
  assert.equal(result.opportunities.totalAllocatedCapital, 0);
  assert.equal(result.execution.availability, "AVAILABLE");
  assert.equal(result.execution.fillQuality, 1);
  assert.equal(result.execution.slippageBps, 0);
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

test("unconnected opportunities never infer analytics from a flat Paper position", () => {
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
  assert.equal(result.opportunities.availability, "UNAVAILABLE");
  assert.equal(result.opportunities.status, "BLOCKED");
});

test("verified opportunity analytics can be projected without being recomputed", () => {
  const opportunity = Object.freeze({
    status: "HEALTHY", availability: "AVAILABLE", generatedAt: 10_000, reasons: [],
    activeCount: 2, totalAllocatedCapital: 240, reservedCash: 10,
    topOpportunityId: "opp-1", topOpportunityScore: 0.75
  });
  const result = buildPaperDashboardSections(input({ opportunity }));
  assert.equal(result.opportunities, opportunity);
});

test("projects a validated opportunity schedule without inferring from the paper account", () => {
  const result = buildPaperDashboardSections(input({ opportunitySchedule: {
    mode: "PAPER", totalAllocation: 100, reservedCash: 900,
    opportunities: [{ id: "opp-1", asset: "KRW-BTC", side: "LONG", score: 0.8, allocation: 100, rank: 1, reasons: ["POSITIVE_NET_EDGE"] }],
    rejected: []
  } }));
  assert.equal(result.opportunities.status, "HEALTHY");
  assert.equal(result.opportunities.activeCount, 1);
  assert.equal(result.opportunities.topOpportunityId, "opp-1");
  assert.equal(result.opportunities.topOpportunityScore, 0.8);
});

test("verified strategy analytics are projected without recomputing the ledger", () => {
  const result = buildPaperDashboardSections(input({
    strategyWarmup: { current: 20, required: 20 },
    strategyAnalytics: buildStrategyAnalytics({ orders: [], strategyId: "sma-crossover", market: "KRW-BTC", markPrice: 120 })
  }));
  assert.equal(result.strategies.availability, "AVAILABLE");
  assert.equal(result.strategies.totalTrades, 0);
  assert.equal(result.strategies.totalNetPnl, 0);
  assert.equal(result.strategies.portfolioCaptureRatio, 1);
});

test("dashboard rejects an altered strategy analytics snapshot", () => {
  const source = buildStrategyAnalytics({ orders: [], strategyId: "sma-crossover", market: "KRW-BTC", markPrice: 120 });
  assert.throws(() => buildPaperDashboardSections(input({ strategyWarmup: { current: 20, required: 20 }, strategyAnalytics: { ...source, netPnl: 1 } })), /strategy analytics verification/);
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

const strategyAnalytics = buildStrategyAnalytics({ orders: [], strategyId: "sma-crossover", market: "KRW-BTC", markPrice: 120 });

test("strategyWarmup connects the real SMA warm-up state when verified analytics are present", () => {
  const warmingUp = buildPaperDashboardSections(input({ strategyWarmup: { current: 3, required: 20 }, strategyAnalytics }));
  assert.equal(warmingUp.strategies.availability, "AVAILABLE");
  assert.equal(warmingUp.strategies.status, "CAUTION");
  assert.deepEqual(warmingUp.strategies.reasons, ["STRATEGY_WARMING_UP"]);
  assert.equal(warmingUp.strategies.warningStrategies, 1);
  assert.equal(warmingUp.strategies.blockedStrategies, 0);
  // Only the TECHNICAL/SMA source is connected; the other ten committee roles remain honestly unavailable.
  assert.equal(warmingUp.committee.availability, "UNAVAILABLE");
  assert.deepEqual(warmingUp.committee.reasons, ["SOURCE_NOT_CONNECTED"]);

  const warmedUp = buildPaperDashboardSections(input({ strategyWarmup: { current: 20, required: 20 }, strategyAnalytics }));
  assert.equal(warmedUp.strategies.status, "HEALTHY");
  assert.deepEqual(warmedUp.strategies.reasons, []);
  assert.equal(warmedUp.strategies.warningStrategies, 0);
});

test("strategyWarmup reports a stopped or paused strategy as caution, and a faulted control plane as blocked", () => {
  const stopped = buildPaperDashboardSections(input({
    strategyWarmup: { current: 20, required: 20 },
    strategyAnalytics,
    control: { status: "STOPPED", strategyId: "sma", autoTradeEnabled: false, orderQuantity: 0.1, events: [] }
  }));
  assert.equal(stopped.strategies.status, "CAUTION");
  assert.deepEqual(stopped.strategies.reasons, ["STRATEGY_STOPPED"]);

  const faulted = buildPaperDashboardSections(input({
    strategyWarmup: { current: 20, required: 20 },
    strategyAnalytics,
    control: { status: "FAULTED", strategyId: "sma", autoTradeEnabled: false, orderQuantity: 0.1, events: [] }
  }));
  assert.equal(faulted.strategies.status, "BLOCKED");
  assert.deepEqual(faulted.strategies.reasons, ["CONTROL_PLANE_FAULTED"]);
  assert.equal(faulted.strategies.blockedStrategies, 1);
});

test("warm-up without strategy-attributed analytics stays unavailable", () => {
  const result = buildPaperDashboardSections(input({ strategyWarmup: { current: 20, required: 20 } }));
  assert.equal(result.strategies.availability, "UNAVAILABLE");
  assert.equal(result.strategies.status, "BLOCKED");
  assert.deepEqual(result.strategies.reasons, ["STRATEGY_ANALYTICS_NOT_CONNECTED"]);
});

test("executionCostBps connects the real deterministic fill-model rate, staying labeled synthetic", () => {
  const connected = buildPaperDashboardSections(input({ executionCostBps: 7.5 }));
  assert.equal(connected.execution.slippageBps, 7.5);
  assert.deepEqual(connected.execution.reasons, ["PAPER_SYNTHETIC_EXECUTION"]);
  assert.equal(connected.execution.latencyMs, 0);

  assert.throws(() => buildPaperDashboardSections(input({ executionCostBps: -1 })), /executionCostBps/);
  assert.throws(() => buildPaperDashboardSections(input({ executionCostBps: Number.NaN })), /executionCostBps/);
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
