const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPaperDashboardSections } = require("../dist/apps/desktop/src/paperDashboardProjection.js");
const { AiCioSnapshotPublisher } = require("../dist/apps/desktop/src/aiCioSnapshotPublisher.js");

const input = (overrides = {}) => ({
  generatedAt: 10_000,
  markPrice: 120,
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
  for (const name of ["opportunities", "strategies", "committee", "execution", "research", "risk"]) {
    assert.equal(result[name].availability, "UNAVAILABLE");
  }
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
  assert.equal(result.risk.killSwitchActive, true);
  assert.deepEqual(result.risk.reasons, ["PAPER_RUNTIME_UNAVAILABLE"]);
  assert.ok(Object.isFrozen(result.risk.reasons));
});

test("projection is deterministic and rejects invalid accounting inputs", () => {
  assert.deepEqual(buildPaperDashboardSections(input()), buildPaperDashboardSections(input()));
  assert.throws(() => buildPaperDashboardSections(input({ markPrice: 0 })), /markPrice/);
  assert.throws(() => buildPaperDashboardSections(input({ account: { ...input().account, equity: Number.NaN } })), /equity/);
  assert.throws(() => buildPaperDashboardSections(input({ account: { ...input().account, cash: -1 } })), /cash/);
});
