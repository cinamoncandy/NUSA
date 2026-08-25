const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { resolveDesktopPaperMode } = require("../dist/apps/desktop/src/paper/paperMode.js");
const { activateCloudCanonicalDesktopAuthority } = require("../dist/apps/desktop/src/paper/desktopPaperAuthorityPolicy.js");
const { parsePaperOrderIpc } = require("../dist/apps/desktop/src/ipc/paperIpcValidation.js");
const { DesktopCloudPaperAuthority } = require("../dist/apps/desktop/src/cloud/desktopCloudPaperAuthority.js");
const { provisionDesktopCloudPaperSession } = require("../dist/apps/desktop/src/cloud/desktopCloudPaperIpc.js");
const { buildPersonalPaperOperationsSnapshot } = require("../dist/packages/contracts/src/personalPaperOperations.js");

function canonicalSnapshot(now = Date.now()) {
  const dashboard = {
    apiVersion: "1", generatedAt: now, mode: "PAPER", killSwitchActive: false,
    overallHealth: "HEALTHY", tradingAllowed: true, headline: "healthy", issues: [],
    deployableCapital: 100000, deployedCapital: 5000, cashCapital: 95000, reservedCapital: 0,
    spotCapital: 5000, futuresCapital: 0, positions: [], decisions: [], staleIntelligenceSources: []
  };
  return buildPersonalPaperOperationsSnapshot({
    dashboard, research: null, operations: {
      runtimeState: "READY", schedulerRunning: false, schedulerMode: "OFF", pipelineStage: "IDLE",
      transport: "ONLINE", killSwitchActive: false, accountHalted: false, pendingWrites: 0, updatedAt: now
    },
    portfolio: {
      observedAt: new Date(now).toISOString(), mode: "PAPER", openOrderCount: 0,
      account: { available: true, cash: 95000, equity: 100000, unrealizedPnl: 0, assetValue: 5000,
        realizedPnl: 0, markPrice: 50000,
        position: { market: "KRW-BTC", quantity: 0.1, averagePrice: 50000, realizedPnl: 0, unrealizedPnl: 0 } }
    },
    orders: [{ id: "cloud-order-1", market: "KRW-BTC", side: "BUY", quantity: 0.1, price: 50000, fee: 2.5,
      filledAt: new Date(now).toISOString(), status: "FILLED",
      fills: [{ id: "cloud-fill-1", quantity: 0.1, price: 50000, filledAt: new Date(now).toISOString() }] }],
    markets: [{ market: "KRW-BTC", price: 50000, changeRate: 0.03, volume: 1, observedAt: new Date(now).toISOString(), source: "UPBIT_PUBLIC_TICKER" }]
  }, now);
}

test("packaged Desktop defaults to Cloud PAPER and prohibits packaged LOCAL_SIMULATION", () => {
  assert.equal(resolveDesktopPaperMode({ packaged: true }), "CLOUD_PAPER");
  assert.equal(resolveDesktopPaperMode({ packaged: false, requestedMode: "LOCAL_SIMULATION" }), "LOCAL_SIMULATION");
  assert.equal(resolveDesktopPaperMode({ packaged: true, requestedMode: "READ_ONLY_REAL" }), "READ_ONLY_REAL");
  assert.throws(() => resolveDesktopPaperMode({ packaged: true, requestedMode: "LOCAL_SIMULATION" }), /prohibited/i);
});

test("Cloud canonical bootstrap blocks the legacy local paper order IPC before broker mutation", () => {
  activateCloudCanonicalDesktopAuthority();
  assert.throws(() => parsePaperOrderIpc({ side: "BUY", quantity: 0.001 }), /Local Paper order mutation is disabled/i);
});

test("Desktop Cloud authority returns canonical Cloud account truth and never owns a local broker fallback", async () => {
  const snapshot = canonicalSnapshot();
  let submitted;
  const client = {
    loadOperations: async () => ({ status: "READY", value: snapshot }),
    submitOrder: async (command) => {
      submitted = command;
      return { status: "READY", value: {
        schemaVersion: 1, status: "FILLED", idempotencyKey: command.idempotencyKey,
        market: command.market, side: command.side, orderType: command.orderType, quantity: command.quantity,
        order: snapshot.orders[0], snapshot, liveAuthority: "NONE", productionMutationAllowed: false
      } };
    }
  };
  const authority = new DesktopCloudPaperAuthority({ client, now: () => 123456789, createId: () => "fixed-request-id" });
  const before = await authority.snapshot();
  assert.equal(before.cash, 95000);
  assert.equal(before.position.quantity, 0.1);
  const result = await authority.placeOrder("BUY", 0.1);
  assert.equal(result.order.id, "cloud-order-1");
  assert.equal(result.snapshot.equity, 100000);
  assert.equal(submitted.authority, "PAPER_ONLY");
  assert.equal(submitted.productionMutationAllowed, false);
  assert.match(submitted.idempotencyKey, /^desktop:123456789:fixed-request-id$/);
  assert.equal(Object.prototype.hasOwnProperty.call(authority, "broker"), false);
});

test("Desktop Cloud authority fails closed for Cloud rejection or unavailability", async () => {
  const rejected = new DesktopCloudPaperAuthority({ client: {
    loadOperations: async () => ({ status: "UNAVAILABLE", reason: "cloud offline" }),
    submitOrder: async (command) => ({ status: "READY", value: {
      schemaVersion: 1, status: "BLOCKED", idempotencyKey: command.idempotencyKey,
      market: command.market, side: command.side, orderType: command.orderType, quantity: command.quantity,
      reason: "P0_BLOCKED", liveAuthority: "NONE", productionMutationAllowed: false
    } })
  }, now: () => 1, createId: () => "1234567890abcdef" });
  await assert.rejects(() => rejected.snapshot(), /cloud offline/i);
  await assert.rejects(() => rejected.placeOrder("BUY", 0.001), /P0_BLOCKED/i);
});

test("Desktop consumes only the one-time bootstrap environment credential and removes it after use", async () => {
  const bootstrapToken = "b".repeat(40);
  const env = {
    NUSA_CLOUD_PAPER_ENDPOINT: "https://paper.example.test",
    NUSA_CLOUD_PAPER_BOOTSTRAP_TOKEN: bootstrapToken
  };
  let observed;
  const session = {
    async bootstrap(endpoint, token) { observed = { endpoint, token }; },
    async restore() { throw new Error("restore must not run"); }
  };
  await provisionDesktopCloudPaperSession(session, env);
  assert.deepEqual(observed, { endpoint: "https://paper.example.test", token: bootstrapToken });
  assert.equal(env.NUSA_CLOUD_PAPER_BOOTSTRAP_TOKEN, undefined);
  assert.equal(env.NUSA_CLOUD_PAPER_ACCESS_TOKEN, undefined);
});

test("Desktop rejects legacy stable access-token injection and erases credential environment values", async () => {
  const env = {
    NUSA_CLOUD_PAPER_ENDPOINT: "https://paper.example.test",
    NUSA_CLOUD_PAPER_ACCESS_TOKEN: "x".repeat(40),
    NUSA_CLOUD_PAPER_BOOTSTRAP_TOKEN: "b".repeat(40)
  };
  let called = false;
  const session = {
    async bootstrap() { called = true; },
    async restore() { called = true; }
  };
  await assert.rejects(() => provisionDesktopCloudPaperSession(session, env), /access-token injection is prohibited/i);
  assert.equal(called, false);
  assert.equal(env.NUSA_CLOUD_PAPER_ACCESS_TOKEN, undefined);
  assert.equal(env.NUSA_CLOUD_PAPER_BOOTSTRAP_TOKEN, undefined);
});

test("Desktop restores the safeStorage-backed session when no one-time bootstrap token is supplied", async () => {
  const env = { NUSA_CLOUD_PAPER_ENDPOINT: "https://paper.example.test" };
  let restored = 0;
  const session = {
    async bootstrap() { throw new Error("bootstrap must not run"); },
    async restore() { restored += 1; return true; }
  };
  await provisionDesktopCloudPaperSession(session, env);
  assert.equal(restored, 1);
});

test("packaging and preload expose Cloud PAPER rather than legacy local order/read surfaces", () => {
  const rootPackage = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  const desktopPackage = JSON.parse(fs.readFileSync(path.join(process.cwd(), "apps/desktop/package.json"), "utf8"));
  const preload = fs.readFileSync(path.join(process.cwd(), "apps/desktop/src/preload.ts"), "utf8");
  const bootstrap = fs.readFileSync(path.join(process.cwd(), "apps/desktop/src/cloudMain.ts"), "utf8");
  const ipc = fs.readFileSync(path.join(process.cwd(), "apps/desktop/src/cloud/desktopCloudPaperIpc.ts"), "utf8");
  assert.equal(rootPackage.main, "dist/apps/desktop/src/cloudMain.js");
  assert.equal(rootPackage.build.extraMetadata.main, "dist/apps/desktop/src/cloudMain.js");
  assert.equal(desktopPackage.main, "../../dist/apps/desktop/src/cloudMain.js");
  assert.match(preload, /cloud-paper:order/);
  assert.match(preload, /cloud-paper:snapshot/);
  assert.doesNotMatch(preload, /invokeMutation\("paper:order"/);
  assert.doesNotMatch(preload, /subscribe\("paper:snapshot"/);
  assert.match(bootstrap, /activateCloudCanonicalDesktopAuthority\(\)/);
  assert.match(bootstrap, /registerDesktopCloudPaperIpc\(ipcMain, createDesktopCloudSessionClient\(\)\)/);
  assert.match(ipc, /NUSA_CLOUD_PAPER_BOOTSTRAP_TOKEN/);
  assert.match(ipc, /Legacy Cloud PAPER access-token injection is prohibited/);
  assert.doesNotMatch(preload, /BOOTSTRAP_TOKEN|ACCESS_TOKEN|refreshToken|accessToken/);
});
