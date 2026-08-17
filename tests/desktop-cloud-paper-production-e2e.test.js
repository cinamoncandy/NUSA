const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { startCloudRuntime } = require("../dist/apps/cloud/src/runtime.js");
const { CloudPaperAccessSession } = require("../dist/apps/desktop/src/cloudPaperAccessSession.js");
const { CloudPaperClient } = require("../dist/apps/desktop/src/cloudPaperClient.js");
const { DesktopCloudPaperAuthority } = require("../dist/apps/desktop/src/desktopCloudPaperAuthority.js");

const ACCESS_VALUE = "p".repeat(40);

async function allocatePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise((resolve) => server.close(resolve));
  assert.ok(port >= 1024);
  return port;
}

function createMarketFactory(price) {
  return (_markets, onTicker, onConnectionState) => ({
    subscribe(markets) {
      assert.deepEqual(markets, ["KRW-BTC"]);
    },
    start() {
      const now = Date.now();
      onConnectionState("CONNECTED");
      // Keep CIO in WAIT so this test proves the Desktop manual path rather than allowing
      // an automatic strategy tick to create the position before Desktop submits a command.
      onTicker({
        type: "ticker",
        code: "KRW-BTC",
        trade_price: price,
        trade_timestamp: now,
        signed_change_rate: 0.001,
        acc_trade_price_24h: 1_000_000_000,
        acc_trade_volume: 100
      });
    },
    stop() {}
  });
}

function createEnvironment(port, databasePath) {
  return {
    NUSA_CLOUD_DASHBOARD_PORT: String(port),
    NUSA_CLOUD_DASHBOARD_HOST: "127.0.0.1",
    NUSA_CLOUD_DASHBOARD_TOKEN: ACCESS_VALUE,
    NUSA_CLOUD_UPBIT_MARKETS: "KRW-BTC",
    NUSA_CLOUD_UPBIT_PUBLIC_DATA: "true",
    NUSA_CLOUD_STATE_DB_PATH: databasePath,
    NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW: "100000",
    NUSA_CLOUD_PAPER_INVESTMENT_PERCENT: "100",
    NUSA_SOURCE_COMMIT: "a".repeat(40)
  };
}

function connectClient(port, value = ACCESS_VALUE) {
  const session = new CloudPaperAccessSession();
  session.connect(`http://127.0.0.1:${port}`, value);
  return { session, client: new CloudPaperClient({ session, timeoutMs: 2_000 }) };
}

async function waitForOperations(client, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let latest;
  while (Date.now() < deadline) {
    latest = await client.loadOperations();
    if (latest.status === "READY" && latest.value.portfolio != null) return latest.value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Cloud PAPER operations did not become ready: ${latest?.status ?? "NO_RESULT"}`);
}

async function waitForClosedPort(port, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/health`);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Cloud PAPER server did not stop");
}

test("Desktop manual PAPER uses the production Cloud HTTP/risk/SQLite authority, survives restart, and never falls back locally", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-desktop-cloud-paper-e2e-"));
  const databasePath = path.join(directory, "cloud.sqlite");
  const port = await allocatePort();
  let runtime;
  try {
    runtime = startCloudRuntime(
      createEnvironment(port, databasePath),
      undefined,
      undefined,
      createMarketFactory(50_000)
    );

    const { client } = connectClient(port);
    const initial = await waitForOperations(client);
    assert.equal(initial.liveAuthority, "NONE");
    assert.equal(initial.productionMutationAllowed, false);
    assert.equal(initial.portfolio.account.cash, 100_000);
    assert.equal(initial.orders.length, 0);

    // Freeze the Desktop request identity so invoking the same user action twice proves the
    // canonical Cloud idempotency ledger rather than creating a second distinct command.
    const buyer = new DesktopCloudPaperAuthority({
      client,
      now: () => 1_700_000_000_000,
      createId: () => "desktop-buy-idempotency-0001"
    });
    const buy = await buyer.placeOrder("BUY", 0.1);
    assert.equal(buy.order.side, "BUY");
    assert.ok(buy.order.fee > 0);
    assert.equal(buy.snapshot.position.market, "KRW-BTC");
    assert.ok(buy.snapshot.position.quantity > 0);
    assert.ok(buy.snapshot.cash < initial.portfolio.account.cash);
    assert.equal(buy.snapshot.orders.length, 1);

    const duplicate = await buyer.placeOrder("BUY", 0.1);
    assert.equal(duplicate.order.id, buy.order.id);
    assert.equal(duplicate.snapshot.orders.length, 1);
    assert.equal(duplicate.snapshot.position.quantity, buy.snapshot.position.quantity);

    const wrong = connectClient(port, "z".repeat(40));
    const rejected = await wrong.client.loadOperations();
    assert.equal(rejected.status, "UNAVAILABLE");
    const afterRejected = await waitForOperations(client);
    assert.equal(afterRejected.orders.length, 1);
    assert.equal(afterRejected.portfolio.account.position.quantity, buy.snapshot.position.quantity);

    const beforeRestart = await buyer.snapshot();
    assert.ok(beforeRestart);
    await runtime.stop();
    runtime = undefined;
    await waitForClosedPort(port);

    runtime = startCloudRuntime(
      createEnvironment(port, databasePath),
      undefined,
      undefined,
      createMarketFactory(55_000)
    );
    const restartedConnection = connectClient(port);
    const restoredOperations = await waitForOperations(restartedConnection.client);
    const restored = restoredOperations.portfolio;
    assert.ok(restored);
    assert.equal(restored.account.position.quantity, beforeRestart.position.quantity);
    assert.equal(restoredOperations.orders.length, 1);
    assert.equal(restoredOperations.orders[0].id, buy.order.id);

    const seller = new DesktopCloudPaperAuthority({
      client: restartedConnection.client,
      now: () => 1_700_000_001_000,
      createId: () => "desktop-sell-idempotency-0001"
    });
    const sell = await seller.placeOrder("SELL", restored.account.position.quantity);
    assert.equal(sell.order.side, "SELL");
    assert.equal(sell.snapshot.position.quantity, 0);
    assert.ok(sell.snapshot.position.realizedPnl > 0);
    assert.equal(sell.snapshot.orders.length, 2);

    const finalOperations = await waitForOperations(restartedConnection.client);
    assert.equal(finalOperations.liveAuthority, "NONE");
    assert.equal(finalOperations.productionMutationAllowed, false);
    assert.equal(finalOperations.orders.length, 2);
    assert.equal(finalOperations.portfolio.account.position.quantity, 0);
    assert.ok(finalOperations.portfolio.account.realizedPnl > 0);
  } finally {
    try { await runtime?.stop(); } catch {}
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
