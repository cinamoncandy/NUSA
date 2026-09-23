const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("fresh install is a truthful local PAPER entry, not fake account authentication", () => {
  const app = read("apps/mobile/App.tsx");
  assert.match(app, /testID="local-entry-submit"/);
  assert.match(app, /개인 모드 시작/);
  assert.match(app, /PAPER ONLY/);
  assert.match(app, /LIVE NONE/);
  assert.doesNotMatch(app, /testID="auth-email"|testID="auth-password"/);
});

test("Settings keeps Cloud PAPER setup separate from the supervision surfaces", () => {
  const app = read("apps/mobile/App.tsx");
  const settings = read("apps/mobile/src/settingsView.tsx");
  assert.match(app, /<HomeView/);
  assert.match(settings, /settings-paper-endpoint/);
  assert.match(settings, /settings-paper-token/);
  assert.match(settings, /settings-paper-connect/);
  assert.match(settings, /settings-paper-disconnect/);
  assert.match(settings, /markPaperConnectionVerified/);
  assert.match(settings, /clearPaperConnectionVerification/);
  assert.match(settings, /복구 옵션/);
  assert.match(settings, /1회용 복구 키/);
  assert.match(settings, /6자리 코드로 복구 연결/);
  assert.doesNotMatch(settings, /bootstrap token은 저장하지 않고 한 번만 세션으로 교환합니다/);
  assert.doesNotMatch(app, /NusaTextField/);
});

test("cold start restores the saved endpoint before the first dashboard refresh", () => {
  const app = read("apps/mobile/App.tsx");
  const settings = read("apps/mobile/src/settingsView.tsx");
  assert.match(app, /setConfiguredPaperEndpoint\(settings\.paperEndpoint\)/);
  assert.match(app, /setConfiguredPaperEndpoint\(""\)/);
  assert.match(settings, /setConfiguredPaperEndpoint\(next\.paperEndpoint\)/);
  assert.match(settings, /setConfiguredPaperEndpoint\(normalized\.paperEndpoint\)/);
});

test("verified PAPER connection is owned by the session boundary and App data loaders", () => {
  const connection = read("apps/mobile/src/paperConnectionSession.ts");
  const app = read("apps/mobile/App.tsx");
  assert.match(connection, /verifiedEndpoint/);
  assert.match(connection, /verifiedEndpoint = null/);
  assert.match(connection, /markPaperConnectionVerified/);
  assert.match(connection, /isPaperConnectionVerified/);
  assert.match(app, /endpoint == null \|\| !isPaperConnectionVerified\(endpoint\)/);
});

test("normal PAPER clients use only the Settings-configured verified endpoint", () => {
  const app = read("apps/mobile/App.tsx");
  const operations = read("apps/mobile/src/personalPaperOperationsClient.ts");
  const orders = read("apps/mobile/src/personalPaperOrderClient.ts");
  assert.doesNotMatch(app, /EXPO_PUBLIC_NUSA_MONITOR_URL/);
  assert.match(app, /const endpoint = getConfiguredPaperEndpoint\(\)/);
  assert.match(app, /loadPersonalPaperOperations\(\{ baseUrl: endpoint, credentialProvider: credentialSession\.credentialProvider \}\)/);
  assert.match(operations, /options\.allowUnverifiedEndpoint !== true && !isPaperConnectionVerified\(configured\)/);
  assert.match(orders, /isPaperConnectionVerified\(configured\)/);
  assert.doesNotMatch(orders, /productionMutationAllowed:\s*true/);
});

// The manual PAPER order contract this block covered moved to
// tests/mobile-no-order-submission-surface.test.js when tradingView.tsx and
// tradingViewLegacy.tsx were deleted: there is no order submission surface left to assert on.

test("primary mobile workspaces remain intentionally bounded and supervision-first", () => {
  const paperMonitor = read("apps/mobile/src/paperLearningMonitorView.tsx");
  const home = read("apps/mobile/src/homeView.tsx");
  const markets = read("apps/mobile/src/marketsView.tsx");
  const portfolio = read("apps/mobile/src/portfolioView.tsx");

  assert.match(paperMonitor, /contentContainerStyle=\{styles\.content\}/);
  assert.match(paperMonitor, /PAPER LEARNING · READ ONLY/);
  assert.match(paperMonitor, /RESULT \/ LEARNING/);
  assert.match(paperMonitor, /RESULT = VERIFIED PAPER P&L/);
  assert.match(paperMonitor, /LEARNING = VALIDATED EVALUATION/);

  assert.match(home, /useWindowDimensions/);
  assert.match(home, /const tablet = width >= 768/);
  assert.match(home, /const signalAvailable = decision\.aiInsightAvailable/);
  assert.match(home, /testID="home-risk-authority"/);
  assert.doesNotMatch(home, /productionMutationAllowed:\s*true/);

  assert.match(markets, /useWindowDimensions/);
  assert.match(markets, /minHeight: 48/);
  assert.match(portfolio, /testID="portfolio-authority-rail"/);
  assert.match(portfolio, /testID="portfolio-supervisor-summary"/);
});
