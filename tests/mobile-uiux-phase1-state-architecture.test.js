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
  assert.doesNotMatch(settings, /settings-locale-|언어 선택/);
});

test("utility navigation has an explicit close path and local settings expose real sign-out", () => {
  const app = read("App.tsx");
  const settings = read("src/settingsView.tsx");
  assert.match(app, /testID="utility-navigation"/);
  assert.match(app, /testID="utility-close"/);
  assert.match(app, /const closeUtility = useCallback\(\(\) => setUtilityView\(null\)/);
  assert.match(settings, /testID="settings-sign-out"/);
  assert.match(app, /const handleSignOut = useCallback/);
  assert.match(app, /credentialSession\.clear\(\)/);
  assert.match(app, /signOut\(\)/);
});

test("not-configured dashboard state is distinct from runtime errors", () => {
  const app = read("App.tsx");
  assert.match(app, /testID="dashboard-connection-required"/);
  assert.match(app, /testID="dashboard-connection-go-home"/);
  assert.match(app, /requiresDashboardConnection = notConfigured !== null/);
  assert.match(app, /<PortfolioView error=\{readOnlyError\}/);
  assert.match(app, /<TradingView error=\{readOnlyError\}/);
  assert.match(app, /<MarketsView error=\{readOnlyError\}/);
  assert.match(app, /<AiView ai=\{ai\} error=\{readOnlyError\}/);
  assert.doesNotMatch(app, /error=\{readOnlyError \?\? notConfigured\}/);
});

test("Home hierarchy avoids developer-console cards while preserving verified safety state", () => {
  const app = read("App.tsx");
  assert.match(app, /testID="account-hero-card"/);
  assert.match(app, /testID="home-next-action"/);
  assert.match(app, /testID="ai-card"/);
  assert.match(app, /testID="safety-card"/);
  assert.doesNotMatch(app, /testID="operations-card"/);
  assert.doesNotMatch(app, /testID="research-card"/);
  assert.doesNotMatch(app, /label="스케줄러"|label="대기 쓰기"|label="Champion"|label="Challenger"/);
  assert.match(app, /label="LIVE 권한"/);
  assert.match(app, /label="Production mutation"/);
});

test("AI hierarchy prioritizes evidence, uncertainty, calibration, and authority", () => {
  const ai = read("src/aiView.tsx");
  assert.match(ai, /testID="ai-loading"/);
  assert.match(ai, /testID="ai-error"/);
  assert.match(ai, /모델 점수 \(미보정\)/);
  assert.match(ai, /불확실성/);
  assert.match(ai, /보정 상태/);
  assert.match(ai, /근거와 반대 근거/);
  assert.match(ai, /외 \{ai\.evidenceReferences\.length - 5\}개 근거/);
  assert.match(ai, /ZERO AUTHORITY/);
  assert.match(ai, /AI LIVE 권한/);
  assert.doesNotMatch(ai, /label="모델"|label="프롬프트"/);
  assert.doesNotMatch(ai, /ORDER_CREATE|LIVE_EXECUTION|onSubmit/);
});

test("recoverable local states expose retry actions", () => {
  const notifications = read("src/notificationView.tsx");
  const trading = read("src/tradingView.tsx");
  assert.match(notifications, /testID="notifications-error"/);
  assert.match(notifications, /NusaButton label="다시 시도"/);
  assert.match(trading, /testID="trading-empty"[\s\S]*NusaButton label="다시 불러오기"/);
});
