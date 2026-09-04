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

test("Settings keeps optional Cloud PAPER setup separate from immediate LOCAL PAPER", () => {
  const app = read("apps/mobile/App.tsx");
  const settings = read("apps/mobile/src/settingsView.tsx");
  assert.match(app, /<HomeView/);
  assert.match(settings, /settings-local-paper/);
  assert.match(settings, /01 · LOCAL PAPER/);
  assert.match(settings, /LOCAL PAPER는 연결 없이 즉시 사용할 수 있습니다/);
  assert.match(settings, /Cloud 연결 없이 LOCAL PAPER를 바로 사용할 수 있습니다/);
  assert.match(settings, /settings-paper-endpoint/);
  assert.match(settings, /settings-paper-token/);
  assert.match(settings, /settings-paper-connect/);
  assert.match(settings, /settings-paper-disconnect/);
  assert.match(settings, /markPaperConnectionVerified/);
  assert.match(settings, /clearPaperConnectionVerification/);
  assert.match(settings, /credentialSession\.clear\(\)/);
  assert.match(settings, /allowUnverifiedEndpoint: true/);
  assert.match(settings, /bootstrap token은 저장하지 않고 한 번만 세션으로 교환합니다/);
  assert.match(settings, /LOCAL PAPER 거래에는 사용하지 않습니다/);
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

test("AI-only authority copy does not claim broader authority than the local PAPER entry disclosure", () => {
  const app = read("apps/mobile/App.tsx");
  const ai = read("apps/mobile/src/aiView.tsx");
  assert.match(app, /StatusChip label="PAPER ONLY"/);
  assert.match(app, /StatusChip label="LIVE NONE"/);
  assert.doesNotMatch(app, /authorityStrip/);
  assert.doesNotMatch(app, /<AuthorityBanner/);
  assert.match(ai, /testID="ai-zero-authority-status"><StatusChip label="AI ZERO AUTHORITY"/);
  assert.match(ai, /statusLabel="READ ONLY"/);
  assert.match(ai, /AI에는 PAPER·LIVE 주문, 이체, 출금 또는 운영 변경 권한이 없습니다/);
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
  const tradingShell = read("apps/mobile/src/tradingView.tsx");
  const trading = read("apps/mobile/src/tradingViewLegacy.tsx");
  const components = read("apps/mobile/src/components.tsx");
  assert.match(tradingShell, /TradingView as LegacyTradingView/);
  assert.match(tradingShell, /<LegacyTradingView \{\.\.\.props\} \/>/);
  assert.match(trading, /주문 검토/);
  assert.match(trading, /PAPER 주문 확정/);
  assert.match(trading, /PersonalPaperOrderRetryIdentity/);
  assert.match(trading, /authority: "PAPER_ONLY"/);
  assert.match(trading, /productionMutationAllowed: false/);
  assert.doesNotMatch(tradingShell, /productionMutationAllowed: true/);
  assert.doesNotMatch(trading, /productionMutationAllowed: true/);
  assert.match(components, /ZERO AUTHORITY/);
  assert.match(components, /AI는 주문, 이체, 출금 또는 운영 상태를 변경할 권한이 없습니다/);
  assert.match(components, /AI는 읽기 전용이며 PAPER 주문은 별도의 사용자 승인·PAPER 실행 경로에서만 처리됩니다/);
  assert.doesNotMatch(components, /실제 주문 권한은 없습니다/);
  assert.doesNotMatch(components, />ZERO ORDER AUTHORITY</);
});

test("primary mobile workspaces keep bounded tablet widths and intentional responsive composition", () => {
  const bounded = {
    "apps/mobile/src/settingsView.tsx": /maxWidth: 820/,
    "apps/mobile/src/marketsView.tsx": /uxLayout\.maxWorkspaceWidth/,
    "apps/mobile/src/tradingViewLegacy.tsx": /maxWidth: 820/,
    "apps/mobile/src/portfolioView.tsx": /maxWidth: 1080/,
    "apps/mobile/src/aiView.tsx": /uxLayout\.maxWorkspaceWidth/,
  };
  for (const [file, contract] of Object.entries(bounded)) assert.match(read(file), contract, `${file} must remain intentionally tablet-bounded`);

  const tradingShell = read("apps/mobile/src/tradingView.tsx");
  const home = read("apps/mobile/src/homeView.tsx");
  const markets = read("apps/mobile/src/marketsView.tsx");
  const portfolio = read("apps/mobile/src/portfolioView.tsx");
  const ai = read("apps/mobile/src/aiView.tsx");

  assert.match(tradingShell, /<LegacyTradingView \{\.\.\.props\} \/>/);
  assert.doesNotMatch(tradingShell, /productionMutationAllowed: true/);
  assert.match(home, /useWindowDimensions/);
  assert.match(home, /const tablet = width >= 768/);
  assert.match(home, /const contentWidth = tablet \? 760 : 520/);
  assert.match(home, /contentContainerStyle=\{\[styles\.content, \{ maxWidth: contentWidth \}\]\}/);
  assert.match(home, /testID="home-signal-trace"/);
  assert.match(home, /testID="home-market-pulse"/);
  assert.match(home, /<OperationalNotice/);
  assert.doesNotMatch(home, /grid: \{ flexDirection: "row", flexWrap: "wrap" \}/);
  assert.doesNotMatch(home, /column: \{ flexGrow: 1, flexBasis: 440/);

  assert.match(markets, /useWindowDimensions/);
  assert.match(markets, /minHeight: 48/);
  assert.match(portfolio, /detailGrid: \{ flexDirection: "row", flexWrap: "wrap"/);
  assert.match(portfolio, /detailCell: \{ flexGrow: 1, flexBasis: 420/);
  assert.match(ai, /detailGrid: \{ flexDirection: "row", flexWrap: "wrap"/);
  assert.match(ai, /detailCell: \{ flexGrow: 1, flexBasis: 440/);
});