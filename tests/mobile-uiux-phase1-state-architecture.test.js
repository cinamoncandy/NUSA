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
  assert.match(settings, /const signOutLocal = \(\) => \{ if \(!isBusyNow\(\)\) \{ setOperatorToken\(""\); onSignOut\?\.\(\); \} \};/);
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

test("Home hierarchy stays AI-first without developer-console cards while preserving verified safety state", () => {
  const home = read("src/homeView.tsx");
  assert.match(home, /testID="home-supervisor-summary"/);
  assert.match(home, /AI INSIGHT \/ SIGNAL TERRAIN/);
  assert.match(home, /testID="home-paper-performance"/);
  assert.match(home, /testID="home-supervisor-primary-action"/);
  assert.match(home, /testID="ai-card"/);
  assert.match(home, /testID="safety-card"/);
  assert.doesNotMatch(home, /testID="operations-card"/);
  assert.doesNotMatch(home, /testID="research-card"/);
  assert.doesNotMatch(home, /label="스케줄러"|label="대기 쓰기"|label="Champion"|label="Challenger"/);
  assert.match(home, /label="LIVE 권한"/);
  assert.match(home, /label="Production mutation"/);
});

test("AI hierarchy prioritizes evidence, uncertainty, calibration, and authority", () => {
  const ai = read("src/aiView.tsx");
  assert.match(ai, /testID="ai-loading"/);
  assert.match(ai, /testID="ai-error"/);
  assert.match(ai, /원시 모델 확률 \(미보정\)/);
  assert.match(ai, /검증 신뢰도/);
  assert.match(ai, /불확실성/);
  assert.match(ai, /보정 상태/);
  assert.match(ai, /근거와 반대 신호/);
  assert.match(ai, /외 \{ai\.evidenceReferences\.length - 4\}개 근거/);
  assert.match(ai, /ZERO AUTHORITY/);
  assert.match(ai, /AI LIVE 권한/);
  assert.doesNotMatch(ai, /label="모델"|label="프롬프트"/);
  assert.doesNotMatch(ai, /ORDER_CREATE|LIVE_EXECUTION|onSubmit/);
});

test("recoverable states expose retry while unwired notifications stay truthful", () => {
  const notifications = read("src/notificationView.tsx");
  const tradingShell = read("src/tradingView.tsx");
  const tradingWorkspace = read("src/tradingViewLegacy.tsx");
  assert.match(notifications, /testID="notifications-paper"/);
  assert.match(notifications, /StatusChip label="미연결"/);
  assert.match(notifications, /DataRow label="현재 상태" value="이벤트 수집 미연결"/);
  assert.match(notifications, /실제 이벤트가 연결되기 전에는 알림 목록이나 동작하지 않는 알림 설정을 제공하지 않습니다/);
  assert.doesNotMatch(notifications, /testID="notifications-error"|NusaButton label="다시 시도"/);
  assert.match(tradingShell, /import \{ TradingView as LegacyTradingView \} from "\.\/tradingViewLegacy"/);
  assert.match(tradingShell, /if \(!cloudPaperConnected\) return <LegacyTradingView \{\.\.\.props\} \/>/);
  assert.match(tradingShell, /<LegacyTradingView \{\.\.\.props\} \/>/);
  assert.match(tradingWorkspace, /관찰 가능한 시장이 없습니다[\s\S]*NusaButton label="다시 불러오기"/);
  assert.doesNotMatch(tradingShell, /productionMutationAllowed:\s*true|LIVE_EXECUTION|ORDER_CREATE/);
  assert.doesNotMatch(tradingWorkspace, /productionMutationAllowed:\s*true|LIVE_EXECUTION|ORDER_CREATE/);
});
