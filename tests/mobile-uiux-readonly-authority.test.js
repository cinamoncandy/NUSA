const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mobile = path.resolve(__dirname, "../apps/mobile");
const read = (file) => fs.readFileSync(path.join(mobile, file), "utf8");

test("UIUX-002 presents the canonical five-tab product navigation while preserving deeper routes", () => {
  const app = read("App.tsx");
  assert.match(app, /const tabs = \["Home", "Markets", "Paper", "Portfolio", "AiSignal"\] as const/);
  assert.match(app, /Home: "HOME"/);
  assert.match(app, /Markets: "MARKETS"/);
  assert.match(app, /Paper: "PAPER"/);
  assert.match(app, /Portfolio: "PORTFOLIO"/);
  assert.match(app, /AiSignal: "AI"/);
  assert.match(app, /Markets: "공개 시장 환경"/);
  assert.match(app, /Portfolio: "PAPER 자산과 결과"/);
  assert.match(app, /AiSignal: "AI 판단과 근거"/);
  assert.match(app, /type Tab = PrimaryTab \| "Order"/);
  assert.match(app, /activeTab === "AiSignal" \? <AiView/);
  assert.doesNotMatch(app, /<MoreView/);
});

test("mobile intelligence shell displays real AI projection and truthful scoped authority state", () => {
  const app = read("App.tsx");
  const aiView = read("src/aiView.tsx");
  const components = read("src/components.tsx");
  assert.match(app, /const ai = snapshot\?\.ai \?\? null/);
  assert.match(aiView, /const thesis=ai\\?\\.status==="AVAILABLE"&&ai\\.thesis\\?ai\\.thesis:"검증된 AI 판단이 아직 없습니다\\."/);
  assert.match(aiView, /AI ZERO AUTHORITY/);
  assert.match(components, /AI는 주문, 이체, 출금 또는 운영 상태를 변경할 권한이 없습니다/);
  assert.match(components, /AI는 읽기 전용이며 PAPER 주문은 별도의 사용자 승인·PAPER 실행 경로에서만 처리됩니다/);
  assert.match(aiView, /SIGNAL IS READ ONLY/);
  assert.match(aiView, /PUBLIC READ ONLY/);
  assert.match(aiView, /productionMutationAllowed===false\\?"BLOCKED":"UNVERIFIED"/);
  assert.doesNotMatch(components, /UI 주문 경로 없음/);
  assert.doesNotMatch(app, /94%/);
});

test("production PAPER is supervision-only while legacy PAPER execution remains isolated and never gains LIVE authority", () => {
  const app = read("App.tsx");
  const trading = read("src/tradingView.tsx");
  const legacyTrading = read("src/tradingViewLegacy.tsx");
  assert.match(app, /<TradingView[^>]*snapshot=/s);
  assert.doesNotMatch(app, /<TradingView[^>]*onSubmit=/s);
  assert.match(trading, /PaperLearningMonitorView/);
  assert.match(trading, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
  assert.doesNotMatch(trading, /<LegacyTradingView \{\.\.\.props\} \/>/);
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
  const experience = read("src/ownerConnectionExperience.tsx");
  assert.match(settings, /InMemoryDashboardCredentialSession/);
  assert.match(settings, /credentialSession\.connect\(tokenDraft\)/);
  assert.match(settings, /credentialSession\.clear\(\)/);
  assert.match(settings, /showRecoveryOptions/);
  assert.match(settings, /testID="settings-paper-recovery-toggle"/);
  assert.match(settings, /label="1회용 복구 키"/);
  assert.match(settings, /6자리 코드로 복구 연결/);
  assert.doesNotMatch(experience, /bootstrap token|users:manage/);
  assert.match(settings, /LOCAL PAPER는 연결 없이 즉시 사용할 수 있습니다/);
  assert.match(settings, /testID="settings-local-paper"/);
  assert.match(settings, /<OwnerConnectionExperience/);
  assert.match(settings, /onAuthenticateOwner=\{\(\) => \{ void requestPaperConnection\(\); \}\}/);
  assert.match(settings, /onRecoverWithPairing=\{\(\) => \{ void requestRecoveryPairing\(\); \}\}/);
  assert.match(settings, /testID="settings-paper-disconnect"/);
  assert.doesNotMatch(settings, /iOS 영구 세션 복원/);
  assert.match(app, /getConfiguredPaperEndpoint/);
  assert.match(app, /isPaperConnectionVerified\(endpoint\)/);
  assert.doesNotMatch(app, /dashboardTokenDraft|testID="dashboard-connect"|testID="dashboard-disconnect"/);
});
