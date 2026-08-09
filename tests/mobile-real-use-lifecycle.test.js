const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mobile = path.resolve(__dirname, "../apps/mobile");

test("PAPER connection state is endpoint-bound, shared, and invalidated on endpoint change", () => {
  const session = require("../dist/apps/mobile/src/paperConnectionSession.js");
  session.clearPaperConnectionSession();
  session.setConfiguredPaperEndpoint("https://paper.example.test/");
  assert.deepEqual(session.getPaperConnectionState(), {
    status: "NOT_CONFIGURED",
    endpoint: "https://paper.example.test",
    reason: "PAPER endpoint changed and must be verified again.",
    verifiedAt: null
  });
  session.markPaperConnectionReady("https://paper.example.test", 1234);
  assert.equal(session.getPaperConnectionState().status, "READY");
  assert.equal(session.getPaperConnectionState().verifiedAt, 1234);

  session.setConfiguredPaperEndpoint("https://paper-2.example.test");
  assert.equal(session.getPaperConnectionState().status, "NOT_CONFIGURED");
  assert.equal(session.getPaperConnectionState().endpoint, "https://paper-2.example.test");
  assert.equal(session.getPaperConnectionState().verifiedAt, null);

  session.markPaperConnectionUnavailable("https://paper-2.example.test", "verification failed");
  assert.equal(session.getPaperConnectionState().status, "UNAVAILABLE");
  assert.equal(session.getPaperConnectionState().reason, "verification failed");
  session.clearPaperConnectionSession();
});

test("dashboard credential remains process-memory-only and shared across view instances", async () => {
  const { InMemoryDashboardCredentialSession } = require("../dist/apps/mobile/src/dashboardCredentialSession.js");
  const settingsSession = new InMemoryDashboardCredentialSession();
  const tradingSession = new InMemoryDashboardCredentialSession();
  settingsSession.clear();
  settingsSession.connect("0123456789abcdef0123456789abcdef");
  assert.equal(tradingSession.isConfigured(), true);
  assert.equal(await tradingSession.credentialProvider(), "0123456789abcdef0123456789abcdef");
  tradingSession.clear();
  assert.equal(settingsSession.isConfigured(), false);
  assert.equal(await settingsSession.credentialProvider(), null);
});

test("Settings owns credential verification and Trade requires READY shared state", () => {
  const settings = fs.readFileSync(path.join(mobile, "src", "settingsView.tsx"), "utf8");
  const trading = fs.readFileSync(path.join(mobile, "src", "tradingView.tsx"), "utf8");
  assert.match(settings, /markPaperConnectionReady/);
  assert.match(settings, /credentialSession\.clear\(\)/);
  assert.match(settings, /settings-paper-connect/);
  assert.match(settings, /settings-paper-disconnect/);
  assert.match(settings, /settings-reset-button/);
  assert.match(trading, /connection\.status === "READY"/);
  assert.match(trading, /paper-order-preview/);
  assert.match(trading, /paper-order-confirmation/);
  assert.match(trading, /paper-order-submit/);
  assert.match(trading, /paper-order-result/);
});

test("configured insecure remote HTTP remains UNAVAILABLE and is never silently downgraded", () => {
  const client = fs.readFileSync(path.join(mobile, "src", "personalPaperOperationsClient.ts"), "utf8");
  const marker = "Dashboard credential will not be sent over insecure remote HTTP.";
  const index = client.indexOf(marker);
  assert.notEqual(index, -1);
  const nearby = client.slice(Math.max(0, index - 180), index + marker.length + 20);
  assert.match(nearby, /status: "UNAVAILABLE"/);
});

test("global mobile shell exposes PAPER-only authority while AI stays zero-authority", () => {
  const app = fs.readFileSync(path.join(mobile, "App.tsx"), "utf8");
  const components = fs.readFileSync(path.join(mobile, "src", "components.tsx"), "utf8");
  assert.match(app, /testID="global-authority-strip"/);
  assert.match(app, /PAPER ONLY/);
  assert.match(app, /LIVE NONE/);
  assert.match(app, /production mutation 없음/);
  assert.match(components, /AI ZERO AUTHORITY/);
  assert.match(components, /AI 주문 권한 없음/);
  assert.doesNotMatch(app, /dashboard-session-card/);
  assert.doesNotMatch(app, /dashboard-credential/);
});
