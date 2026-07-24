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

async function withServer(t, run, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "dokkaebi-server-test-"));
  // Mutable box so a test can move the "market price" between polls (e.g. to trigger
  // stop-loss/take-profit); tests that don't touch it just get a fixed 100,000,000 KRW-BTC.
  const priceBox = { value: options.initialPrice ?? 100_000_000 };
  const runtime = new PaperRuntime({
    databasePath: join(dir, "test.db"),
    pollIntervalMs: options.pollIntervalMs ?? 60_000,
    candleFetcher: async () => [fakeCandle({
      trade_price: priceBox.value,
      opening_price: priceBox.value,
      high_price: priceBox.value + 100_000,
      low_price: priceBox.value - 100_000
    })]
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
    await run(`http://127.0.0.1:${port}`, runtime, priceBox);
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
    assert.equal(after.reconciliation.consistent, true);
    assert.deepEqual(after.reconciliation.discrepancies, []);
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
    assert.equal(after.reconciliation.consistent, true);
  });
});

test("GET /api/equity-history records a sample per candle update, starting near the initial cash", async (t) => {
  await withServer(t, async (base) => {
    const { history, drawdown } = await (await fetch(`${base}/api/equity-history`)).json();
    assert.ok(history.length >= 1, "expected at least the warm-up poll's sample");
    assert.equal(history[0].equity, 10_000_000);
    assert.ok(Number.isFinite(history[0].timestamp));
    assert.equal(drawdown.peakEquity, 10_000_000);
    assert.equal(drawdown.maxDrawdown, 0);
  });
});

test("GET /api/trade-statistics reflects a real BUY-then-SELL round trip through the actual server", async (t) => {
  await withServer(t, async (base) => {
    const buy = await (await fetch(`${base}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ side: "BUY", quantity: 0.001 })
    })).json();

    const sell = await (await fetch(`${base}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ side: "SELL", quantity: buy.order.quantity })
    })).json();

    const stats = await (await fetch(`${base}/api/trade-statistics`)).json();
    assert.equal(stats.totalTrades, 2);
    assert.equal(stats.buyCount, 1);
    assert.equal(stats.sellCount, 1);
    assert.equal(stats.wins + stats.losses, 1);
    assert.ok(Number.isFinite(stats.totalRealizedPnl));
    // The real account's cumulative realizedPnl should match the single closed trade's PnL.
    assert.ok(Math.abs(stats.totalRealizedPnl - sell.account.position.realizedPnl) < 1e-6);
  });
});

test("GET /api/equity-history's drawdown reflects a real equity dip after a manual round trip", { timeout: 10_000 }, async (t) => {
  await withServer(t, async (base) => {
    const buy = await (await fetch(`${base}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ side: "BUY", quantity: 0.001 })
    })).json();
    await fetch(`${base}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ side: "SELL", quantity: buy.order.quantity })
    });

    // Equity is only sampled on a candle tick (PaperRuntime.handleCandleUpdate), not on every
    // manual order -- wait for at least one more tick to pick up the post-trade equity.
    await new Promise((resolve) => {
      const check = async () => {
        const { history } = await (await fetch(`${base}/api/equity-history`)).json();
        if (history.length >= 2) return resolve();
        setTimeout(check, 20);
      };
      check();
    });

    const { drawdown } = await (await fetch(`${base}/api/equity-history`)).json();
    assert.ok(drawdown.peakEquity >= 10_000_000);
    assert.ok(drawdown.currentDrawdown > 0, "fees/spread/slippage should leave equity below the peak");
    assert.ok(drawdown.maxDrawdown >= drawdown.currentDrawdown);
  }, { pollIntervalMs: 200 });
});

test("GET /api/position-protection defaults to unset; POST validates and round-trips", async (t) => {
  await withServer(t, async (base) => {
    const initial = await (await fetch(`${base}/api/position-protection`)).json();
    assert.deepEqual(initial, { stopLossPrice: null, takeProfitPrice: null });

    const invalid = await fetch(`${base}/api/position-protection`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stopLossPrice: 100, takeProfitPrice: 100 })
    });
    assert.equal(invalid.status, 400, "stopLossPrice must be strictly less than takeProfitPrice");

    const set = await (await fetch(`${base}/api/position-protection`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stopLossPrice: 90_000_000, takeProfitPrice: 110_000_000 })
    })).json();
    assert.deepEqual(set, { stopLossPrice: 90_000_000, takeProfitPrice: 110_000_000 });

    const cleared = await (await fetch(`${base}/api/position-protection`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stopLossPrice: null, takeProfitPrice: null })
    })).json();
    assert.deepEqual(cleared, { stopLossPrice: null, takeProfitPrice: null });
  });
});

test("a stop-loss level crossed on a real candle tick auto-sells and eventually clears itself", { timeout: 10_000 }, async (t) => {
  await withServer(t, async (base, runtime, priceBox) => {
    const buy = await (await fetch(`${base}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ side: "BUY", quantity: 0.001 })
    })).json();
    assert.ok(buy.order.quantity > 0);

    // The stop-loss level equals the current (fixed) market price, so every poll's
    // "price <= stopLossPrice" check fires. PaperBroker's fill model caps a single order
    // below the full requested quantity (FILL_MODEL.maxFillRatio), so this may take more
    // than one poll -- and may end either fully flat or give up on an unsellable dust
    // remainder (see PaperRuntime.checkPositionProtection); either way the level clears.
    await fetch(`${base}/api/position-protection`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stopLossPrice: priceBox.value, takeProfitPrice: null })
    });

    await new Promise((resolve) => {
      const check = async () => {
        const protection = await (await fetch(`${base}/api/position-protection`)).json();
        if (protection.stopLossPrice === null) return resolve();
        setTimeout(check, 20);
      };
      check();
    });

    const [account, protection, control] = await Promise.all([
      fetch(`${base}/api/account`).then((r) => r.json()),
      fetch(`${base}/api/position-protection`).then((r) => r.json()),
      fetch(`${base}/api/control`).then((r) => r.json())
    ]);
    assert.ok(account.position.quantity < buy.order.quantity, "the stop-loss sold at least part of the position");
    assert.ok(account.orders.length >= 2, "the original BUY plus at least one stop-loss SELL");
    assert.deepEqual(protection, { stopLossPrice: null, takeProfitPrice: null }, "the level cleared (fully closed or gave up)");
    assert.ok(
      control.events.some((event) => event.type === "RISK" && event.message.includes("stop-loss")),
      "expected a RISK event recording the trigger"
    );
  }, { pollIntervalMs: 200 });
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
