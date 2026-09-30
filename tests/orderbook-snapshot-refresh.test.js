const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { UpbitOrderBookReconciler, ORDERBOOK_SNAPSHOT_REFRESH_INTERVAL_MS, ORDERBOOK_SNAPSHOT_MAX_AGE_MS } = require("../dist/apps/cloud/src/upbitOrderBookReconciliation.js");

const snapshot = (receivedAt) => ({ market: "KRW-BTC", receivedAt, sourceTimestamp: receivedAt, sourceFingerprint: "a".repeat(64) });
const stream = { code: "KRW-BTC", total_ask_size: 1, total_bid_size: 1, orderbook_units: [{ ask_price: 101, bid_price: 100, ask_size: 1, bid_size: 1 }] };

test("a snapshot stops reconciling the stream after its trust window and reinstalling restores it", () => {
  const reconciler = new UpbitOrderBookReconciler();
  reconciler.installSnapshot(snapshot(1_000));
  assert.notEqual(reconciler.reconcile(stream, 1_000 + ORDERBOOK_SNAPSHOT_MAX_AGE_MS), null, "still trusted at the edge of the window");
  assert.equal(reconciler.reconcile(stream, 1_000 + ORDERBOOK_SNAPSHOT_MAX_AGE_MS + 1), null, "expired snapshot drops the stream book");
  reconciler.installSnapshot(snapshot(1_000 + ORDERBOOK_SNAPSHOT_MAX_AGE_MS));
  assert.notEqual(reconciler.reconcile(stream, 1_000 + ORDERBOOK_SNAPSHOT_MAX_AGE_MS + 1), null, "a re-acquired snapshot reconciles again");
});

test("the refresh cadence leaves room for a slow or failed fetch inside the trust window", () => {
  assert.ok(ORDERBOOK_SNAPSHOT_REFRESH_INTERVAL_MS * 2 < ORDERBOOK_SNAPSHOT_MAX_AGE_MS, "at least two refreshes fit in one window");
});

test("the runtime refreshes snapshots on a timer, only for a connected current generation, and stops the timer", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "cloud", "src", "runtime.ts"), "utf8");
  assert.match(source, /setInterval\(\(\) => \{ if \(marketDataClient != null && marketConnectionState === "CONNECTED"\) refreshOrderBookSnapshots\(marketConnectionGeneration\); \}, ORDERBOOK_SNAPSHOT_REFRESH_INTERVAL_MS\)/);
  assert.match(source, /if \(marketConnectionState === "CONNECTED" && generation === marketConnectionGeneration\) orderBookReconciler\.installSnapshot\(snapshot\)/);
  assert.match(source, /clearInterval\(orderBookSnapshotTimer\)/);
  assert.match(source, /if \(heartbeat\.lastError === "PAPER_ORDERBOOK_UNRECONCILED"\) heartbeat\.lastError = null;/);
  assert.equal((source.match(/fetchUpbitOrderBookSnapshot\(market\)/g) ?? []).length, 1, "one shared fetch path for connect and refresh");
});
