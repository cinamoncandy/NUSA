"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { startCloudRuntime } = require("../dist/apps/cloud/src/runtime.js");
const { InMemoryCloudDashboardStateProvider } = require("../dist/apps/cloud/src/cloudDashboardStateProvider.js");
const { PaperTradingExecutionLoop } = require("../dist/apps/cloud/src/paperTradingExecutionLoop.js");

/**
 * Opus P0-5 ledger replay audit. A missing dashboard projection (no state on a tick, e.g. stale
 * market data closed the kill switch) must withhold the projection only. It used to call the PAPER
 * repository's clear(), deleting the durable account, its history and the canonical fill ledger,
 * so the next restart reset NAV to initial capital and lost every canonical fill.
 */
const DASHBOARD_FIXTURE = "l".repeat(40);

test("an empty dashboard projection never clears the canonical PAPER repository", async () => {
  let clears = 0;
  const repository = { loadLatest: () => undefined, save() {}, loadFills: () => [], clear() { clears += 1; } };
  const loop = new PaperTradingExecutionLoop({ initialCapital: 1_000_000 });
  let onTicker;
  const factory = (_markets, callback) => { onTicker = callback; return { subscribe() {}, start() {}, stop() {} }; };
  const provider = new InMemoryCloudDashboardStateProvider();
  const hydrator = { hydrate() { /* leaves the provider empty, like a closed kill switch */ } };
  const handle = startCloudRuntime(
    { NUSA_CLOUD_DASHBOARD_PORT: "41971", NUSA_CLOUD_DASHBOARD_TOKEN: DASHBOARD_FIXTURE, NUSA_CLOUD_UPBIT_PUBLIC_DATA: "true", NUSA_CLOUD_UPBIT_MARKETS: "KRW-BTC" },
    provider, hydrator, factory, undefined, repository, loop,
  );
  try {
    onTicker({ type: "ticker", code: "KRW-BTC", trade_price: 100, signed_change_rate: 0.01, acc_trade_price_24h: 1000, trade_timestamp: Date.now() });
    assert.equal(clears, 0, "a projection gap must not erase canonical PAPER account or fill ledger");
  } finally {
    await handle.stop();
  }
});
