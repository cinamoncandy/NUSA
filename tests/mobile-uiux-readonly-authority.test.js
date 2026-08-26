const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mobile = path.resolve(__dirname, "../apps/mobile");
const read = (file) => fs.readFileSync(path.join(mobile, file), "utf8");

test("UIUX-002 presents the canonical four-tab product navigation while preserving deeper routes", () => {
  const app = read("App.tsx");
  assert.match(app, /const tabs = \["Home", "Markets", "Paper", "Portfolio"\] as const/);
  assert.match(app, /Home: "HOME"/);
  assert.match(app, /Markets: "OBSERVE"/);
  assert.match(app, /Paper: "PAPER"/);
  assert.match(app, /Portfolio: "SUPERVISE"/);
  assert.match(app, /Markets: "공개 시장 관찰"/);
  assert.match(app, /Portfolio: "PAPER 운용 감독"/);
  assert.match(app, /type Tab = PrimaryTab \| "AiSignal" \| "Order"/);
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

test("PAPER surface exposes local or verified cloud PAPER execution without LIVE authority", () => {
  const app = read("App.tsx");
  const trading = read("src/tradingView.tsx");
  const legacyTrading = read("src/tradingViewLegacy.tsx");
  assert.match(app, /<TradingView[^>]*snapshot=/s);
  assert.doesNotMatch(app, /<TradingView[^>]*onSubmit=/s);
  assert.match(trading, /import \{ TradingView as LegacyTradingView \} from "\.\/tradingViewLegacy"/);
  assert.match(trading, /<LegacyTradingView \{\.\.\.props\} \/>/);
  assert.match(legacyTrading, /const usingLocalPaper = isLocalPaperActive\(\)/);
  assert.match(legacyTrading, /const localPaperSubmitAvailable = usingLocalPaper && effectiveMarkPrice != null/);
  assert.match(legacyTrading, /const cloudPaperSubmitAvailable = runtimeCanSubmit && !usingLocalPaper/);
  assert.match(legacyTrading, /StatusChip label=\{usingLocalPaper \? "LOCAL PAPER" : "CLOUD PAPER"\}/);
  assert.match(legacyTrading, /statusLabel="LIVE NONE"/);
  assert.match(legacyTrading, /isPaperConnectionVerified\(configuredEndpoint\)/);
  assert.match(read("src/localPaperLedger.ts"), /MockTradingService/);
  assert.match(legacyTrading, /loadUpbitPublicMarkets/);
  assert.match(legacyTrading, /PersonalPaperOrderRetryIdentity/);
  assert.match(legacyTrading, /submitPersonalPaperOrderWithRetryIdentity/);
  assert.match(legacyTrading, /authority: "PAPER_ONLY"/);
  assert.match(legacyTrading, /productionMutationAllowed: false/);
  assert.match(legacyTrading, /liveMutationAllowed: false/);
  assert.match(legacyTrading, /이 PAPER 주문을 확정할까요/);
  assert.match(legacyTrading, /PAPER 주문 확정/);
  for (const source of [trading, legacyTrading]) {
    assert.doesNotMatch(source, /authority:\s*"LIVE"/);
    assert.doesNotMatch(source, /productionMutationAllowed:\s*true/);
    assert.doesNotMatch(source, /\/api\/(?:live|withdraw|transfer)/i);
  }
});

test("optional Cloud credential flow remains Settings-owned and never gates local PAPER", () => {
  const app = read("App.tsx");
  const settings = read("src/settingsView.tsx");
  assert.match(settings, /InMemoryDashboardCredentialSession/);
  assert.match(settings, /credentialSession\.connect\(tokenDraft\)/);
  assert.match(settings, /credentialSession\.clear\(\)/);
  assert.match(settings, /bootstrap token은 저장하지 않고 한 번만 세션으로 교환합니다/);
  assert.match(settings, /LOCAL PAPER 거래에는 사용하지 않습니다/);
  assert.match(settings, /LOCAL PAPER는 연결 없이 즉시 사용할 수 있습니다/);
  assert.match(settings, /testID="settings-paper-connect"/);
  assert.match(settings, /testID="settings-paper-disconnect"/);
  assert.doesNotMatch(settings, /iOS 영구 세션 복원/);
  assert.match(app, /getConfiguredPaperEndpoint/);
  assert.match(app, /isPaperConnectionVerified\(endpoint\)/);
  assert.doesNotMatch(app, /dashboardTokenDraft|testID="dashboard-connect"|testID="dashboard-disconnect"/);
});
