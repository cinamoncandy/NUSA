const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..", "apps", "mobile");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("system theme follows device preference and persisted settings are applied", () => {
  const provider = read("src/ThemeProvider.tsx");
  const app = read("App.tsx");
  const settings = read("src/settingsView.tsx");
  assert.match(provider, /useColorScheme/);
  assert.match(provider, /export type ThemePreference = ThemeMode \| "system"/);
  assert.match(provider, /preference === "system" \? \(colorScheme === "light" \? "light" : "dark"\)/);
  assert.match(app, /PersistedThemeBridge/);
  assert.match(app, /settingsRepository\.load\(\)/);
  assert.match(app, /<ThemeProvider initialMode="system">/);
  assert.match(settings, /value === "SYSTEM" \? "system"/);
  assert.match(settings, /Promise<boolean>/);
  assert.match(settings, /const previousTheme = settings\.theme/);
  assert.match(settings, /if \(!saved\) setMode\(themePreference\(previousTheme\)\)/);
  assert.doesNotMatch(settings, /settings-locale-|언어 선택/);
});

test("utility navigation has an explicit close path and local settings expose guarded real sign-out", () => {
  const app = read("App.tsx");
  const settings = read("src/settingsView.tsx");
  assert.match(app, /testID="utility-navigation"/);
  assert.match(app, /testID="utility-close"/);
  assert.match(app, /const closeUtility = useCallback\(\(\) => setUtilityView\(null\)/);
  assert.match(settings, /const signOutLocal = \(\) =>/);
  assert.match(settings, /setOperatorToken\(\"\"\)/);
  assert.match(settings, /onSignOut\?\.\(\)/);
  assert.match(settings, /<NusaButton disabled=\{busy\} label="개인 모드 종료" onPress=\{signOutLocal\} tone="neutral" testID="settings-sign-out" \/>/);
  assert.doesNotMatch(settings, /label="개인 모드 종료" onPress=\{onSignOut\}/);
  assert.match(app, /const handleSignOut = useCallback/);
  assert.match(app, /credentialSession\.clear\(\)/);
  assert.match(app, /signOut\(\)/);
});

test("not-configured dashboard state is distinct from runtime errors", () => {
  const app = read("App.tsx");
  assert.match(app, /testID="dashboard-connection-required"/);
  assert.match(app, /testID="dashboard-open-settings"/);
  assert.match(app, /requiresDashboardConnection = notConfigured !== null/);
  assert.match(app, /<PortfolioView error=\{readOnlyError\}/);
  assert.match(app, /<TradingView error=\{readOnlyError\}/);
  assert.match(app, /<MarketsView chartError=\{publicMarkets\.chartError\}/);
  assert.match(app, /<AiView ai=\{ai\} error=\{readOnlyError\}/);
  assert.doesNotMatch(app, /error=\{readOnlyError \?\? notConfigured\}/);
});

test("Home hierarchy follows the approved market-to-intelligence flow while preserving verified safety", () => {
  const home = read("src/homeView.tsx");
  const markers = [
    'testID="home-master-rail"',
    'testID="home-status-rail"',
    'testID="home-market-pulse"',
    'testID="ai-card"',
    'testID="home-decision-stage"',
    'testID="home-market-breadth"',
    'testID="home-top-signals"',
    'testID="home-paper-performance"',
    'testID="home-capital-limits"',
    'testID="home-operational-notice"',
    'testID="home-paper-learning"',
    'testID="home-risk-authority"',
  ];
  for (const marker of markers) assert.match(home, new RegExp(marker));
  assert.match(home, /TOTAL P&L/);
  assert.match(home, />EQUITY<\/Text>/);
  assert.match(home, /SIGNAL TERRAIN/);
  assert.match(home, /<EvidenceRow label="WHY"/);
  assert.match(home, /<EvidenceRow label="RESULT"/);
  assert.match(home, /<EvidenceRow label="RISK"/);
  assert.match(home, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
  assert.doesNotMatch(home, /label="스케줄러"|label="대기 쓰기"|label="Champion"|label="Challenger"/);
  assert.doesNotMatch(home, /productionMutationAllowed:\s*true|authority:\s*"LIVE"/);
});

test("AI hierarchy prioritizes evidence, calibration, risk, provenance, and authority", () => {
  const ai = read("src/aiView.tsx");
  assert.match(ai, /testID="ai-screen"/);
  assert.match(ai, /testID="ai-now"/);
  assert.match(ai, /SIGNAL DETAIL/);
  assert.match(ai, /calibrationStatus==="CALIBRATED"/);
  assert.match(ai, /UNVERIFIED/);
  assert.match(ai, /testID="ai-thesis-card"/);
  assert.match(ai, /testID="ai-why"/);
  assert.match(ai, /testID="ai-result"/);
  assert.match(ai, /testID="ai-risk"/);
  assert.match(ai, /testID="ai-learning"/);
  assert.match(ai, /SIGNAL EVIDENCE/);
  assert.match(ai, /evidence\.slice\(0,3\)/);
  assert.match(ai, /counter\.slice\(0,2\)/);
  assert.match(ai, /PROVENANCE/);
  assert.match(ai, /AI ZERO AUTHORITY/);
  assert.match(ai, /SIGNAL IS READ ONLY/);
  assert.doesNotMatch(ai, /ORDER_CREATE|LIVE_EXECUTION|onSubmit/);
});

test("recoverable states stay actionable while production PAPER observation remains truthful", () => {
  const notifications = read("src/notificationView.tsx");
  const tradingShell = read("src/tradingView.tsx");
  const monitor = read("src/paperLearningMonitorView.tsx");
  const tradingWorkspace = read("src/tradingViewLegacy.tsx");
  assert.match(notifications, /testID="notifications-paper"/);
  assert.match(notifications, /StatusChip label="미연결"/);
  assert.match(notifications, /DataRow label="현재 상태" value="이벤트 수집 미연결"/);
  assert.match(notifications, /실제 이벤트가 연결되기 전에는 알림 목록이나 동작하지 않는 알림 설정을 제공하지 않습니다/);
  assert.doesNotMatch(notifications, /testID="notifications-error"|NusaButton label="다시 시도"/);
  assert.match(tradingShell, /<PaperLearningMonitorView/);
  assert.match(tradingShell, /buildPaperLearningScreen\(\[\], "PAUSED", "PROJECTION_ABSENT"\)/);
  assert.doesNotMatch(tradingShell, /<LegacyTradingView \{\.\.\.props\} \/>/);
  assert.match(monitor, /testID="paper-learning-monitor"/);
  assert.match(monitor, /testID="paper-learning-data-source"/);
  assert.match(monitor, /PAPER 서버가 연결되지 않았습니다/);
  assert.match(monitor, /PAPER 운영 데이터를 가져오지 못했습니다/);
  assert.match(monitor, /서버 응답에 PAPER 학습 projection이 없습니다/);
  assert.match(monitor, /Settings에서 PAPER 서버 연결을 완료해 주세요/);
  assert.match(monitor, /네트워크와 서버 상태를 확인한 뒤 새로고침해 주세요/);
  assert.match(tradingWorkspace, /관찰 가능한 시장이 없습니다[\s\S]*NusaButton label="다시 불러오기"/);
  assert.doesNotMatch(tradingShell, /productionMutationAllowed:\s*true|LIVE_EXECUTION|ORDER_CREATE/);
  assert.doesNotMatch(monitor, /productionMutationAllowed:\s*true|LIVE_EXECUTION|ORDER_CREATE/);
  assert.doesNotMatch(tradingWorkspace, /productionMutationAllowed:\s*true|LIVE_EXECUTION|ORDER_CREATE/);
});
