const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { startCloudRuntime } = require("../dist/apps/cloud/src/runtime.js");

// A repository stub that records whether the PAPER order path asked for the writer lease.
const run = async (extra, port) => {
  const directory = mkdtempSync(join(tmpdir(), "nusa-order-path-switch-"));
  let leaseStarts = 0;
  const repository = { startWriterLease: () => { leaseStarts += 1; }, loadLatest: () => undefined, loadFills: () => [], save: () => undefined, clear: () => undefined };
  let handle;
  try {
    handle = startCloudRuntime({
      NUSA_CLOUD_STATE_DB_PATH: join(directory, "state.sqlite"),
      NUSA_CLOUD_DASHBOARD_PORT: String(port),
      NUSA_CLOUD_DASHBOARD_TOKEN: "order-path-switch-test-token-0123456789",
      NUSA_CLOUD_UPBIT_PUBLIC_DATA: "false",
      NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW: "1000000",
      ...extra,
    }, undefined, undefined, undefined, undefined, repository);
    // A deferred or repeated activation must not bring the order path back when it is OFF.
    handle.startPaperRuntime();
    return leaseStarts;
  } finally {
    if (handle) await handle.stop();
    rmSync(directory, { recursive: true, force: true });
  }
};

test("order path switch: only exactly ON keeps the order path (writer lease requested)", async () => {
  assert.ok(await run({ NUSA_PAPER_ORDER_PATH: "ON" }, 42992) >= 1);
});

test("order path switch: UNSET fails closed, no order path and no writer lease (the default is no orders)", async () => {
  assert.equal(await run({}, 42991), 0);
});

test("order path switch: OFF and any other value create no order path (fail closed)", async () => {
  for (const [value, port] of [["OFF", 42993], ["off", 42994], ["", 42995], ["true", 42996], ["ONN", 42997], [" ON ", 42998], ["On", 42999]]) {
    assert.equal(await run({ NUSA_PAPER_ORDER_PATH: value }, port), 0, `value ${JSON.stringify(value)} must disable the order path`);
  }
});

// Research collection and market data keep flowing while the order path is OFF.
const { InMemoryCloudDashboardStateProvider } = require("../dist/apps/cloud/src/cloudDashboardStateProvider.js");
const feedOneTicker = async (extra, port) => {
  const directory = mkdtempSync(join(tmpdir(), "nusa-order-path-switch-feed-"));
  const researchTicks = [];
  let onTicker;
  const factory = (_markets, callback) => { onTicker = callback; return { subscribe() {}, start() {}, stop() {} }; };
  const repository = { startWriterLease() {}, loadLatest: () => undefined, loadFills: () => [], save() {}, clear() {} };
  let handle;
  try {
    handle = startCloudRuntime({
      NUSA_CLOUD_STATE_DB_PATH: join(directory, "state.sqlite"),
      NUSA_CLOUD_DASHBOARD_PORT: String(port),
      NUSA_CLOUD_DASHBOARD_TOKEN: "order-path-switch-feed-token-0123456789",
      NUSA_CLOUD_UPBIT_PUBLIC_DATA: "true",
      NUSA_CLOUD_UPBIT_MARKETS: "KRW-BTC",
      NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW: "1000000",
      ...extra,
    }, new InMemoryCloudDashboardStateProvider(), { hydrate() {} }, factory, undefined, repository, undefined, { onMarketData: (tick) => researchTicks.push(tick) });
    onTicker({ type: "ticker", code: "KRW-BTC", trade_price: 100, signed_change_rate: 0.01, acc_trade_price_24h: 1000, trade_timestamp: Date.now() });
    return researchTicks;
  } finally {
    if (handle) await handle.stop();
    rmSync(directory, { recursive: true, force: true });
  }
};

test("order path switch: research collection still receives market data when OFF, as it does when ON", async () => {
  const on = await feedOneTicker({}, 43001);
  const off = await feedOneTicker({ NUSA_PAPER_ORDER_PATH: "OFF" }, 43002);
  assert.equal(on.length, 1);
  assert.equal(off.length, 1, "market data must reach research while the order path is OFF");
  assert.equal(off[0].market, "KRW-BTC");
});

// /health reports the mode the process really runs in (the same rule that decides about the lease).
const healthRunMode = async (extra, port) => {
  const directory = mkdtempSync(join(tmpdir(), "nusa-order-path-health-"));
  let handle;
  try {
    handle = startCloudRuntime({
      NUSA_CLOUD_STATE_DB_PATH: join(directory, "state.sqlite"),
      NUSA_CLOUD_DASHBOARD_PORT: String(port),
      NUSA_CLOUD_DASHBOARD_TOKEN: "order-path-switch-test-token-0123456789",
      NUSA_CLOUD_UPBIT_PUBLIC_DATA: "false",
      NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW: "1000000",
      ...extra,
    }, undefined, undefined, undefined, undefined, { startWriterLease: () => undefined, loadLatest: () => undefined, loadFills: () => [], save: () => undefined, clear: () => undefined });
    let body;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      try { const response = await fetch(`http://127.0.0.1:${port}/health`); if (response.ok) { body = await response.json(); break; } } catch { /* server not listening yet */ }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(body, "/health must answer");
    return body.runtime?.runMode;
  } finally {
    if (handle) await handle.stop();
    rmSync(directory, { recursive: true, force: true });
  }
};

test("/health.runtime.runMode reports COLLECT_ONLY when unset, OFF or garbled, and PAPER_ORDERS only for exactly ON", async () => {
  assert.equal(await healthRunMode({}, 42980), "COLLECT_ONLY");
  assert.equal(await healthRunMode({ NUSA_PAPER_ORDER_PATH: "OFF" }, 42981), "COLLECT_ONLY");
  assert.equal(await healthRunMode({ NUSA_PAPER_ORDER_PATH: "ONN" }, 42982), "COLLECT_ONLY");
  assert.equal(await healthRunMode({ NUSA_PAPER_ORDER_PATH: "ON" }, 42983), "PAPER_ORDERS");
});
