const test = require("node:test");
const assert = require("node:assert/strict");
const { PaperTradingExecutionLoop } = require("../dist/apps/cloud/src/paperTradingExecutionLoop.js");
const { startCloudRuntime } = require("../dist/apps/cloud/src/runtime.js");

function testEnv(token, port) {
  return {
    NUSA_CLOUD_DASHBOARD_HOST: "127.0.0.1",
    NUSA_CLOUD_DASHBOARD_PORT: String(port),
    NUSA_CLOUD_DASHBOARD_TOKEN: token,
    NUSA_CLOUD_STATE_DB_PATH: ":memory:",
    NUSA_CLOUD_UPBIT_PUBLIC_DATA: "false",
    NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW: "1000000"
  };
}

async function loadOperations(handle, token) {
  const response = await fetch(`http://${handle.host}:${handle.port}/api/paper-operations`, {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(response.status, 200);
  return response.json();
}

test("read-only portfolio representative skips a closed position sorted before an open position", async () => {
  const token = ["p8", "open", "representative", "position", "fixture"].join("-");
  const restoredState = Object.freeze({
    version: 1,
    initialCapital: 1000000,
    cash: 780000,
    equity: 1000000,
    realizedPnL: 3000,
    unrealizedPnL: 20000,
    positions: Object.freeze([
      Object.freeze({ market: "KRW-BTC", quantity: 0, averageEntryPrice: 200000, realizedPnL: 1000, unrealizedPnL: 0, markPrice: 220000 }),
      Object.freeze({ market: "KRW-ETH", quantity: 2, averageEntryPrice: 100000, realizedPnL: 2000, unrealizedPnL: 20000, markPrice: 110000 })
    ]),
    orders: Object.freeze([]),
    fills: Object.freeze([]),
    processedIdempotencyKeys: Object.freeze([]),
    updatedAt: 1000
  });
  const paperLoop = new PaperTradingExecutionLoop({ initialCapital: 1000000, restoredState });
  const handle = startCloudRuntime(testEnv(token, 41945), undefined, undefined, undefined, undefined, undefined, paperLoop);
  try {
    const body = await loadOperations(handle, token);
    assert.equal(body.liveAuthority, "NONE");
    assert.equal(body.productionMutationAllowed, false);
    assert.equal(body.portfolio.account.assetValue, 220000);
    assert.equal(body.portfolio.account.realizedPnl, 3000);
    assert.equal(body.portfolio.account.position.market, "KRW-ETH");
    assert.equal(body.portfolio.account.position.quantity, 2);
    assert.equal(body.portfolio.account.position.realizedPnl, 2000);
    assert.equal(body.portfolio.account.position.unrealizedPnl, 20000);
  } finally {
    await handle.stop();
  }
});
