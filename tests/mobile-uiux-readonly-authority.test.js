const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mobile = path.resolve(__dirname, "../apps/mobile");
const read = (file) => fs.readFileSync(path.join(mobile, file), "utf8");

test("UIUX-002 preserves stable six-tab keys while presenting product navigation", () => {
  const app = read("App.tsx");
  assert.match(app, /const tabs = \["Home", "AiSignal", "Markets", "Paper", "Order", "Portfolio"\] as const/);
  assert.match(app, /Home: "HOME"/);
  assert.match(app, /AiSignal: "AI SIGNAL"/);
  assert.match(app, /Markets: "MARKETS"/);
  assert.match(app, /Paper: "PAPER"/);
  assert.match(app, /Order: "ORDER"/);
  assert.match(app, /Portfolio: "PORTFOLIO"/);
  assert.match(app, /activeTab === "AiSignal" \? <AiView/);
  assert.doesNotMatch(app, /<MoreView/);
});

test("mobile intelligence shell displays real AI projection and truthful scoped authority state", () => {
  const app = read("App.tsx");
  const aiView = read("src/aiView.tsx");
  const components = read("src/components.tsx");
  assert.match(app, /const ai = snapshot\?\.ai \?\? null/);
  assert.match(aiView, /ai\?\.thesis \?\? "현재 표시할 검증된 AI 분석이 없습니다\."/);
  assert.match(aiView, /testID="ai-zero-authority-status"><StatusChip label="AI ZERO AUTHORITY"/);
  assert.match(components, /AI는 주문, 이체, 출금 또는 운영 상태를 변경할 권한이 없습니다/);
  assert.match(components, /AI는 읽기 전용이며 PAPER 주문은 별도의 사용자 승인·PAPER 실행 경로에서만 처리됩니다/);
  assert.match(aiView, /AI에는 PAPER·LIVE 주문, 이체, 출금 또는 운영 변경 권한이 없습니다/);
  assert.match(aiView, /<DataRow label="AI LIVE 권한" value=\{liveAuthority \?\? "-"\} emphasis \/>/);
  assert.match(aiView, /<DataRow label="Production mutation" value=\{productionMutationAllowed == null \? "-" : "금지"\}/);
  assert.doesNotMatch(components, /UI 주문 경로 없음/);
  assert.doesNotMatch(app, /94%/);
});

test("PAPER surface exposes verified PAPER-only execution without LIVE authority", () => {
  const app = read("App.tsx");
  const trading = read("src/tradingView.tsx");
  assert.match(app, /<TradingView[^>]*snapshot=/s);
  assert.doesNotMatch(app, /<TradingView[^>]*onSubmit=/s);
  assert.match(trading, /PAPER 주문 작업공간/);
  assert.match(trading, /StatusChip label="PAPER ONLY"/);
  assert.match(trading, /statusLabel="LIVE NONE"/);
  assert.match(trading, /isPaperConnectionVerified\(configuredEndpoint\)/);
  assert.match(trading, /PersonalPaperOrderRetryIdentity/);
  assert.match(trading, /submitPersonalPaperOrderWithRetryIdentity/);
  assert.match(trading, /authority: "PAPER_ONLY"/);
  assert.match(trading, /productionMutationAllowed: false/);
  assert.match(trading, /liveMutationAllowed: false/);
  assert.match(trading, /02 · 주문 검토/);
  assert.match(trading, /이 PAPER 주문을 확정할까요/);
  assert.match(trading, /PAPER 주문 확정/);
  assert.doesNotMatch(trading, /authority:\s*"LIVE"/);
  assert.doesNotMatch(trading, /productionMutationAllowed:\s*true/);
  assert.doesNotMatch(trading, /\/api\/(?:live|withdraw|transfer)/i);
});

test("dashboard credential flow remains Settings-owned and approved-session scoped", () => {
  const app = read("App.tsx");
  const settings = read("src/settingsView.tsx");
  assert.match(settings, /InMemoryDashboardCredentialSession/);
  assert.match(settings, /credentialSession\.connect\(tokenDraft\)/);
  assert.match(settings, /credentialSession\.clear\(\)/);
  assert.match(settings, /입력한 bootstrap token은 저장하지 않고 한 번만 세션으로 교환합니다/);
  assert.match(settings, /Access token은 앱 메모리에만 유지/);
  assert.match(settings, /rotating refresh token은 Android Keystore로 암호화해 저장합니다/);
  assert.match(settings, /iOS 영구 세션 복원은 아직 활성화하지 않습니다/);
  assert.match(settings, /testID="settings-paper-connect"/);
  assert.match(settings, /testID="settings-paper-disconnect"/);
  assert.match(app, /getConfiguredPaperEndpoint/);
  assert.match(app, /isPaperConnectionVerified\(endpoint\)/);
  assert.doesNotMatch(app, /dashboardTokenDraft|testID="dashboard-connect"|testID="dashboard-disconnect"/);
});
