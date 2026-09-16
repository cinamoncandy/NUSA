const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { SqliteDatabase, SqlitePaperMarketObservationRepository } = require("../dist/packages/storage/src/index.js");
const { startCloudRuntime } = require("../dist/apps/cloud/src/runtime.js");
const { readCanonicalPaperTickerBenchmark } = require("../dist/apps/cloud/src/paperMarketBenchmark.js");

test("production Cloud runtime persists public PAPER ticker evidence and exposes the orderbook quote seam", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nusa-paper-market-runtime-"));
  const database = join(directory, "state.sqlite");
  const firstObservedAt = Date.now() - 1_000;
  let onTicker;
  let onOrderBook;
  let handle;
  try {
    const marketFactory = (_markets, tickerCallback, _connectionCallback, orderBookCallback) => {
      onTicker = tickerCallback;
      onOrderBook = orderBookCallback;
      return { subscribe() {}, start() {}, stop() {} };
    };
    handle = startCloudRuntime({
      NUSA_CLOUD_STATE_DB_PATH: database,
      NUSA_CLOUD_DASHBOARD_PORT: "42984",
      NUSA_CLOUD_DASHBOARD_TOKEN: "runtime-paper-market-test-token-0123456789",
      NUSA_CLOUD_UPBIT_PUBLIC_DATA: "true",
      NUSA_CLOUD_UPBIT_MARKETS: "KRW-BTC",
    }, undefined, undefined, marketFactory);
    assert.equal(typeof onOrderBook, "function");
    onOrderBook({ type: "orderbook", code: "KRW-BTC", total_ask_size: 2, total_bid_size: 2, orderbook_units: [{ ask_price: 101, bid_price: 99, ask_size: 1, bid_size: 1 }] });
    onTicker({ type: "ticker", code: "KRW-BTC", trade_price: 100, trade_timestamp: firstObservedAt, signed_change_rate: 0.01, acc_trade_volume: 1, acc_trade_price_24h: 100 });
    onTicker({ type: "ticker", code: "KRW-BTC", trade_price: 110, trade_timestamp: firstObservedAt + 100, signed_change_rate: 0.02, acc_trade_volume: 2, acc_trade_price_24h: 210 });
    await handle.stop();
    handle = undefined;

    const db = new SqliteDatabase(database);
    try {
      const repository = new SqlitePaperMarketObservationRepository(db);
      assert.equal(repository.count(), 2);
      const benchmark = readCanonicalPaperTickerBenchmark(repository, "KRW-BTC", firstObservedAt - 1, firstObservedAt + 101);
      assert.equal(benchmark?.startPrice, 100);
      assert.equal(benchmark?.endPrice, 110);
      assert.equal(benchmark?.source, "UPBIT_PUBLIC_TICKER");
    } finally { db.close(); }
  } finally {
    if (handle) await handle.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});


async function loadPaperOperations(port, token) {
  const response = await fetch(`http://127.0.0.1:${port}/api/paper-operations`, {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(response.status, 200);
  return response.json();
}

test("a stale ticker in one market cannot erase fresh accepted evidence from another market", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nusa-paper-market-stale-isolation-"));
  const database = join(directory, "state.sqlite");
  const token = ["paper", "market", "stale", "isolation", "fixture"].join("-");
  const port = 42_985;
  let onTicker;
  let handle;
  try {
    const marketFactory = (_markets, tickerCallback) => {
      onTicker = tickerCallback;
      return { subscribe() {}, start() {}, stop() {} };
    };
    handle = startCloudRuntime({
      NUSA_CLOUD_STATE_DB_PATH: database,
      NUSA_CLOUD_DASHBOARD_PORT: String(port),
      NUSA_CLOUD_DASHBOARD_TOKEN: token,
      NUSA_CLOUD_UPBIT_PUBLIC_DATA: "true",
      NUSA_CLOUD_UPBIT_MARKETS: "KRW-BTC,KRW-DOGE",
    }, undefined, undefined, marketFactory);

    const now = Date.now();
    onTicker({
      type: "ticker",
      code: "KRW-BTC",
      trade_price: 100_000_000,
      trade_timestamp: now - 1_000,
      signed_change_rate: 0.01,
      acc_trade_volume: 1,
      acc_trade_price_24h: 1_000_000_000
    });
    const fresh = await loadPaperOperations(port, token);
    assert.equal(fresh.dashboard.killSwitchActive, false);
    assert.ok(fresh.dashboard.decisions.some((decision) => decision.symbol === "KRW-BTC"));
    assert.equal(fresh.dashboard.decisions.some((decision) => decision.symbol === "NO_MARKET_DATA"), false);

    onTicker({
      type: "ticker",
      code: "KRW-DOGE",
      trade_price: 123,
      trade_timestamp: now - 60_000,
      signed_change_rate: -0.01,
      acc_trade_volume: 1,
      acc_trade_price_24h: 1_000_000_000
    });
    const afterStale = await loadPaperOperations(port, token);
    assert.equal(afterStale.operations.heartbeat.lastError, "PUBLIC_MARKET_EVENT_REJECTED:FEED_STALE");
    assert.equal(afterStale.dashboard.killSwitchActive, false, "fresh BTC evidence must remain executable");
    assert.ok(afterStale.dashboard.decisions.some((decision) => decision.symbol === "KRW-BTC"));
    assert.equal(afterStale.dashboard.decisions.some((decision) => decision.symbol === "NO_MARKET_DATA"), false);
    assert.equal(afterStale.orders.length, 0, "unbound generic CIO decisions remain advisory");
  } finally {
    if (handle) await handle.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});


test("a stale-only market still fails closed without widening the 30s freshness gate", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nusa-paper-market-stale-only-"));
  const database = join(directory, "state.sqlite");
  const token = ["paper", "market", "stale", "only", "runtime", "fixture"].join("-");
  const port = 42_986;
  let onTicker;
  let handle;
  try {
    const marketFactory = (_markets, tickerCallback) => {
      onTicker = tickerCallback;
      return { subscribe() {}, start() {}, stop() {} };
    };
    handle = startCloudRuntime({
      NUSA_CLOUD_STATE_DB_PATH: database,
      NUSA_CLOUD_DASHBOARD_PORT: String(port),
      NUSA_CLOUD_DASHBOARD_TOKEN: token,
      NUSA_CLOUD_UPBIT_PUBLIC_DATA: "true",
      NUSA_CLOUD_UPBIT_MARKETS: "KRW-DOGE",
    }, undefined, undefined, marketFactory);

    onTicker({
      type: "ticker",
      code: "KRW-DOGE",
      trade_price: 123,
      trade_timestamp: Date.now() - 60_000,
      signed_change_rate: -0.01,
      acc_trade_volume: 1,
      acc_trade_price_24h: 1_000_000_000
    });
    const snapshot = await loadPaperOperations(port, token);
    assert.equal(snapshot.operations.heartbeat.lastError, "PUBLIC_MARKET_EVENT_REJECTED:FEED_STALE");
    assert.equal(snapshot.dashboard.killSwitchActive, true);
    assert.equal(snapshot.dashboard.decisions.length, 1);
    assert.equal(snapshot.dashboard.decisions[0].symbol, "NO_MARKET_DATA");
    assert.equal(snapshot.orders.length, 0);
  } finally {
    if (handle) await handle.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});
