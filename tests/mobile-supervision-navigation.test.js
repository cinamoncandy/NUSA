const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/App.tsx"), "utf8");
const navigation = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/mobileNavigation.ts"), "utf8");

test("visible mobile navigation exposes supervision and AI jobs while retaining existing screen routes", () => {
  const contract = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/navigationContract.ts"), "utf8");
  const nav = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/primaryNavigation.tsx"), "utf8");
  assert.match(contract, /PRIMARY_DESTINATIONS = \["Home", "Paper", "Live", "More"\]/);
  assert.match(app, /<PrimaryNavigation/);
  assert.match(app, /activeTab === "Paper" \? <PaperShadowMonitorView/);
  assert.match(app, /activeTab === "Live" \? <LiveReadinessMonitorView/);
  assert.match(nav, /testID="primary-navigation"/);
  assert.doesNotMatch(app, /const tabs = \["Home", "Markets", "Paper", "Portfolio", "AiSignal"\]/);
  assert.doesNotMatch(app, /Markets: "MARKET", Paper: "TRADE"/);
});

test("navigation contract keeps utility navigation secondary to product primary navigation", () => {
  assert.match(navigation, /PRIMARY_MOBILE_TABS[^\n]*\["HOME", "OBSERVE", "PAPER", "SUPERVISE"\]/);
  assert.match(navigation, /export type SecondaryMobileTab = "MORE"/);
  assert.match(navigation, /if \(tab === "CONTROL"\) return "PAPER"/);
  assert.match(navigation, /if \(tab === "SETTINGS"\) return "MORE"/);
});
