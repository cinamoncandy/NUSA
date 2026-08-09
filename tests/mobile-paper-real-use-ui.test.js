const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { InMemoryDashboardCredentialSession } = require("../dist/apps/mobile/src/dashboardCredentialSession.js");
const {
  clearConfiguredPaperEndpoint,
  getConfiguredPaperEndpoint,
  isPaperConnectionVerified,
  markPaperConnectionVerified,
  setConfiguredPaperEndpoint
} = require("../dist/apps/mobile/src/paperConnectionSession.js");
const { loadPersonalPaperOperations } = require("../dist/apps/mobile/src/personalPaperOperationsClient.js");
const { submitPersonalPaperOrder } = require("../dist/apps/mobile/src/personalPaperOrderClient.js");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const command = () => ({ schemaVersion: 1, authority: "PAPER_ONLY", productionMutationAllowed: false, idempotencyKey: "paper-ui-binding-0001", market: "KRW-BTC", side: "BUY", orderType: "MARKET", quantity: 0.001 });

test.beforeEach(() => clearConfiguredPaperEndpoint());
test.afterEach(() => clearConfiguredPaperEndpoint());

test("fresh install is a truthful local PAPER entry, not fake account authentication", () => {
  const app = read("apps/mobile/App.tsx");
  assert.match(app, /testID="local-entry-submit"/);
  assert.match(app, /개인 모드 시작/);
  assert.match(app, /계정 인증이 아닙니다/);
  assert.match(app, /PAPER ONLY/);
  assert.match(app, /LIVE NONE/);
  assert.doesNotMatch(app, /testID="auth-email"|testID="auth-password"/);
  assert.doesNotMatch(app, /dashboard-credential/);
  assert.doesNotMatch(app, /EXPO_PUBLIC_NUSA_MONITOR_URL/);
});

test("Settings is the single PAPER endpoint and memory credential setup path", () => {
  const app = read("apps/mobile/App.tsx");
  const settings = read("apps/mobile/src/settingsView.tsx");
  assert.match(app, /dashboard-open-settings/);
  assert.match(app, /설정에서 PAPER 연결/);
  assert.match(settings, /settings-paper-endpoint/);
  assert.match(settings, /settings-paper-token/);
  assert.match(settings, /settings-paper-connect/);
  assert.match(settings, /settings-paper-disconnect/);
  assert.match(settings, /allowUnverifiedEndpoint: true/);
  assert.match(settings, /markPaperConnectionVerified/);
  assert.match(settings, /clearPaperConnectionVerification/);
  assert.match(settings, /credentialSession\.clear\(\)/);
  assert.doesNotMatch(app, /NusaTextField/);
});

test("unverified or mismatched endpoint cannot access credential provider or transport", async () => {
  const session = new InMemoryDashboardCredentialSession();
  const endpointA = "https://a.example.test";
  const endpointB = "https://b.example.test";
  setConfiguredPaperEndpoint(endpointA);
  session.connect("paper-dashboard-token-123456789");
  let credentialReads = 0;
  let requests = 0;
  const credentialProvider = async () => { credentialReads += 1; return session.credentialProvider(); };
  const request = async () => { requests += 1; return { ok: false, status: 503 }; };

  const unverified = await loadPersonalPaperOperations({ baseUrl: endpointA, credentialProvider, request });
  assert.equal(unverified.status, "NOT_CONFIGURED");
  assert.equal(credentialReads, 0);
  assert.equal(requests, 0);

  markPaperConnectionVerified(endpointA);
  const mismatched = await loadPersonalPaperOperations({ baseUrl: endpointB, credentialProvider, request });
  assert.equal(mismatched.status, "NOT_CONFIGURED");
  assert.equal(credentialReads, 0);
  assert.equal(requests, 0);

  const orderMismatch = await submitPersonalPaperOrder({ baseUrl: endpointB, credentialProvider, request }, command());
  assert.equal(orderMismatch.status, "NOT_CONFIGURED");
  assert.equal(credentialReads, 0);
  assert.equal(requests, 0);
});

test("verified endpoint is the only credential-bearing target and endpoint change revokes token", async () => {
  const session = new InMemoryDashboardCredentialSession();
  const endpointA = "https://a.example.test";
  const endpointB = "https://b.example.test";
  setConfiguredPaperEndpoint(endpointA);
  session.connect("paper-dashboard-token-123456789");
  markPaperConnectionVerified(endpointA);
  let observed = "";
  let requests = 0;
  const result = await loadPersonalPaperOperations({
    baseUrl: endpointA,
    credentialProvider: session.credentialProvider,
    request: async (url) => { requests += 1; observed = String(url); return { ok: false, status: 503 }; }
  });
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(requests, 1);
  assert.equal(observed, `${endpointA}/api/paper-operations`);
  assert.equal(isPaperConnectionVerified(endpointA), true);
  assert.equal(session.isConfigured(), true);

  setConfiguredPaperEndpoint(endpointB);
  assert.equal(getConfiguredPaperEndpoint(), endpointB);
  assert.equal(isPaperConnectionVerified(endpointB), false);
  assert.equal(session.isConfigured(), false, "endpoint identity change must revoke the shared token");

  let credentialReads = 0;
  const afterChange = await loadPersonalPaperOperations({
    baseUrl: endpointB,
    credentialProvider: async () => { credentialReads += 1; return "must-not-be-read"; },
    request: async () => { requests += 1; return { ok: false, status: 503 }; }
  });
  assert.equal(afterChange.status, "NOT_CONFIGURED");
  assert.equal(credentialReads, 0);
  assert.equal(requests, 1);
});

test("verified PAPER connection is shared and Trading is gated by that exact endpoint", () => {
  const connection = read("apps/mobile/src/paperConnectionSession.ts");
  const app = read("apps/mobile/App.tsx");
  const trading = read("apps/mobile/src/tradingView.tsx");
  assert.match(connection, /clearDashboardCredentialSession/);
  assert.match(connection, /configuredEndpoint !== next/);
  assert.match(connection, /verifiedEndpoint = null/);
  assert.match(app, /getConfiguredPaperEndpoint/);
  assert.match(app, /isPaperConnectionVerified\(endpoint\)/);
  assert.match(trading, /isPaperConnectionVerified\(configuredEndpoint\)/);
  assert.match(trading, /설정에서 PAPER endpoint와 세션을 먼저 검증하세요/);
});

test("PAPER submit remains explicit two-step, idempotent, and never claims LIVE authority", () => {
  const trading = read("apps/mobile/src/tradingView.tsx");
  const components = read("apps/mobile/src/components.tsx");
  assert.match(trading, /PAPER 주문 확인/);
  assert.match(trading, /PAPER 주문 확정/);
  assert.match(trading, /PersonalPaperOrderRetryIdentity/);
  assert.match(trading, /authority: "PAPER_ONLY"/);
  assert.match(trading, /productionMutationAllowed: false/);
  assert.match(components, /AI ZERO AUTHORITY/);
  assert.match(components, /AI 주문 권한 없음/);
  assert.doesNotMatch(components, />ZERO ORDER AUTHORITY</);
});

test("primary mobile workspaces use intentional tablet composition, not maxWidth alone", () => {
  const app = read("apps/mobile/App.tsx");
  const markets = read("apps/mobile/src/marketsView.tsx");
  assert.match(app, /home-responsive-grid/);
  assert.match(app, /homeGrid: \{ flexDirection: "row", flexWrap: "wrap"/);
  assert.match(markets, /useWindowDimensions/);
  assert.match(markets, /markets-responsive-layout/);
  assert.match(markets, /layoutWide: \{ flexDirection: "row"/);
  for (const file of ["apps/mobile/App.tsx", "apps/mobile/src/settingsView.tsx", "apps/mobile/src/marketsView.tsx", "apps/mobile/src/tradingView.tsx", "apps/mobile/src/portfolioView.tsx", "apps/mobile/src/aiView.tsx"]) {
    assert.match(read(file), /maxWidth: 1080/, `${file} must retain the bounded tablet workspace`);
  }
});
