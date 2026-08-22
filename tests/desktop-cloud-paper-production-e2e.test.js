const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { startCloudRuntime } = require("../dist/apps/cloud/src/runtime.js");
const { DesktopCloudSessionClient } = require("../dist/apps/desktop/src/cloud/desktopCloudSessionClient.js");
const { DesktopCloudSessionStore } = require("../dist/apps/desktop/src/cloud/desktopCloudSessionStore.js");
const { CloudPaperClient } = require("../dist/apps/desktop/src/cloud/cloudPaperClient.js");
const { DesktopCloudPaperAuthority } = require("../dist/apps/desktop/src/cloud/desktopCloudPaperAuthority.js");

const OWNER_BOOTSTRAP_CREDENTIAL = "p".repeat(40);
const OWNER_ID = "operator";
const ORDER_RATE_WINDOW_MS = 1_000;
const ORDER_RATE_WINDOW_SAFETY_MS = 25;

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
    // This long-lived value remains Cloud-side OWNER/bootstrap identity only. Desktop never
    // receives it as its operational PAPER bearer after WO-0057A.
    NUSA_CLOUD_DASHBOARD_TOKEN: OWNER_BOOTSTRAP_CREDENTIAL,
    NUSA_OWNER_ID: OWNER_ID,
    NUSA_OWNER_EMAIL: "owner@nusa.local",
    NUSA_CLOUD_UPBIT_MARKETS: "KRW-BTC",
    NUSA_CLOUD_UPBIT_PUBLIC_DATA: "true",
    NUSA_CLOUD_STATE_DB_PATH: databasePath,
    NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW: "100000",
    NUSA_CLOUD_PAPER_INVESTMENT_PERCENT: "100",
    NUSA_SOURCE_COMMIT: "a".repeat(40)
  };
}

const safeStorage = Object.freeze({
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "test_secure_backend",
  encryptString(value) {
    return Buffer.from([...Buffer.from(value, "utf8")].map((byte) => byte ^ 0x5a));
  },
  decryptString(value) {
    return Buffer.from([...value].map((byte) => byte ^ 0x5a)).toString("utf8");
  }
});

async function issueDesktopBootstrap(port) {
  const response = await fetch(`http://127.0.0.1:${port}/api/operator/desktop-bootstrap`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${OWNER_BOOTSTRAP_CREDENTIAL}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ targetUserId: OWNER_ID, scopes: ["dashboard:read", "paper:trade"] })
  });
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.targetUserId, OWNER_ID);
  assert.equal(typeof payload.token, "string");
  assert.ok(payload.token.length >= 32);
  return payload.token;
}

async function bootstrapDesktopClient(port, sessionPath) {
  const store = new DesktopCloudSessionStore(safeStorage, sessionPath);
  const session = new DesktopCloudSessionClient(store);
  const bootstrapToken = await issueDesktopBootstrap(port);
  await session.bootstrap(`http://127.0.0.1:${port}`, bootstrapToken);
  const snapshot = session.snapshot();
  assert.equal(snapshot.connected, true);
  assert.equal(snapshot.endpoint, `http://127.0.0.1:${port}`);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot, "accessToken"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot, "refreshToken"), false);
  return { store, session, client: new CloudPaperClient({ session, timeoutMs: 2_000 }) };
}

async function restoreDesktopClient(sessionPath) {
  const store = new DesktopCloudSessionStore(safeStorage, sessionPath);
  const session = new DesktopCloudSessionClient(store);
  assert.equal(await session.restore(), true, "Desktop restart must restore through the rotated encrypted refresh credential");
  return { store, session, client: new CloudPaperClient({ session, timeoutMs: 2_000 }) };
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

async function waitPastCanonicalOrderRateWindow(filledAt) {
  const filledAtMs = typeof filledAt === "number" ? filledAt : Date.parse(filledAt);
  assert.ok(Number.isFinite(filledAtMs), "canonical PAPER fill timestamp must be valid");
  const remaining = filledAtMs + ORDER_RATE_WINDOW_MS + ORDER_RATE_WINDOW_SAFETY_MS - Date.now();
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

test("Desktop secure session drives production Cloud HTTP/risk/SQLite PAPER authority, restores after restart, and never falls back locally", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-desktop-cloud-paper-e2e-"));
  const databasePath = path.join(directory, "cloud.sqlite");
  const sessionPath = path.join(directory, "desktop-session.json");
  const port = await allocatePort();
  let runtime;
  try {
    runtime = startCloudRuntime(
      createEnvironment(port, databasePath),
      undefined,
      undefined,
      createMarketFactory(50_000)
    );

    const firstConnection = await bootstrapDesktopClient(port, sessionPath);
    const initial = await waitForOperations(firstConnection.client);
    assert.equal(initial.liveAuthority, "NONE");
    assert.equal(initial.productionMutationAllowed, false);
    assert.equal(initial.portfolio.account.cash, 100_000);
    assert.equal(initial.orders.length, 0);

    const persistedSession = fs.readFileSync(sessionPath, "utf8");
    assert.doesNotMatch(persistedSession, /accessToken|refreshToken/);
    assert.equal(persistedSession.includes(OWNER_BOOTSTRAP_CREDENTIAL), false);

    // Freeze the Desktop request identity so invoking the same user action twice proves the
    // canonical Cloud idempotency ledger rather than creating a second distinct command.
    const buyer = new DesktopCloudPaperAuthority({
      client: firstConnection.client,
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

    // Model an Electron process restart: access memory is gone, only the safeStorage-backed
    // refresh record survives. Restore must rotate that credential before PAPER reads resume.
    const restartedConnection = await restoreDesktopClient(sessionPath);
    const restoredOperations = await waitForOperations(restartedConnection.client);
    const restored = restoredOperations.portfolio;
    assert.ok(restored);
    assert.equal(restored.account.position.quantity, beforeRestart.position.quantity);
    assert.equal(restoredOperations.orders.length, 1);
    assert.equal(restoredOperations.orders[0].id, buy.order.id);

    // The canonical risk gateway is server-clocked and allows at most one order per rolling
    // second. Bind this E2E to the persisted server fill timestamp instead of weakening the
    // production limit or pretending the Desktop request clock controls risk time.
    await waitPastCanonicalOrderRateWindow(buy.order.filledAt);

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
