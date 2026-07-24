const test = require("node:test");
const assert = require("node:assert/strict");
const { handleApiRequest } = require("../dist/apps/server/src/apiRouter.js");

function fakeRuntime(overrides = {}) {
  return {
    getMarket: () => ({ status: "CONNECTED", price: 100 }),
    getChartCandles: () => [{ open: 1 }],
    getAccountSnapshot: () => ({ cash: 1 }),
    getControlSnapshot: () => ({ status: "STOPPED" }),
    getDashboard: () => ({ portfolio: {} }),
    placeOrder: (side, quantity) => ({ order: { side, quantity } }),
    startStrategy: () => ({ status: "RUNNING" }),
    stopStrategy: () => ({ status: "STOPPED" }),
    setAutoTrade: (enabled) => ({ autoTradeEnabled: enabled }),
    setOrderQuantity: (quantity) => ({ orderQuantity: quantity }),
    selectStrategy: (choice) => ({ activeStrategyId: choice }),
    ...overrides
  };
}

test("GET routes dispatch to the matching runtime method", () => {
  const runtime = fakeRuntime();
  assert.deepEqual(handleApiRequest({ method: "GET", pathname: "/api/health", body: undefined }, runtime), { status: 200, body: { status: "ok" } });
  assert.deepEqual(handleApiRequest({ method: "GET", pathname: "/api/market", body: undefined }, runtime).body, { status: "CONNECTED", price: 100 });
  assert.deepEqual(handleApiRequest({ method: "GET", pathname: "/api/account", body: undefined }, runtime).body, { cash: 1 });
  assert.deepEqual(handleApiRequest({ method: "GET", pathname: "/api/control", body: undefined }, runtime).body, { status: "STOPPED" });
  assert.deepEqual(handleApiRequest({ method: "GET", pathname: "/api/dashboard", body: undefined }, runtime).body, { portfolio: {} });
  assert.deepEqual(handleApiRequest({ method: "GET", pathname: "/api/chart/candles", body: undefined }, runtime).body, { candles: [{ open: 1 }] });
});

test("unknown path is 404, known path with wrong method is 405", () => {
  const runtime = fakeRuntime();
  assert.equal(handleApiRequest({ method: "GET", pathname: "/api/nope", body: undefined }, runtime).status, 404);
  assert.equal(handleApiRequest({ method: "GET", pathname: "/api/orders", body: undefined }, runtime).status, 405);
  assert.equal(handleApiRequest({ method: "DELETE", pathname: "/api/health", body: undefined }, runtime).status, 405);
});

test("POST /api/orders validates side and quantity before calling placeOrder", () => {
  const runtime = fakeRuntime();
  const good = handleApiRequest({ method: "POST", pathname: "/api/orders", body: { side: "BUY", quantity: 0.001 } }, runtime);
  assert.equal(good.status, 200);
  assert.deepEqual(good.body, { order: { side: "BUY", quantity: 0.001 } });

  assert.equal(handleApiRequest({ method: "POST", pathname: "/api/orders", body: { side: "HOLD", quantity: 1 } }, runtime).status, 400);
  assert.equal(handleApiRequest({ method: "POST", pathname: "/api/orders", body: { side: "BUY", quantity: "1" } }, runtime).status, 400);
  assert.equal(handleApiRequest({ method: "POST", pathname: "/api/orders", body: null }, runtime).status, 400);
});

test("POST /api/strategy/auto-trade and /api/strategy/quantity validate types", () => {
  const runtime = fakeRuntime();
  assert.equal(handleApiRequest({ method: "POST", pathname: "/api/strategy/auto-trade", body: { enabled: "yes" } }, runtime).status, 400);
  assert.deepEqual(handleApiRequest({ method: "POST", pathname: "/api/strategy/auto-trade", body: { enabled: true } }, runtime).body, { autoTradeEnabled: true });
  assert.equal(handleApiRequest({ method: "POST", pathname: "/api/strategy/quantity", body: { quantity: "x" } }, runtime).status, 400);
  assert.deepEqual(handleApiRequest({ method: "POST", pathname: "/api/strategy/quantity", body: { quantity: 0.01 } }, runtime).body, { orderQuantity: 0.01 });
});

test("POST /api/strategy/select validates against the known strategy choices", () => {
  const runtime = fakeRuntime();
  assert.equal(handleApiRequest({ method: "POST", pathname: "/api/strategy/select", body: { choice: "macd-cross" } }, runtime).status, 400);
  assert.deepEqual(handleApiRequest({ method: "POST", pathname: "/api/strategy/select", body: { choice: "ema-crossover" } }, runtime).body, { activeStrategyId: "ema-crossover" });
});

test("thrown domain errors map to 503 when unavailable/stale, 400 otherwise", () => {
  const unavailableRuntime = fakeRuntime({ getAccountSnapshot: () => { throw new Error("market price is not available yet"); } });
  assert.equal(handleApiRequest({ method: "GET", pathname: "/api/account", body: undefined }, unavailableRuntime).status, 503);

  const staleRuntime = fakeRuntime({ getDashboard: () => { throw new Error("market price is stale; waiting for a fresh update"); } });
  assert.equal(handleApiRequest({ method: "GET", pathname: "/api/dashboard", body: undefined }, staleRuntime).status, 503);

  const rejectedOrder = fakeRuntime({ placeOrder: () => { throw new Error("insufficient paper cash"); } });
  assert.equal(handleApiRequest({ method: "POST", pathname: "/api/orders", body: { side: "BUY", quantity: 1 } }, rejectedOrder).status, 400);
});
