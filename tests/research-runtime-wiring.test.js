const test = require("node:test");
const assert = require("node:assert/strict");
const { startCloudRuntime } = require("../dist/apps/cloud/src/runtime.js");

test("cloud runtime forwards the same public ticker path to the research runtime", async () => {
  let onTicker;
  let stopped = false;
  const ticks = [];
  const factory = (markets, tickerHandler) => {
    assert.deepEqual(markets, ["KRW-BTC"]);
    onTicker = tickerHandler;
    return { subscribe() {}, start() {}, stop() { stopped = true; } };
  };
  const runtime = { onMarketData(tick) { ticks.push(tick); } };
  const handle = startCloudRuntime({ NUSA_CLOUD_DASHBOARD_PORT: "41911", NUSA_CLOUD_DASHBOARD_TOKEN: "test", NUSA_CLOUD_UPBIT_PUBLIC_DATA: "true", NUSA_CLOUD_UPBIT_MARKETS: "KRW-BTC" }, undefined, undefined, factory, undefined, undefined, undefined, runtime);
  try {
    onTicker({ type: "ticker", code: "KRW-BTC", trade_price: 100, trade_timestamp: Date.now(), signed_change_rate: 0 });
    assert.equal(ticks.length, 1);
    assert.equal(ticks[0].market, "KRW-BTC");
    assert.equal(ticks[0].price, 100);
    assert.equal(ticks[0].observedAt <= ticks[0].now, true);
  } finally { await handle.stop(); }
  assert.equal(stopped, true);
});
