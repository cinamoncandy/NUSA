const test = require("node:test");
const assert = require("node:assert/strict");
const { fetchUpbitOrderBookSnapshot, UpbitOrderBookReconciler } = require("../dist/apps/cloud/src/upbitOrderBookReconciliation.js");

const book = (code = "KRW-BTC") => ({
  type: "orderbook", code, total_ask_size: 2, total_bid_size: 2,
  orderbook_units: [{ ask_price: 101, bid_price: 99, ask_size: 1, bid_size: 1 }]
});

test("long-lived stream refreshes expired snapshots and coalesces requests", async () => {
  let now = 1_700_000_000_000;
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: true, json: async () => [{ market: "KRW-BTC", timestamp: now }] }; };
  const reconciler = new UpbitOrderBookReconciler();
  await reconciler.refreshSnapshot("KRW-BTC", fetchImpl, () => now);
  now += 30_001;
  assert.equal(reconciler.reconcile(book(), now), null);
  const first = reconciler.refreshSnapshot("KRW-BTC", fetchImpl, () => now);
  assert.equal(reconciler.refreshSnapshot("KRW-BTC", fetchImpl, () => now), first);
  await first;
  assert.equal(calls, 2);
  assert.ok(reconciler.reconcile(book(), now));
});

test("failed snapshot refresh backs off and reconnect fences old requests", async () => {
  let now = 1_700_000_000_000;
  const reconciler = new UpbitOrderBookReconciler();
  let calls = 0;
  const failed = async () => { calls++; return { ok: false, status: 429 }; };
  await assert.rejects(reconciler.refreshSnapshot("KRW-BTC", failed, () => now), /429/);
  await reconciler.refreshSnapshot("KRW-BTC", failed, () => now);
  assert.equal(calls, 1);
  assert.equal(reconciler.reconcile(book(), now), null);
  now += 5_000;
  let release;
  const pending = reconciler.refreshSnapshot("KRW-BTC", () => new Promise(resolve => { release = resolve; }), () => now);
  reconciler.reset();
  release({ ok: true, json: async () => [{ market: "KRW-BTC", timestamp: now }] });
  await pending;
  assert.equal(reconciler.reconcile(book(), now), null);
  await reconciler.refreshSnapshot("KRW-BTC", async () => ({ ok: true, json: async () => [{ market: "KRW-BTC", timestamp: now }] }), () => now);
  assert.ok(reconciler.reconcile(book(), now));
});

test("valid REST snapshot gates first matching stream into reconciled state", async () => {
  const now = 1_700_000_000_000;
  const fetchImpl = async () => ({ ok: true, json: async () => [{ market: "KRW-BTC", timestamp: now - 10, total_ask_size: 2, total_bid_size: 2, orderbook_units: [] }] });
  const snapshot = await fetchUpbitOrderBookSnapshot("krw-btc", fetchImpl, () => now);
  const reconciler = new UpbitOrderBookReconciler();
  assert.equal(reconciler.reconcile(book(), now + 1), null, "stream without snapshot must fail closed");
  reconciler.installSnapshot(snapshot);
  const result = reconciler.reconcile(book(), now + 1);
  assert.equal(result?.state, "RECONCILED");
  assert.equal(result?.snapshot.market, "KRW-BTC");
  assert.match(result?.snapshot.sourceFingerprint, /^[a-f0-9]{64}$/);
  assert.match(result?.reconciliationId, /^upbit-orderbook:KRW-BTC:/);
});

test("reset requires a new snapshot after reconnect", async () => {
  const now = 1_700_000_000_000;
  const snapshot = await fetchUpbitOrderBookSnapshot("KRW-BTC", async () => ({ ok: true, json: async () => [{ market: "KRW-BTC", timestamp: now }] }), () => now);
  const reconciler = new UpbitOrderBookReconciler();
  reconciler.installSnapshot(snapshot);
  assert.ok(reconciler.reconcile(book(), now + 1));
  reconciler.reset();
  assert.equal(reconciler.reconcile(book(), now + 2), null);
});

test("stale, future, mismatched and failed snapshots are rejected", async () => {
  const now = 1_700_000_000_000;
  const response = (row) => async () => ({ ok: true, json: async () => [row] });
  await assert.rejects(() => fetchUpbitOrderBookSnapshot("KRW-BTC", response({ market: "KRW-BTC", timestamp: now - 30_001 }), () => now), /stale or future/);
  await assert.rejects(() => fetchUpbitOrderBookSnapshot("KRW-BTC", response({ market: "KRW-BTC", timestamp: now + 5_001 }), () => now), /stale or future/);
  await assert.rejects(() => fetchUpbitOrderBookSnapshot("KRW-BTC", response({ market: "KRW-ETH", timestamp: now }), () => now), /market mismatch/);
  await assert.rejects(() => fetchUpbitOrderBookSnapshot("KRW-BTC", async () => ({ ok: false, status: 429 }), () => now), /status 429/);
});

test("snapshot age and market identity remain fail-closed during stream reconciliation", async () => {
  const now = 1_700_000_000_000;
  const snapshot = await fetchUpbitOrderBookSnapshot("KRW-BTC", async () => ({ ok: true, json: async () => [{ market: "KRW-BTC", timestamp: now }] }), () => now);
  const reconciler = new UpbitOrderBookReconciler();
  reconciler.installSnapshot(snapshot);
  assert.equal(reconciler.reconcile(book("KRW-ETH"), now + 1), null);
  assert.equal(reconciler.reconcile(book(), now + 30_001), null);
});
