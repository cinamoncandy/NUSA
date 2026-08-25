const test = require("node:test");
const assert = require("node:assert/strict");
const { LiveMarketRegimeObserver } = require("../dist/apps/desktop/src/strategy/liveMarketRegimeObserver.js");

function observeMany(observer, signedChangeRate, count) {
  const results = [];
  for (let index = 0; index < count; index += 1) {
    results.push(observer.observe({ signed_change_rate: signedChangeRate }));
  }
  return results.filter(Boolean);
}

test("live regime evidence requires enough valid Upbit ticks", () => {
  const observer = new LiveMarketRegimeObserver({ minimumValidTicks: 3, trendThreshold: 0.02 });
  assert.deepEqual(observeMany(observer, 0.03, 2), []);
  assert.equal(observer.observe({ signed_change_rate: 0.03 }), "UP_TREND");
});

test("live regime evidence records each objective 24h return bucket once per session", () => {
  const observer = new LiveMarketRegimeObserver({ minimumValidTicks: 1, trendThreshold: 0.02 });
  assert.equal(observer.observe({ signed_change_rate: 0.03 }), "UP_TREND");
  assert.equal(observer.observe({ signed_change_rate: 0.04 }), undefined);
  assert.equal(observer.observe({ signed_change_rate: 0.01 }), "RANGE");
  assert.equal(observer.observe({ signed_change_rate: -0.03 }), "DOWN_TREND");
  assert.equal(observer.observe({ signed_change_rate: -0.05 }), undefined);
});

test("missing or non-finite change rate cannot create regime evidence", () => {
  const observer = new LiveMarketRegimeObserver({ minimumValidTicks: 1, trendThreshold: 0.02 });
  assert.equal(observer.observe({}), undefined);
  assert.equal(observer.observe({ signed_change_rate: Number.NaN }), undefined);
  assert.equal(observer.observe({ signed_change_rate: Number.POSITIVE_INFINITY }), undefined);
  assert.equal(observer.observe({ signed_change_rate: 0 }), "RANGE");
});

test("live regime observer rejects unsafe configuration", () => {
  assert.throws(() => new LiveMarketRegimeObserver({ minimumValidTicks: 0, trendThreshold: 0.02 }), /minimumValidTicks/);
  assert.throws(() => new LiveMarketRegimeObserver({ minimumValidTicks: 1, trendThreshold: 0 }), /trendThreshold/);
});
