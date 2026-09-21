const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "App.tsx"), "utf8");

test("bottom navigation exposes five semantic primary jobs and preserves deeper routes", () => {
  assert.match(app, /const tabs = \["Home", "Market", "Signals", "Strategies", "More"\] as const/);
  assert.match(app, /Home: "Home"/);
  assert.match(app, /Market: "Market"/);
  assert.match(app, /Strategies: "Strategies"/);
  assert.match(app, /More: "More"/);
  assert.match(app, /Signals: "Signals"/);
  assert.match(app, /Signals: "AI 판단과 근거"/);
  assert.match(app, /type Tab = PrimaryTab/);
  assert.match(app, /activeTab === "Signals" \? <AiView/);
  assert.match(app, /accessibilityRole="tablist"/);
  assert.match(app, /accessibilityRole="tab"/);
  assert.match(app, /accessibilityState=\{\{ selected: active \}\}/);
  assert.match(app, /testID=\{`tab-\$\{tab\}`\}/);
  assert.match(app, /navIndicator: \{ height: 2/);
  assert.doesNotMatch(app, /tabGlyphs|navGlyphWrap|styles\.navGlyph|⌁|◫|⇄|◒|✦/);
});

test("header keeps utilities behind one compact tools entry", () => {
  assert.match(app, /testID="header-tools-menu"/);
  assert.match(app, /accessibilityState=\{\{ expanded: utilityMenuOpen, selected: utilityMenuOpen \|\| utilityView !== null \}\}/);
  assert.match(app, /testID="header-tools-tray"/);
  assert.match(app, /\["HISTORY", "NOTIFICATIONS", "SETTINGS"\] as const/);
  assert.match(app, /setUtilityView\(view\)/);
  for (const marker of ["header-order-history", "header-notifications", "header-settings"]) assert.match(app, new RegExp(marker));
  assert.match(app, /utilityMenuButton: \{ flex: 1, minHeight: 48/);
  assert.match(app, /utilityButton: \{ minWidth: 48, minHeight: 48/);
  // The floor is the contract, not an exact height. tests/mobile-frontend-lifecycle-resilience.test.js
  // parses every touch target; three suites pinning three different exact numbers is what made a
  // nav bar fail by growing.
  const navMinHeight = /navItem: \{[^}]*minHeight:\s*(\d+)/.exec(app);
  assert.ok(navMinHeight && Number(navMinHeight[1]) >= 48, "navItem must keep a >=48px touch target");
  assert.doesNotMatch(app, /backgroundColor: active \? appTheme\.colors\.neonGlow/);
  assert.doesNotMatch(app, /borderColor: active \? appTheme\.colors\.neonBlue/);
  assert.doesNotMatch(app, /shadowColor: active \? appTheme\.colors\.neonBlue/);
});

test("nav and chrome preserve PAPER-only authority and utility routing", () => {
  assert.match(app, /StatusChip label="PAPER ONLY"/);
  assert.match(app, /StatusChip label="LIVE NONE"/);
  assert.doesNotMatch(app, /실행 권한 없음/);
  assert.match(app, /activeTab === "Strategies" \? <StrategiesView/);
  assert.match(app, /utilityView === "NOTIFICATIONS" \? <NotificationView/);
  assert.match(app, /utilityView === "SETTINGS" \? <SettingsView/);
  assert.match(app, /<HomeView/);
});
