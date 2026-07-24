const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { createPaperTradingHttpServer } = require("../dist/apps/server/src/httpServer.js");
const { PaperRuntime } = require("../dist/apps/server/src/paperRuntime.js");

function fakeCandle(overrides = {}) {
  return {
    market: "KRW-BTC",
    candle_date_time_utc: "2026-07-24T00:01:00",
    opening_price: 100_000_000,
    high_price: 100_100_000,
    low_price: 99_900_000,
    trade_price: 100_000_000,
    candle_acc_trade_volume: 1,
    unit: 1,
    ...overrides
  };
}

async function withServer(t, run) {
  const dir = mkdtempSync(join(tmpdir(), "dokkaebi-server-test-"));
  const runtime = new PaperRuntime({
    databasePath: join(dir, "test.db"),
    pollIntervalMs: 60_000,
    candleFetcher: async () => [fakeCandle()]
  });
  const server = createPaperTradingHttpServer(runtime, dir);
  await new Promise((resolveListen) => server.listen(0, resolveListen));
  const port = server.address().port;
  // Trigger (and await) exactly one real poll cycle deterministically instead of racing start()'s timer.
  await new Promise((resolveWarm) => {
    const check = () => (runtime.getMarket().status === "CONNECTED" ? resolveWarm() : setTimeout(check, 5));
    runtime.start();
    check();
  });
  try {
    await run(`http://127.0.0.1:${port}`, runtime);
  } finally {
    runtime.dispose();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("GET /api/health, /api/market, /api/account respond over a real listening server", async (t) => {
  await withServer(t, async (base) => {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.deepEqual(health, { status: "ok" });

    const market = await (await fetch(`${base}/api/market`)).json();
    assert.equal(market.status, "CONNECTED");
    assert.equal(market.price, 100_000_000);

    const accountResponse = await fetch(`${base}/api/account`);
    assert.equal(accountResponse.status, 200);
    const account = await accountResponse.json();
    assert.equal(account.cash, 10_000_000);
    assert.equal(account.equity, 10_000_000);
  });
});

test("POST /api/orders places a real order through the full stack and persists it", async (t) => {
  await withServer(t, async (base, runtime) => {
    const response = await fetch(`${base}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ side: "BUY", quantity: 0.001 })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.order.side, "BUY");
    assert.ok(body.order.quantity > 0);
    assert.ok(body.account.position.quantity > 0);

    const account = await (await fetch(`${base}/api/account`)).json();
    assert.equal(account.orders.length, 1);
  });
});

test("GET /api/reference-accounting mirrors a manual order (PaperRuntime folds it in, audit-only)", async (t) => {
  await withServer(t, async (base) => {
    const before = await (await fetch(`${base}/api/reference-accounting`)).json();
    assert.equal(before.portfolio.quantity, 0);
    assert.equal(before.portfolio.cash, 10_000_000);

    const orderResponse = await (await fetch(`${base}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ side: "BUY", quantity: 0.001 })
    })).json();

    const after = await (await fetch(`${base}/api/reference-accounting`)).json();
    const account = await (await fetch(`${base}/api/account`)).json();
    assert.equal(after.portfolio.quantity, orderResponse.order.quantity);
    assert.equal(after.portfolio.quantity, account.position.quantity, "reference mirrors the real account's position");
    assert.equal(after.portfolio.cash, account.cash, "reference mirrors the real account's cash");
  });
});

test("a rejected manual order (insufficient position) is also recorded in the reference ledger as a no-op", async (t) => {
  await withServer(t, async (base) => {
    const response = await fetch(`${base}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ side: "SELL", quantity: 1 })
    });
    assert.equal(response.status, 400);

    const after = await (await fetch(`${base}/api/reference-accounting`)).json();
    assert.equal(after.portfolio.quantity, 0);
    assert.equal(after.portfolio.cash, 10_000_000);
  });
});

test("invalid JSON body returns 400 instead of crashing the server", async (t) => {
  await withServer(t, async (base) => {
    const response = await fetch(`${base}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json"
    });
    assert.equal(response.status, 400);
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.deepEqual(health, { status: "ok" });
  });
});

test("unknown API route is 404; path traversal on static files is rejected", async (t) => {
  await withServer(t, async (base) => {
    assert.equal((await fetch(`${base}/api/does-not-exist`)).status, 404);
    assert.equal((await fetch(`${base}/../../etc/passwd`)).status, 404);
  });
});
