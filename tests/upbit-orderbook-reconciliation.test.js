const test = require("node:test");
const assert = require("node:assert/strict");
const { fetchUpbitOrderBookSnapshot, UpbitOrderBookReconciler, SNAPSHOT_RENEW_AFTER_MS } = require("../dist/apps/cloud/src/upbitOrderBookReconciliation.js");

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

test("runtime recovers orderbook diagnostics only after valid quotes for every market", async (t) => {
  const { startCloudRuntime } = require("../dist/apps/cloud/src/runtime.js");
  const { InMemoryCloudDashboardStateProvider } = require("../dist/apps/cloud/src/cloudDashboardStateProvider.js");
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (!String(url).startsWith("https://api.upbit.com/v1/orderbook?")) return originalFetch(url, options);
    return { ok: true, json: async () => [{ market: new URL(url).searchParams.get("markets"), timestamp: now }] };
  });
  let connection, orderbook;
  const handle = startCloudRuntime({
    NUSA_CLOUD_DASHBOARD_PORT: "42984",
    NUSA_CLOUD_DASHBOARD_TOKEN: "orderbook-runtime-test-token-012345678901",
    NUSA_CLOUD_UPBIT_PUBLIC_DATA: "true",
    NUSA_CLOUD_UPBIT_MARKETS: "KRW-BTC,KRW-ETH",
  }, new InMemoryCloudDashboardStateProvider(), undefined, (_markets, _ticker, state, stream) => {
    connection = state; orderbook = stream;
    return { subscribe() {}, start() {}, stop() {} };
  });
  const health = async () => (await originalFetch("http://127.0.0.1:42984/health")).json();
  try {
    connection("CONNECTED");
    await new Promise(resolve => setImmediate(resolve));
    now += 30_001;
    orderbook(book()); orderbook(book("KRW-ETH"));
    assert.equal((await health()).runtime.lastError, "PAPER_ORDERBOOK_UNRECONCILED");
    await new Promise(resolve => setImmediate(resolve));
    orderbook(book());
    assert.equal((await health()).runtime.lastError, "PAPER_ORDERBOOK_UNRECONCILED");
    orderbook(book("KRW-ETH"));
    assert.equal((await health()).runtime.lastError, null);
    assert.notEqual((await health()).runtimeHealth.workload.state, "HEALTHY", "no accepted ticker receipt means recovery is not yet workload proof");
  } finally { await handle.stop(); }
});

test("a snapshot is renewed before it expires, so a steady stream never reaches the unreconciled path", async () => {
  let now = 1_700_000_000_000;
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: true, json: async () => [{ market: "KRW-XRP", timestamp: now }] }; };
  const reconciler = new UpbitOrderBookReconciler();
  assert.equal(reconciler.needsRefresh("KRW-XRP", now), true, "no snapshot yet");
  await reconciler.refreshSnapshot("KRW-XRP", fetchImpl, () => now);
  assert.equal(reconciler.needsRefresh("KRW-XRP", now + SNAPSHOT_RENEW_AFTER_MS - 1), false);
  assert.equal(reconciler.needsRefresh("KRW-XRP", now + SNAPSHOT_RENEW_AFTER_MS), true);
  assert.ok(SNAPSHOT_RENEW_AFTER_MS < 30_000, "renewal starts well inside the validity window");
  // Simulate the stream: an event every second for two minutes, renewing as the runtime now does.
  let failures = 0;
  const start = now;
  for (let t = 1; t <= 120; t += 1) {
    now = start + t * 1000;
    if (reconciler.needsRefresh("KRW-XRP", now)) await reconciler.refreshSnapshot("KRW-XRP", fetchImpl, () => now);
    if (reconciler.reconcile({ ...book("KRW-XRP") }, now) == null) failures += 1;
  }
  assert.equal(failures, 0, "no stream event ever found an expired snapshot");
  assert.ok(calls >= 7 && calls <= 10, `about one refresh per 15 s, got ${calls}`);
});

test("renewal never extends validity: an old snapshot is still rejected, and a failed renewal keeps the old one until it expires", async () => {
  let now = 1_700_000_000_000;
  const ok = async () => ({ ok: true, json: async () => [{ market: "KRW-XRP", timestamp: now }] });
  const reconciler = new UpbitOrderBookReconciler();
  await reconciler.refreshSnapshot("KRW-XRP", ok, () => now);
  const installedAt = now;
  now = installedAt + 20_000;
  await assert.rejects(reconciler.refreshSnapshot("KRW-XRP", async () => ({ ok: false, status: 429 }), () => now), /429/);
  assert.ok(reconciler.reconcile(book("KRW-XRP"), now), "the old snapshot still reconciles inside 30 s");
  now = installedAt + 30_001;
  assert.equal(reconciler.reconcile(book("KRW-XRP"), now), null, "and is rejected once it is older than 30 s");
});

test("the runtime renews through the reconciler and ignores a failed renewal", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const runtime = fs.readFileSync(path.resolve(__dirname, "../apps/cloud/src/runtime.ts"), "utf8");
  assert.match(runtime, /marketConnectionState === "CONNECTED" && orderBookReconciler\.needsRefresh\(orderBook\.code, receivedAt\)\) void orderBookReconciler\.refreshSnapshot\(orderBook\.code\)\.catch\(\(\) => undefined\)/);
  const renewAt = runtime.indexOf("orderBookReconciler.needsRefresh(");
  const quoteAt = runtime.indexOf("const quote = buildPaperObservedExecutionQuote(", renewAt);
  assert.ok(renewAt > 0 && quoteAt > renewAt, "renewal happens after a successful reconcile and before the quote is stored");
  assert.ok(runtime.indexOf('recordFailure("PAPER_ORDERBOOK_UNRECONCILED")') < renewAt, "the unreconciled failure path is unchanged and comes first");
});

test("without proactive renewal the same stream hits the unreconciled path about every 30 s (the defect this fixes)", async () => {
  let now = 1_700_000_000_000;
  const fetchImpl = async () => ({ ok: true, json: async () => [{ market: "KRW-XRP", timestamp: now }] });
  const reconciler = new UpbitOrderBookReconciler();
  await reconciler.refreshSnapshot("KRW-XRP", fetchImpl, () => now);
  let failures = 0;
  const start = now;
  for (let t = 1; t <= 120; t += 1) {
    now = start + t * 1000;
    if (reconciler.reconcile(book("KRW-XRP"), now) == null) {
      failures += 1; // the runtime records PAPER_ORDERBOOK_UNRECONCILED here, then refreshes reactively
      await reconciler.refreshSnapshot("KRW-XRP", fetchImpl, () => now);
    }
  }
  assert.ok(failures >= 3, `reactive-only renewal fails once per validity window, got ${failures}`);
});
