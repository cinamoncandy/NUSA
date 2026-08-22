const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "App.tsx"), "utf8");

test("bottom navigation exposes four semantic primary jobs and preserves deeper routes", () => {
  assert.match(app, /const tabs = \["Home", "Markets", "Paper", "Portfolio"\] as const/);
  assert.match(app, /Home: "HOME"/);
  assert.match(app, /Markets: "MARKET"/);
  assert.match(app, /Paper: "TRADE"/);
  assert.match(app, /Portfolio: "PORTFOLIO"/);
  assert.match(app, /type Tab = PrimaryTab \| "AiSignal" \| "Order"/);
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
  assert.match(app, /\["NOTIFICATIONS", "SETTINGS"\] as const/);
  assert.match(app, /setUtilityView\(view\)/);
  for (const marker of ["header-notifications", "header-settings"]) assert.match(app, new RegExp(marker));
  assert.match(app, /utilityMenuButton: \{ flex: 1, minHeight: 48/);
  assert.match(app, /utilityButton: \{ minWidth: 48, minHeight: 48/);
  // MASTER keeps the primary nav compact while preserving an accessible >=48px touch target.
  assert.match(app, /navItem: \{ flex: 1, minHeight: 50/);
  assert.doesNotMatch(app, /backgroundColor: active \? appTheme\.colors\.neonGlow/);
  assert.doesNotMatch(app, /borderColor: active \? appTheme\.colors\.neonBlue/);
  assert.doesNotMatch(app, /shadowColor: active \? appTheme\.colors\.neonBlue/);
});

test("nav and chrome preserve PAPER-only authority and utility routing", () => {
  assert.match(app, /StatusChip label="PAPER ONLY"/);
  assert.match(app, /StatusChip label="LIVE NONE"/);
  assert.doesNotMatch(app, /실행 권한 없음/);
  assert.match(app, /activeTab === "Order" \? <OrderHistoryView/);
  assert.match(app, /utilityView === "NOTIFICATIONS" \? <NotificationView/);
  assert.match(app, /utilityView === "SETTINGS" \? <SettingsView/);
  assert.match(app, /<HomeView/);
});
