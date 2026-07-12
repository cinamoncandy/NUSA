const test = require("node:test");
const assert = require("node:assert/strict");
const { buildFeaturePipeline } = require("../dist/apps/cloud/src/dataFeaturePipeline.js");
const { featuresToCioSignals } = require("../dist/apps/cloud/src/featureCioAdapter.js");
const { evaluateResearchPromotion } = require("../dist/apps/cloud/src/researchPromotionGate.js");

const observation = (overrides = {}) => ({
  id: "obs-1",
  source: "MARKET",
  symbol: "BTCUSDT",
  feature: "momentum_5m",
  value: 0.4,
  observedAt: 900,
  cadenceMs: 100,
  unit: "score",
  provider: "binance",
  ...overrides
});

test("builds deterministic provenance and marks stale features", () => {
  const a = buildFeaturePipeline(1000, [observation()]);
  const b = buildFeaturePipeline(1000, [observation()]);
  assert.deepEqual(a, b);
  assert.equal(a.features[0].quality, "GOOD");
  const stale = buildFeaturePipeline(2000, [observation()]);
  assert.equal(stale.features[0].quality, "STALE");
  assert.equal(Object.isFrozen(a), true);
  assert.equal(Object.isFrozen(a.features), true);
});

test("rejects duplicate ids and duplicate feature keys", () => {
  assert.throws(() => buildFeaturePipeline(1000, [observation(), observation()]), /duplicate observation id/);
  assert.throws(() => buildFeaturePipeline(1000, [observation(), observation({ id: "obs-2" })]), /duplicate feature key/);
});

test("converts only good validated features into CIO signals", () => {
  const pipeline = buildFeaturePipeline(1000, [
    observation(),
    observation({ id: "obs-2", source: "NEWS", feature: "sentiment", value: 0.8, provider: "newswire" }),
    observation({ id: "obs-3", symbol: "ETHUSDT", feature: "momentum_5m", value: -0.3 })
  ]);
  const signals = featuresToCioSignals(pipeline, "btcusdt");
  assert.deepEqual(signals.map((x) => x.source), ["CHART", "NEWS"]);
  assert.equal(signals[0].score, 0.4);
  assert.equal(Object.isFrozen(signals), true);
});

test("promotion gate blocks stale data and weak research", () => {
  const base = {
    strategyId: "s-1",
    dataFingerprint: "abc",
    currentDataFingerprint: "abc",
    deflatedSharpeRatio: 0.95,
    oosIsRatio: 0.9,
    oosTrades: 50,
    oosProfitFactor: 1.4,
    positiveWalkForwardShare: 0.7,
    monteCarloRuinProbability: 0.01,
    worstCostStressReturn: 0.02,
    paperTradingDays: 0
  };
  assert.equal(evaluateResearchPromotion(base).verdict, "PROMOTE_TO_PAPER");
  assert.equal(evaluateResearchPromotion({ ...base, currentDataFingerprint: "changed" }).verdict, "REJECT_STALE_DATA");
  const weak = evaluateResearchPromotion({ ...base, oosProfitFactor: 1.0 });
  assert.equal(weak.verdict, "KEEP_IN_RESEARCH");
  assert.deepEqual(weak.failedChecks, ["profit_factor"]);
});
