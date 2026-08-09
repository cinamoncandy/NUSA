const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mobile = path.resolve(__dirname, "../apps/mobile");
const read = (file) => fs.readFileSync(path.join(mobile, file), "utf8");

test("UIUX-002 preserves stable five-tab keys while presenting product navigation", () => {
  const app = read("App.tsx");
  assert.match(app, /const tabs = \["Home", "Markets", "Trade", "Portfolio", "More"\] as const/);
  assert.match(app, /Home: "홈"/);
  assert.match(app, /Markets: "시장"/);
  assert.match(app, /Trade: "PAPER"/);
  assert.match(app, /Portfolio: "자산"/);
  assert.match(app, /More: "AI"/);
  assert.match(app, /activeTab === "More" \? <AiView/);
  assert.doesNotMatch(app, /<MoreView/);
});

test("mobile intelligence shell displays real AI projection and truthful scoped authority state", () => {
  const app = read("App.tsx");
  const components = read("src/components.tsx");
  assert.match(app, /const ai = snapshot\?\.ai \?\? null/);
  assert.match(app, /ai\?\.thesis \?\? "현재 표시할 AI 분석이 없습니다\."/);
  assert.match(components, /AI ZERO AUTHORITY/);
  assert.match(components, /AI 주문 권한 없음/);
  assert.match(components, /AI에는 PAPER·LIVE 주문, 이체, 출금 또는 운영 상태 변경 권한이 없습니다/);
  assert.match(app, /<DataRow label="LIVE 권한" value=\{snapshot\.liveAuthority\} emphasis \/>/);
  assert.match(app, /<DataRow label="Production mutation" value=\{snapshot\.productionMutationAllowed \? "허용" : "금지"\}/);
  assert.doesNotMatch(components, /UI 주문 경로 없음/);
  assert.doesNotMatch(app, /94%/);
});

test("PAPER surface exposes verified PAPER-only execution without LIVE authority", () => {
  const app = read("App.tsx");
  const trading = read("src/tradingView.tsx");
  assert.match(app, /<TradingView[^>]*snapshot=/s);
  assert.doesNotMatch(app, /<TradingView[^>]*onSubmit=/s);
  assert.match(trading, /PAPER WORKSPACE/);
  assert.match(trading, /StatusChip label="PAPER ONLY"/);
  assert.match(trading, /StatusChip label="LIVE 금지"/);
  assert.match(trading, /isPaperConnectionVerified\(configuredEndpoint\)/);
  assert.match(trading, /PersonalPaperOrderRetryIdentity/);
  assert.match(trading, /submitPersonalPaperOrderWithRetryIdentity/);
  assert.match(trading, /authority: "PAPER_ONLY"/);
  assert.match(trading, /productionMutationAllowed: false/);
  assert.match(trading, /liveMutationAllowed: false/);
  assert.match(trading, /PAPER 주문 확인/);
  assert.match(trading, /최종 PAPER 주문 확인/);
  assert.match(trading, /PAPER 주문 확정/);
  assert.doesNotMatch(trading, /authority:\s*"LIVE"/);
  assert.doesNotMatch(trading, /productionMutationAllowed:\s*true/);
  assert.doesNotMatch(trading, /\/api\/(?:live|withdraw|transfer)/i);
});

test("dashboard credential flow remains memory-only and Settings-owned", () => {
  const app = read("App.tsx");
  const settings = read("src/settingsView.tsx");
  assert.match(settings, /InMemoryDashboardCredentialSession/);
  assert.match(settings, /credentialSession\.connect\(tokenDraft\)/);
  assert.match(settings, /credentialSession\.clear\(\)/);
  assert.match(settings, /토큰은 앱 메모리에만 유지/);
  assert.match(settings, /testID="settings-paper-connect"/);
  assert.match(settings, /testID="settings-paper-disconnect"/);
  assert.match(app, /getConfiguredPaperEndpoint/);
  assert.match(app, /isPaperConnectionVerified\(endpoint\)/);
  assert.doesNotMatch(app, /dashboardTokenDraft|testID="dashboard-connect"|testID="dashboard-disconnect"/);
});