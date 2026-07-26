const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { createPaperTradingHttpServer } = require("../dist/apps/server/src/httpServer.js");
const { PaperRuntime } = require("../dist/apps/server/src/paperRuntime.js");
const { RateLimiter } = require("../dist/apps/server/src/rateLimiter.js");

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
    })],
    webhookSender: options.webhookSender
  });
  // Tests that need to exercise the 429 path inject a small RateLimiter (real default is 600/10s
  // -- far too many real requests for a fast, deterministic test to send); every other test gets
  // the production default, same as main.js.
  const server = createPaperTradingHttpServer(runtime, dir, options.httpServerOptions);
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

test("the /api/ rate limiter (rateLimiter.ts) blocks a client past its configured budget", async (t) => {
  // Injects a tiny limit via HttpServerOptions (the real production default is 600/10s -- too
  // many real requests for a fast, deterministic test) purely to prove the wiring in
  // httpServer.ts is correct: the 429 status, the Korean body, and static-path exemption.
  const httpServerOptions = { rateLimiter: new RateLimiter({ windowMs: 10_000, maxRequests: 3 }) };
  await withServer(t, async (base) => {
    for (let i = 0; i < 3; i++) {
      const response = await fetch(`${base}/api/health`);
      assert.equal(response.status, 200, `request ${i + 1}/3 should still be within budget`);
    }
    const blocked = await fetch(`${base}/api/health`);
    assert.equal(blocked.status, 429);
    const body = await blocked.json();
    assert.equal(body.error, "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");

    // Static assets are deliberately exempt from this limiter (see httpServer.ts) -- a
    // non-/api/ path must still be processed by serveStatic's own logic (here: 404, since
    // withServer's static root is the tmpdir, not the real apps/web) rather than 429, proving
    // the rate limiter itself never saw it.
    assert.equal((await fetch(`${base}/index.html`)).status, 404);
  }, { httpServerOptions });
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

test("POST /api/position/close converges the open position toward flat (FILL_MODEL.maxFillRatio bounds a single fill to 90%, so it retries)", async (t) => {
  await withServer(t, async (base) => {
    await fetch(`${base}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ side: "BUY", quantity: 0.002 })
    });
    const opened = await (await fetch(`${base}/api/account`)).json();
    assert.ok(opened.position.quantity > 0, "position open before close");

    const closeResponse = await fetch(`${base}/api/position/close`, { method: "POST" });
    assert.equal(closeResponse.status, 200);
    const closed = await closeResponse.json();
    assert.equal(closed.order.side, "SELL");
    // A single order can never fill more than 90% of what it requests (see paperRuntime.ts's
    // closePosition doc comment), so exact zero is unreachable -- the repeated 90% fills
    // converge the remainder down to an unsellable dust amount a small fraction of the original.
    assert.ok(closed.account.position.quantity <= opened.position.quantity * 0.02, "converged to dust");
  });
});

test("POST /api/position/close with no open position fails with a clear (Korean) message", async (t) => {
  await withServer(t, async (base) => {
    const response = await fetch(`${base}/api/position/close`, { method: "POST" });
    assert.equal(response.status, 400);
    const error = await response.json();
    assert.equal(error.error, "청산할 보유 포지션이 없습니다");
  });
});

test("POST /api/position/close always clears any active position protection level, even if a dust remainder is left", async (t) => {
  await withServer(t, async (base) => {
    await fetch(`${base}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ side: "BUY", quantity: 0.002 })
    });
    await fetch(`${base}/api/position-protection`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stopLossPrice: 1, takeProfitPrice: null, trailingStopPercent: null })
    });
    await fetch(`${base}/api/position/close`, { method: "POST" });

    const protection = await (await fetch(`${base}/api/position-protection`)).json();
    assert.deepEqual(protection, { stopLossPrice: null, takeProfitPrice: null, trailingStopPercent: null, currentTrailingStopPrice: null });
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

test("GET /api/export/trades.csv and /api/export/equity-history.csv serve real CSV over the actual server", async (t) => {
  await withServer(t, async (base) => {
    await fetch(`${base}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ side: "BUY", quantity: 0.001 })
    });

    const tradesResponse = await fetch(`${base}/api/export/trades.csv`);
    assert.equal(tradesResponse.status, 200);
    assert.match(tradesResponse.headers.get("content-type"), /text\/csv/);
    assert.match(tradesResponse.headers.get("content-disposition"), /attachment; filename="dokkaebi-trades\.csv"/);
    const tradesBody = await tradesResponse.text();
    const tradesLines = tradesBody.trim().split("\r\n");
    assert.equal(tradesLines[0], "id,market,side,quantity,price,fee,filledAt,requestedQuantity,quotedPrice,spreadCost,slippageCost,marketImpactCost");
    assert.equal(tradesLines.length, 2, "header + the one BUY order");
    assert.ok(tradesLines[1].includes(",BUY,"));

    const equityResponse = await fetch(`${base}/api/export/equity-history.csv`);
    assert.equal(equityResponse.status, 200);
    assert.match(equityResponse.headers.get("content-type"), /text\/csv/);
    const equityBody = await equityResponse.text();
    assert.equal(equityBody.trim().split("\r\n")[0], "timestamp,isoTime,equity");

    const eventsResponse = await fetch(`${base}/api/export/events.csv`);
    assert.equal(eventsResponse.status, 200);
    assert.match(eventsResponse.headers.get("content-type"), /text\/csv/);
    assert.match(eventsResponse.headers.get("content-disposition"), /attachment; filename="dokkaebi-events\.csv"/);
    const eventsBody = await eventsResponse.text();
    const eventsLines = eventsBody.trim().split("\r\n");
    assert.equal(eventsLines[0], "id,timestamp,type,message");
    // type/message stay raw English here (a data-interchange format, not the /api/control
    // JSON response's translated display fields) -- "manual BUY filled" from the order above.
    assert.ok(eventsLines.some((line) => line.includes(",ORDER,manual BUY filled")));

    assert.equal((await fetch(`${base}/api/export/events.csv`, { method: "POST" })).status, 405);
  });
});

test("GET/POST /api/limit-orders round-trips and cancellation removes a pending order", async (t) => {
  await withServer(t, async (base) => {
    const initial = await (await fetch(`${base}/api/limit-orders`)).json();
    assert.deepEqual(initial, { orders: [] });

    const invalid = await fetch(`${base}/api/limit-orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ side: "BUY", quantity: -1, limitPrice: 90_000_000 })
    });
    assert.equal(invalid.status, 400);

    // Far below the fixed test market price (100,000,000), so it stays pending.
    const created = await (await fetch(`${base}/api/limit-orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ side: "BUY", quantity: 0.001, limitPrice: 50_000_000 })
    })).json();
    assert.equal(created.side, "BUY");
    assert.equal(created.limitPrice, 50_000_000);
    assert.ok(created.id);

    const afterCreate = await (await fetch(`${base}/api/limit-orders`)).json();
    assert.equal(afterCreate.orders.length, 1);

    const cancelResponse = await fetch(`${base}/api/limit-orders/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: created.id })
    });
    assert.equal(cancelResponse.status, 200);

    const afterCancel = await (await fetch(`${base}/api/limit-orders`)).json();
    assert.deepEqual(afterCancel.orders, []);

    const cancelAgain = await fetch(`${base}/api/limit-orders/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: created.id })
    });
    assert.equal(cancelAgain.status, 400, "cancelling an already-cancelled id fails");
  });
});

test("a limit order crossed on a real candle tick fills and disappears from pending", { timeout: 10_000 }, async (t) => {
  await withServer(t, async (base, runtime, priceBox) => {
    // The limit price equals the current (fixed) market price, so the very next poll's
    // "price <= limitPrice" check fires immediately.
    const created = await (await fetch(`${base}/api/limit-orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ side: "BUY", quantity: 0.001, limitPrice: priceBox.value })
    })).json();

    await new Promise((resolve) => {
      const check = async () => {
        const { orders } = await (await fetch(`${base}/api/limit-orders`)).json();
        if (!orders.some((order) => order.id === created.id)) return resolve();
        setTimeout(check, 20);
      };
      check();
    });

    const [account, control] = await Promise.all([
      fetch(`${base}/api/account`).then((r) => r.json()),
      fetch(`${base}/api/control`).then((r) => r.json())
    ]);
    assert.equal(account.orders.length, 1);
    assert.equal(account.orders[0].side, "BUY");
    assert.ok(
      control.events.some((event) => event.type === "리스크" && event.message.includes("지정가 주문 체결")),
      "expected a translated 리스크 event recording the fill"
    );
  }, { pollIntervalMs: 200 });
});

test("GET /api/strategy/periods defaults to (5, 20); POST validates and round-trips", async (t) => {
  await withServer(t, async (base) => {
    const initial = await (await fetch(`${base}/api/strategy/periods`)).json();
    assert.deepEqual(initial, { shortPeriod: 5, longPeriod: 20 });

    const invalid = await fetch(`${base}/api/strategy/periods`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shortPeriod: 20, longPeriod: 5 })
    });
    assert.equal(invalid.status, 400, "longPeriod must exceed shortPeriod");
    // Regression check: this used to leak the raw English "invalid SMA periods" (from
    // strategyEngine.ts's constructor guard) with only a generic "오류: " prefix, since
    // errorMessages.ts had no entry for it.
    const invalidBody = await invalid.json();
    assert.equal(invalidBody.error, "SMA 기간이 올바르지 않습니다 (단기 기간은 2 이상, 장기 기간은 단기 기간보다 커야 합니다)");

    const set = await (await fetch(`${base}/api/strategy/periods`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shortPeriod: 8, longPeriod: 34 })
    })).json();
    assert.deepEqual(set, { shortPeriod: 8, longPeriod: 34 });

    const after = await (await fetch(`${base}/api/strategy/periods`)).json();
    assert.deepEqual(after, { shortPeriod: 8, longPeriod: 34 });
  });
});

test("GET /api/champion returns 3 fixed challengers; the default active strategy (SMA 5,20) is the champion", async (t) => {
  await withServer(t, async (base) => {
    const standings = await (await fetch(`${base}/api/champion`)).json();
    assert.equal(standings.championId, "sma-5-20", "default periods (5, 20) match the sma-5-20 preset");
    assert.equal(standings.challengers.length, 3);
    const ids = standings.challengers.map((c) => c.id).sort();
    assert.deepEqual(ids, ["ema-5-20", "sma-10-30", "sma-5-20"]);
    const champion = standings.challengers.find((c) => c.id === "sma-5-20");
    assert.equal(champion.isChampion, true);
    assert.equal(standings.challengers.filter((c) => c.isChampion).length, 1);
    for (const challenger of standings.challengers) {
      assert.equal(challenger.account.cash, 10_000_000, `${challenger.id} starts with the full shadow cash`);
      assert.equal(challenger.stats.totalTrades, 0);
      // withServer's warm-up poll already fed the champion system one tick, so a single flat
      // equity sample exists: peak equals the untouched initial cash, no decline yet.
      assert.equal(challenger.drawdown.peakEquity, 10_000_000);
      assert.equal(challenger.drawdown.maxDrawdownPercent, 0);
    }
  });
});

test("GET /api/champion adds a 4th 'active' entry (real account data) once the real strategy periods no longer match any preset", async (t) => {
  await withServer(t, async (base) => {
    await fetch(`${base}/api/strategy/periods`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shortPeriod: 7, longPeriod: 21 })
    });
    const standings = await (await fetch(`${base}/api/champion`)).json();
    assert.equal(standings.championId, "active");
    assert.equal(standings.challengers.length, 4, "3 fixed presets plus the real active config");
    const activeEntry = standings.challengers.find((c) => c.id === "active");
    assert.equal(activeEntry.label, "SMA(7,21)");
    assert.equal(activeEntry.isChampion, true);
    assert.equal(standings.challengers.filter((c) => c.isChampion).length, 1);
    // The 3 fixed presets are still present and correctly not marked champion.
    assert.equal(standings.challengers.filter((c) => c.id !== "active").length, 3);
    assert.ok(standings.challengers.filter((c) => c.id !== "active").every((c) => !c.isChampion));
  });
});

test("POST /api/champion/promote switches the real active strategy to the challenger's preset", async (t) => {
  await withServer(t, async (base) => {
    const before = await (await fetch(`${base}/api/control`)).json();
    assert.equal(before.activeStrategyId, "sma-crossover");

    const promoteResponse = await fetch(`${base}/api/champion/promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "ema-5-20" })
    });
    assert.equal(promoteResponse.status, 200);
    const promoted = await promoteResponse.json();
    assert.equal(promoted.championId, "ema-5-20");

    const control = await (await fetch(`${base}/api/control`)).json();
    assert.equal(control.activeStrategyId, "ema-crossover", "the real strategy actually switched");
    const periods = await (await fetch(`${base}/api/strategy/periods`)).json();
    assert.deepEqual(periods, { shortPeriod: 5, longPeriod: 20 });
    assert.ok(
      control.events.some((event) => event.type === "상태" && event.message === "챔피언 승격: EMA(5,20)"),
      "expected a translated STATUS event recording the promotion"
    );

    const unknownId = await fetch(`${base}/api/champion/promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "does-not-exist" })
    });
    assert.equal(unknownId.status, 400);
    const error = await unknownId.json();
    assert.equal(error.error, "알 수 없는 챌린저 ID입니다: does-not-exist");
  });
});

test("shadow challengers keep trading on real candle ticks even while the real strategy is stopped", { timeout: 10_000 }, async (t) => {
  await withServer(t, async (base, runtime, priceBox) => {
    // The real strategy is never started in this test -- champion system shadow evaluation
    // must be independent of that (see paperRuntime.ts's handleCandleUpdate doc comment).
    const prices = [
      ...Array.from({ length: 20 }, () => 100_000_000),
      110_000_000, 115_000_000, 120_000_000, 125_000_000, 130_000_000
    ];
    for (const price of prices) {
      priceBox.value = price;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await new Promise((resolve) => {
      const check = async () => {
        const standings = await (await fetch(`${base}/api/champion`)).json();
        if (standings.challengers.some((c) => c.stats.totalTrades > 0)) return resolve();
        setTimeout(check, 20);
      };
      check();
    });
    const control = await (await fetch(`${base}/api/control`)).json();
    // control.status itself is untranslated (only events[].type/message are, in apiRouter.ts --
    // app.js's controlStatusKo() translates this field client-side for display, same as the KPI strip).
    assert.equal(control.status, "STOPPED", "the real strategy was indeed never started");
  }, { pollIntervalMs: 20 });
});

test("POST /api/champion/reset discards accumulated shadow trades without touching the real account", { timeout: 10_000 }, async (t) => {
  await withServer(t, async (base, runtime, priceBox) => {
    const prices = [
      ...Array.from({ length: 20 }, () => 100_000_000),
      110_000_000, 115_000_000, 120_000_000, 125_000_000, 130_000_000
    ];
    for (const price of prices) {
      priceBox.value = price;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await new Promise((resolve) => {
      const check = async () => {
        const standings = await (await fetch(`${base}/api/champion`)).json();
        if (standings.challengers.some((c) => c.stats.totalTrades > 0)) return resolve();
        setTimeout(check, 20);
      };
      check();
    });

    const accountBefore = await (await fetch(`${base}/api/account`)).json();

    const resetResponse = await fetch(`${base}/api/champion/reset`, { method: "POST" });
    assert.equal(resetResponse.status, 200);
    const afterReset = await resetResponse.json();
    assert.ok(afterReset.challengers.every((c) => c.stats.totalTrades === 0), "every shadow challenger is flat again");
    assert.ok(afterReset.challengers.every((c) => c.account.cash === 10_000_000), "every shadow challenger has the full initial cash again");

    const accountAfter = await (await fetch(`${base}/api/account`)).json();
    assert.deepEqual(accountAfter, accountBefore, "the real account is completely untouched by a champion reset");

    const control = await (await fetch(`${base}/api/control`)).json();
    assert.ok(
      control.events.some((event) => event.type === "상태" && event.message === "챔피언 시스템 초기화됨"),
      "expected a translated STATUS event recording the reset"
    );
  }, { pollIntervalMs: 20 });
});

test("GET /api/backtest is 405; POST returns one result per champion preset with a real metrics shape", async (t) => {
  await withServer(t, async (base) => {
    assert.equal((await fetch(`${base}/api/backtest`)).status, 405);

    const response = await fetch(`${base}/api/backtest`, { method: "POST" });
    assert.equal(response.status, 200);
    const { results } = await response.json();
    assert.equal(results.length, 3);
    assert.deepEqual(results.map((r) => r.id).sort(), ["ema-5-20", "sma-10-30", "sma-5-20"]);
    for (const result of results) {
      assert.equal(result.metrics.initialEquity, 10_000_000);
      assert.ok(Number.isFinite(result.metrics.finalEquity));
      assert.ok(Number.isFinite(result.metrics.totalReturn));
      assert.ok(Number.isFinite(result.metrics.maxDrawdown));
    }
  });
});

test("POST /api/backtest adds a 4th result for a custom (non-preset) strategy config", async (t) => {
  await withServer(t, async (base) => {
    await fetch(`${base}/api/strategy/periods`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shortPeriod: 7, longPeriod: 21 })
    });
    const { results } = await (await fetch(`${base}/api/backtest`, { method: "POST" })).json();
    assert.equal(results.length, 4);
    const active = results.find((r) => r.id === "active");
    assert.equal(active.label, "SMA(7,21) (현재 설정)");
    assert.equal(active.metrics.initialEquity, 10_000_000);
  });
});

test("POST /api/backtest rejects an invalid unit with a Korean 400 (no network fetch attempted)", async (t) => {
  await withServer(t, async (base) => {
    const response = await fetch(`${base}/api/backtest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unit: "hour" })
    });
    assert.equal(response.status, 400);
    const error = await response.json();
    assert.equal(error.error, "기간(unit)은 \"minute\" 또는 \"day\"여야 합니다");
  });
});

test("GET /api/position-sizing defaults to FIXED; POST validates and round-trips to FIXED_FRACTIONAL", async (t) => {
  await withServer(t, async (base) => {
    const initial = await (await fetch(`${base}/api/position-sizing`)).json();
    assert.equal(initial.mode, "FIXED");

    const invalid = await fetch(`${base}/api/position-sizing`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "FIXED_FRACTIONAL", riskFraction: 5 })
    });
    assert.equal(invalid.status, 400, "riskFraction must be within (0, 1]");

    const set = await (await fetch(`${base}/api/position-sizing`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "FIXED_FRACTIONAL", riskFraction: 0.25 })
    })).json();
    assert.deepEqual(set, { mode: "FIXED_FRACTIONAL", riskFraction: 0.25 });

    const backToFixed = await (await fetch(`${base}/api/position-sizing`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "FIXED" })
    })).json();
    assert.equal(backToFixed.mode, "FIXED");
    assert.equal(backToFixed.riskFraction, 0.25, "riskFraction is preserved even while not in use");
  });
});

test("GET /api/position-protection defaults to unset; POST validates and round-trips", async (t) => {
  await withServer(t, async (base) => {
    const initial = await (await fetch(`${base}/api/position-protection`)).json();
    assert.deepEqual(initial, { stopLossPrice: null, takeProfitPrice: null, trailingStopPercent: null, currentTrailingStopPrice: null });

    const invalid = await fetch(`${base}/api/position-protection`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stopLossPrice: 100, takeProfitPrice: 100, trailingStopPercent: null })
    });
    assert.equal(invalid.status, 400, "stopLossPrice must be strictly less than takeProfitPrice");

    const conflict = await fetch(`${base}/api/position-protection`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stopLossPrice: 90_000_000, takeProfitPrice: null, trailingStopPercent: 0.05 })
    });
    assert.equal(conflict.status, 400, "stopLossPrice and trailingStopPercent are mutually exclusive");

    const set = await (await fetch(`${base}/api/position-protection`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stopLossPrice: 90_000_000, takeProfitPrice: 110_000_000, trailingStopPercent: null })
    })).json();
    assert.deepEqual(set, { stopLossPrice: 90_000_000, takeProfitPrice: 110_000_000, trailingStopPercent: null, currentTrailingStopPrice: null });

    const cleared = await (await fetch(`${base}/api/position-protection`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stopLossPrice: null, takeProfitPrice: null, trailingStopPercent: null })
    })).json();
    assert.deepEqual(cleared, { stopLossPrice: null, takeProfitPrice: null, trailingStopPercent: null, currentTrailingStopPrice: null });
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
      body: JSON.stringify({ stopLossPrice: priceBox.value, takeProfitPrice: null, trailingStopPercent: null })
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
    assert.equal(protection.stopLossPrice, null, "the level cleared (fully closed or gave up)");
    assert.ok(
      control.events.some((event) => event.type === "리스크" && event.message.includes("스탑로스")),
      "expected a translated 리스크 event recording the trigger"
    );
  }, { pollIntervalMs: 200 });
});

test("GET/POST /api/notifications round-trips and rejects an invalid webhookUrl when enabling", async (t) => {
  await withServer(t, async (base) => {
    const initial = await (await fetch(`${base}/api/notifications`)).json();
    assert.deepEqual(initial, { enabled: false, webhookUrl: null });

    const invalid = await fetch(`${base}/api/notifications`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, webhookUrl: "javascript:alert(1)" })
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error, "알림을 사용하려면 웹훅 URL이 올바른 http(s) 주소여야 합니다");

    const set = await (await fetch(`${base}/api/notifications`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, webhookUrl: "https://example.com/hook" })
    })).json();
    assert.deepEqual(set, { enabled: true, webhookUrl: "https://example.com/hook" });

    const after = await (await fetch(`${base}/api/notifications`)).json();
    assert.deepEqual(after, { enabled: true, webhookUrl: "https://example.com/hook" });

    const control = await (await fetch(`${base}/api/control`)).json();
    assert.ok(control.events.some((event) => event.type === "상태" && event.message === "알림 설정 변경: 사용 여부=true"));

    // Disabling never requires a URL (null always accepted regardless of enabled -- see
    // setNotificationSettings()'s own doc comment).
    const disabled = await (await fetch(`${base}/api/notifications`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false, webhookUrl: null })
    })).json();
    assert.deepEqual(disabled, { enabled: false, webhookUrl: null });
  });
});

test("POST /api/notifications/test fires immediately regardless of the enabled flag, but 400s with no webhookUrl configured", async (t) => {
  const calls = [];
  const webhookSender = async (url, event) => { calls.push({ url, event }); };
  await withServer(t, async (base) => {
    const noUrl = await fetch(`${base}/api/notifications/test`, { method: "POST" });
    assert.equal(noUrl.status, 400);
    assert.equal((await noUrl.json()).error, "설정된 웹훅 URL이 없습니다");

    // enabled: false on purpose -- sendTestNotification() bypasses the enabled flag entirely.
    await fetch(`${base}/api/notifications`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false, webhookUrl: "https://example.com/hook" })
    });
    const response = await fetch(`${base}/api/notifications/test`, { method: "POST" });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { sent: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://example.com/hook");
    assert.equal(calls[0].event.type, "SYSTEM");
  }, { webhookSender });
});

test("an ORDER webhook fires for a real manual fill only while notifications are enabled", { timeout: 10_000 }, async (t) => {
  const calls = [];
  const webhookSender = async (url, event) => { calls.push({ url, event }); };
  await withServer(t, async (base) => {
    // Disabled (the default): a real fill must not notify.
    await fetch(`${base}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ side: "BUY", quantity: 0.001 })
    });
    assert.equal(calls.length, 0, "notifications are disabled by default -- no call yet");

    await fetch(`${base}/api/notifications`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, webhookUrl: "https://example.com/hook" })
    });
    await fetch(`${base}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ side: "SELL", quantity: 0.0005 })
    });
    assert.equal(calls.length, 1, "exactly one ORDER notification for the one fill after enabling");
    assert.equal(calls[0].url, "https://example.com/hook");
    assert.equal(calls[0].event.type, "ORDER");
    assert.equal(calls[0].event.message, "manual SELL filled");
  }, { webhookSender });
});

test("a RISK webhook fires when a real stop-loss triggers on a candle tick", { timeout: 10_000 }, async (t) => {
  const calls = [];
  const webhookSender = async (url, event) => { calls.push({ url, event }); };
  await withServer(t, async (base, runtime, priceBox) => {
    await fetch(`${base}/api/notifications`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, webhookUrl: "https://example.com/hook" })
    });
    await fetch(`${base}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ side: "BUY", quantity: 0.001 })
    });
    await fetch(`${base}/api/position-protection`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stopLossPrice: priceBox.value, takeProfitPrice: null, trailingStopPercent: null })
    });

    await new Promise((resolve) => {
      const check = async () => {
        const protection = await (await fetch(`${base}/api/position-protection`)).json();
        if (protection.stopLossPrice === null) return resolve();
        setTimeout(check, 20);
      };
      check();
    });

    assert.ok(calls.some((c) => c.event.type === "RISK" && c.event.message.includes("stop-loss")), "expected a RISK webhook call for the stop-loss trigger");
  }, { pollIntervalMs: 200, webhookSender });
});

test("a trailing stop ratchets up with price and triggers once price falls back through it", { timeout: 10_000 }, async (t) => {
  await withServer(t, async (base, runtime, priceBox) => {
    const buy = await (await fetch(`${base}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ side: "BUY", quantity: 0.001 })
    })).json();
    assert.ok(buy.order.quantity > 0);

    await fetch(`${base}/api/position-protection`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stopLossPrice: null, takeProfitPrice: null, trailingStopPercent: 0.05 })
    });

    // Price rises 10% -- the trailing stop should ratchet up to follow it (95% of the new
    // peak), well above the original entry price, without triggering (still below the peak).
    priceBox.value = Math.round(priceBox.value * 1.1);
    await new Promise((resolve) => {
      const check = async () => {
        const protection = await (await fetch(`${base}/api/position-protection`)).json();
        if (protection.currentTrailingStopPrice !== null && protection.currentTrailingStopPrice > buy.order.price) return resolve();
        setTimeout(check, 20);
      };
      check();
    });
    const afterRise = await (await fetch(`${base}/api/position-protection`)).json();
    assert.equal(afterRise.trailingStopPercent, 0.05);
    assert.ok(afterRise.currentTrailingStopPrice > buy.order.price, "the trailing stop ratcheted up above the original entry price");
    const accountAfterRise = await (await fetch(`${base}/api/account`)).json();
    assert.ok(accountAfterRise.position.quantity > 0, "not triggered yet -- price is still at the peak");

    // Now crash the price below the ratcheted trailing level to trigger it.
    priceBox.value = Math.round(afterRise.currentTrailingStopPrice * 0.9);
    await new Promise((resolve) => {
      const check = async () => {
        const protection = await (await fetch(`${base}/api/position-protection`)).json();
        if (protection.trailingStopPercent === null) return resolve();
        setTimeout(check, 20);
      };
      check();
    });

    const [account, control] = await Promise.all([
      fetch(`${base}/api/account`).then((r) => r.json()),
      fetch(`${base}/api/control`).then((r) => r.json())
    ]);
    assert.ok(account.position.quantity < buy.order.quantity, "the trailing stop sold at least part of the position");
    assert.ok(
      control.events.some((event) => event.type === "리스크" && event.message.includes("트레일링 스탑")),
      "expected a translated 리스크 event recording the trailing-stop trigger"
    );
  }, { pollIntervalMs: 200 });
});

test("invalid JSON body returns 400 (Korean message) instead of crashing the server", async (t) => {
  await withServer(t, async (base) => {
    const response = await fetch(`${base}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json"
    });
    assert.equal(response.status, 400);
    const error = await response.json();
    assert.equal(error.error, "요청 본문이 올바른 JSON 형식이 아닙니다");
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
