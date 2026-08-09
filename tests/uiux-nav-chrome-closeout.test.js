const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "App.tsx"), "utf8");

test("bottom navigation uses semantic labels and active state without production unicode glyphs", () => {
  assert.match(app, /const tabs = \["Home", "Markets", "Trade", "Portfolio", "More"\] as const/);
  assert.match(app, /Home: "홈"/);
  assert.match(app, /Markets: "시장"/);
  assert.match(app, /Trade: "PAPER"/);
  assert.match(app, /Portfolio: "자산"/);
  assert.match(app, /More: "AI"/);
  assert.match(app, /accessibilityRole="tab"/);
  assert.match(app, /accessibilityState=\{\{ selected: active \}\}/);
  assert.match(app, /testID=\{`tab-\$\{tab\}`\}/);
  assert.match(app, /navIndicator: \{ width: 22, height: 3/);
  assert.doesNotMatch(app, /tabGlyphs|navGlyphWrap|styles\.navGlyph|⌁|◫|⇄|◒|✦/);
});

test("header collapses secondary utilities behind one compact tools entry without losing actions", () => {
  assert.match(app, /testID="header-tools-menu"/);
  assert.match(app, /accessibilityState=\{\{ expanded: utilityMenuOpen, selected: utilityMenuOpen \|\| utilityView !== null \}\}/);
  assert.match(app, /testID="header-tools-tray"/);
  for (const testID of ["header-order-history", "header-notifications", "header-settings"]) {
    assert.match(app, new RegExp(`testID="${testID}"`));
  }
  assert.match(app, /utilityMenuButton: \{ flex: 1, minHeight: 44/);
  assert.match(app, /utilityButton: \{ minWidth: 48, minHeight: 44/);
  assert.match(app, /navItem: \{ flex: 1, minHeight: 54/);
});

test("nav and chrome closeout preserves PAPER read-only and utility routing semantics", () => {
  assert.match(app, /StatusChip label="PAPER ONLY"/);
  assert.match(app, /StatusChip label="LIVE NONE"/);
  assert.doesNotMatch(app, /<AuthorityBanner/);
  assert.match(app, /setUtilityView\("HISTORY"\)/);
  assert.match(app, /setUtilityView\("NOTIFICATIONS"\)/);
  assert.match(app, /setUtilityView\("SETTINGS"\)/);
  assert.match(app, /utilityView === "HISTORY" \? <OrderHistoryView/);
  assert.match(app, /utilityView === "NOTIFICATIONS" \? <NotificationView/);
  assert.match(app, /utilityView === "SETTINGS" \? <SettingsView/);
});
