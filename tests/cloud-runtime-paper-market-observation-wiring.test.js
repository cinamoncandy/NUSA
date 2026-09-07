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
