const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getLocalPaperLearningEvents,
  getLocalPaperLearningReadiness,
  recordLocalPaperPublicMarkets,
  resetLocalPaperLearningEventsForTest,
} = require("../dist/apps/mobile/src/localPaperLearningProjection.js");
const { buildPaperLearningScreen } = require("../dist/apps/mobile/src/paperLearningScreen.js");

const market = (timestamp = 1_700_000_000_000) => Object.freeze({
  market: "KRW-BTC",
  price: 100_000_000,
  changeRate: 0.01,
  volume: 12.5,
  observedAt: new Date(timestamp).toISOString(),
  source: "UPBIT_PUBLIC_TICKER",
});

test("LOCAL PAPER trusted public market input leaves PAUSED/NO DATA without inventing fills", () => {
  resetLocalPaperLearningEventsForTest();
  const observedAt = 1_700_000_000_000;
  recordLocalPaperPublicMarkets([market(observedAt)]);

  const events = getLocalPaperLearningEvents();
  assert.equal(events.length, 3);
  assert.deepEqual(new Set(events.map((event) => event.stage)), new Set(["MARKET_DATA", "DECISION", "LEARNING"]));
  assert.ok(events.every((event) => event.market === "KRW-BTC"));
  assert.ok(events.every((event) => event.strategyId === "LOCAL_PUBLIC_OBSERVER_V1"));

  const readiness = getLocalPaperLearningReadiness(observedAt + 3);
  assert.deepEqual(readiness, { dataReady: true, status: "RUNNING", reason: "LOCAL_PUBLIC_MARKET_DATA_READY", lastObservedAt: observedAt });
  const screen = buildPaperLearningScreen([], readiness.status);
  assert.equal(screen.status, "RUNNING");
  assert.equal(screen.timeline.length, 3);
  assert.equal(screen.recentCycles.length, 1);
  assert.equal(screen.performance.completedCycles, 0);
  assert.ok(screen.timeline.some((event) => event.stage === "LEARNING"));
  assert.equal(screen.latestDecision.action, "HOLD");
  assert.equal(screen.latestDecision.allocation, 0);
  assert.equal(screen.latestFill, null);
  assert.equal(screen.latestAccount, null);
});

test("LOCAL PAPER remains paused until public data is valid and recent", () => {
  resetLocalPaperLearningEventsForTest();
  assert.deepEqual(getLocalPaperLearningReadiness(1_700_000_000_000), { dataReady: false, status: "PAUSED", reason: "LOCAL_PUBLIC_MARKET_DATA_UNAVAILABLE", lastObservedAt: null });

  const observedAt = 1_700_000_000_000;
  recordLocalPaperPublicMarkets([market(observedAt)]);
  assert.equal(getLocalPaperLearningReadiness(observedAt + 120_001).status, "PAUSED");
  assert.equal(getLocalPaperLearningReadiness(observedAt + 120_000).dataReady, true);
});

test("LOCAL PAPER projection dedupes repeated ticker refresh and ignores unrelated markets", () => {
  resetLocalPaperLearningEventsForTest();
  const btc = market();
  recordLocalPaperPublicMarkets([btc]);
  recordLocalPaperPublicMarkets([btc]);
  assert.equal(getLocalPaperLearningEvents().length, 3);

  recordLocalPaperPublicMarkets([{ ...market(1_700_000_100_000), market: "KRW-ETH" }]);
  assert.equal(getLocalPaperLearningEvents().length, 3);
});
