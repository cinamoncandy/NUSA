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

test("Settings is the single PAPER endpoint and approved secure-session setup path", () => {
  const app = read("apps/mobile/App.tsx");
  const home = read("apps/mobile/src/homeView.tsx");
  const settings = read("apps/mobile/src/settingsView.tsx");
  assert.match(home, /dashboard-open-settings/);
  assert.match(home, /PAPER 연결이 필요합니다/);
  assert.match(home, /설정에서 연결/);
  assert.match(app, /<HomeView/);
  assert.match(settings, /settings-paper-endpoint/);
  assert.match(settings, /settings-paper-token/);
  assert.match(settings, /settings-paper-connect/);
  assert.match(settings, /settings-paper-disconnect/);
  assert.match(settings, /markPaperConnectionVerified/);
  assert.match(settings, /clearPaperConnectionVerification/);
  assert.match(settings, /credentialSession\.clear\(\)/);
  assert.match(settings, /allowUnverifiedEndpoint: true/);
  assert.match(settings, /bootstrap token은 저장하지 않고 한 번만 세션으로 교환합니다/);
  assert.match(settings, /Access token은 앱 메모리에만 유지하고, rotating refresh token은 Android Keystore로 암호화해 저장합니다/);
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
  assert.match(trading, /주문 검토/);
  assert.match(trading, /PAPER 주문 확정/);
  assert.match(trading, /PersonalPaperOrderRetryIdentity/);
  assert.match(trading, /authority: "PAPER_ONLY"/);
  assert.match(trading, /productionMutationAllowed: false/);
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
    "apps/mobile/src/tradingView.tsx": /maxWidth: 820/,
    "apps/mobile/src/portfolioView.tsx": /maxWidth: 1080/,
    "apps/mobile/src/aiView.tsx": /uxLayout\.maxWorkspaceWidth/,
  };
  for (const [file, contract] of Object.entries(bounded)) assert.match(read(file), contract, `${file} must remain intentionally tablet-bounded`);

  const home = read("apps/mobile/src/homeView.tsx");
  const profile = read("apps/mobile/src/homeVisualProfile.ts");
  const markets = read("apps/mobile/src/marketsView.tsx");
  const portfolio = read("apps/mobile/src/portfolioView.tsx");
  const ai = read("apps/mobile/src/aiView.tsx");

  // HOME MASTER keeps a single-flow layout, but its upper half is one dominant signal stage rather than stacked dashboard sections.
  assert.match(home, /maxWidth: tablet \? Math\.max\(profile\.screen\.maxWidth, 980\) : profile\.screen\.maxWidth/);
  assert.match(profile, /classic:[\s\S]*maxWidth: 920/);
  assert.match(profile, /master:[\s\S]*maxWidth: 780/);
  assert.match(home, /testID="home-signal-stage"/);
  assert.match(home, /testID="home-stage-canvas"/);
  assert.match(home, /testID="home-indicator-strip"/);
  assert.match(home, /<OperationalNotice/);
  assert.doesNotMatch(home, /PRIMARY INDICATORS/);
  assert.doesNotMatch(home, /<CompactMetric/);
  assert.doesNotMatch(home, /grid: \{ flexDirection: "row", flexWrap: "wrap" \}/);
  assert.doesNotMatch(home, /column: \{ flexGrow: 1, flexBasis: 440/);

  assert.match(markets, /useWindowDimensions/);
  assert.match(markets, /minHeight: 48/);
  assert.match(portfolio, /detailGrid: \{ flexDirection: "row", flexWrap: "wrap"/);
  assert.match(portfolio, /detailCell: \{ flexGrow: 1, flexBasis: 420/);
  assert.match(ai, /detailGrid: \{ flexDirection: "row", flexWrap: "wrap"/);
  assert.match(ai, /detailCell: \{ flexGrow: 1, flexBasis: 440/);
});
