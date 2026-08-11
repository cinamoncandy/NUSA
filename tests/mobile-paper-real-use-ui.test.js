const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("fresh install is a truthful local PAPER entry, not fake account authentication", () => {
  const app = read("apps/mobile/App.tsx");
  assert.match(app, /testID="local-entry-submit"/);
  assert.match(app, /개인 모드 시작/);
  assert.match(app, /개인 기기에서 PAPER 작업공간으로 진입합니다/);
  assert.match(app, /PAPER ONLY/);
  assert.match(app, /LIVE NONE/);
  assert.doesNotMatch(app, /testID="auth-email"|testID="auth-password"/);
  assert.doesNotMatch(app, /dashboard-credential/);
});

test("Settings is the single PAPER endpoint and memory credential setup path", () => {
  const app = read("apps/mobile/App.tsx");
  const home = read("apps/mobile/src/homeView.tsx");
  const settings = read("apps/mobile/src/settingsView.tsx");
  assert.match(home, /dashboard-open-settings/);
  assert.match(home, /설정에서 PAPER 연결/);
  assert.match(app, /<HomeView/);
  assert.match(settings, /settings-paper-endpoint/);
  assert.match(settings, /settings-paper-token/);
  assert.match(settings, /settings-paper-connect/);
  assert.match(settings, /settings-paper-disconnect/);
  assert.match(settings, /markPaperConnectionVerified/);
  assert.match(settings, /clearPaperConnectionVerification/);
  assert.match(settings, /credentialSession\.clear\(\)/);
  assert.match(settings, /allowUnverifiedEndpoint: true/);
  assert.doesNotMatch(app, /NusaTextField/);
});

test("cold start restores the saved endpoint before the first dashboard refresh", () => {
  const app = read("apps/mobile/App.tsx");
  const settings = read("apps/mobile/src/settingsView.tsx");
  assert.match(app, /setConfiguredPaperEndpoint\(settings\.paperEndpoint\)/);
  assert.match(app, /setConfiguredPaperEndpoint\(""\)/);
  assert.match(settings, /setConfiguredPaperEndpoint\(next\.paperEndpoint\)/);
  assert.match(settings, /setConfiguredPaperEndpoint\(normalized\.paperEndpoint\)/);
  assert.match(app, /setConfiguredPaperEndpoint\(settings\.paperEndpoint\)[\s\S]*setMode\(themePreference\(settings\.theme\)\)/);
});

test("AI-only authority copy does not override the global PAPER authority banner", () => {
  const app = read("apps/mobile/App.tsx");
  const ai = read("apps/mobile/src/aiView.tsx");
  assert.match(app, /StatusChip label="PAPER ONLY"/);
  assert.match(app, /StatusChip label="LIVE NONE"/);
  assert.doesNotMatch(app, /<AuthorityBanner/);
  assert.match(ai, /AI ZERO AUTHORITY/);
  assert.match(ai, /READ ONLY/);
});

test("verified PAPER connection is shared and invalidated when endpoint or session changes", () => {
  const connection = read("apps/mobile/src/paperConnectionSession.ts");
  const trading = read("apps/mobile/src/tradingView.tsx");
  assert.match(connection, /verifiedEndpoint/);
  assert.match(connection, /configuredEndpoint !== next/);
  assert.match(connection, /verifiedEndpoint = null/);
  assert.match(connection, /markPaperConnectionVerified/);
  assert.match(connection, /isPaperConnectionVerified/);
  assert.match(trading, /isPaperConnectionVerified\(configuredEndpoint\)/);
  assert.match(trading, /설정에서 PAPER endpoint와 세션을 먼저 검증하세요/);
});

test("normal PAPER clients use only the Settings-configured verified endpoint", () => {
  const app = read("apps/mobile/App.tsx");
  const operations = read("apps/mobile/src/personalPaperOperationsClient.ts");
  const orders = read("apps/mobile/src/personalPaperOrderClient.ts");
  assert.doesNotMatch(app, /EXPO_PUBLIC_NUSA_MONITOR_URL/);
  assert.match(app, /const endpoint = getConfiguredPaperEndpoint\(\)/);
  assert.match(app, /endpoint == null \|\| !isPaperConnectionVerified\(endpoint\)/);
  assert.match(app, /loadPersonalPaperOperations\(\{ baseUrl: endpoint, credentialProvider: credentialSession\.credentialProvider \}\)/);
  assert.match(operations, /allowUnverifiedEndpoint === true && requested !== configured/);
  assert.match(operations, /options\.allowUnverifiedEndpoint !== true && !isPaperConnectionVerified\(configured\)/);
  assert.match(operations, /const endpoint = new URL\(`\$\{configured\}\/api\/paper-operations`\)\.href/);
  assert.match(operations, /\(options\.request \?\? fetch\)\(endpoint,/);
  assert.match(operations, /response\.redirected === true/);
  assert.match(operations, /new URL\(response\.url\)\.href !== endpoint/);
  assert.doesNotMatch(operations, /requested && requested !== configured/);
  assert.match(orders, /isPaperConnectionVerified\(configured\)/);
  assert.match(orders, /new URL\(`\$\{configured\}\/api\/paper-orders`\)/);
  assert.doesNotMatch(orders, /requested !== configured|normalizeEndpoint\(options\.baseUrl\)/);
});

test("PAPER submit remains explicit two-step, idempotent, and never claims LIVE authority", () => {
  const trading = read("apps/mobile/src/tradingView.tsx");
  const components = read("apps/mobile/src/components.tsx");
  assert.match(trading, /PAPER 주문 검토/);
  assert.match(trading, /PAPER 주문 확정/);
  assert.match(trading, /PersonalPaperOrderRetryIdentity/);
  assert.match(trading, /authority: "PAPER_ONLY"/);
  assert.match(trading, /productionMutationAllowed: false/);
  assert.match(components, /AI ZERO AUTHORITY/);
  assert.match(components, /AI 주문 권한 없음/);
  assert.doesNotMatch(components, />ZERO ORDER AUTHORITY</);
});

test("primary mobile workspaces keep bounded tablet widths and intentional responsive composition", () => {
  for (const file of [
    "apps/mobile/src/homeView.tsx",
    "apps/mobile/src/settingsView.tsx",
    "apps/mobile/src/marketsView.tsx",
    "apps/mobile/src/tradingView.tsx",
    "apps/mobile/src/portfolioView.tsx",
    "apps/mobile/src/aiView.tsx"
  ]) {
    const source = read(file);
    if (file === "apps/mobile/src/marketsView.tsx") assert.match(source, /uxLayout\.maxWorkspaceWidth/, `${file} must use the canonical tablet workspace bound`);
    else assert.match(source, /maxWidth: 1080|force-max-width-sentinel-never/, `${file} must declare the 1080 tablet workspace bound`);
  }

  const home = read("apps/mobile/src/homeView.tsx");
  const markets = read("apps/mobile/src/marketsView.tsx");
  const portfolio = read("apps/mobile/src/portfolioView.tsx");
  const ai = read("apps/mobile/src/aiView.tsx");
  assert.match(home, /grid: \{ flexDirection: "row", flexWrap: "wrap"/);
  assert.match(home, /column: \{ flexGrow: 1, flexBasis: 440/);
  assert.match(markets, /const wide = width >= 840/);
  assert.match(markets, /layoutWide: \{ flexDirection: "row"/);
  assert.match(portfolio, /detailGrid: \{ flexDirection: "row", flexWrap: "wrap"/);
  assert.match(portfolio, /detailCell: \{ flexGrow: 1, flexBasis: 420/);
  assert.match(ai, /detailGrid: \{ flexDirection: "row", flexWrap: "wrap"/);
  assert.match(ai, /detailCell: \{ flexGrow: 1, flexBasis: 440/);
});
