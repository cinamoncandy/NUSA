const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/App.tsx"), "utf8");
const navigation = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/mobileNavigation.ts"), "utf8");

test("visible mobile navigation exposes supervision jobs while retaining existing screen routes", () => {
  assert.match(app, /const tabs = \["Home", "Markets", "Paper", "Portfolio"\]/);
  assert.match(app, /Home: "HOME", Markets: "OBSERVE", Paper: "PAPER", Portfolio: "SUPERVISE"/);
  assert.match(app, /Home: "현재 NUSA 상태", Markets: "공개 시장 관찰", Paper: "PAPER 운용", Portfolio: "PAPER 운용 감독"/);
  assert.match(app, /testID="primary-navigation"/);
  assert.doesNotMatch(app, /Markets: "MARKET", Paper: "TRADE", Portfolio: "PORTFOLIO"/);
});

test("navigation contract keeps utility navigation secondary instead of a fifth primary tab", () => {
  assert.match(navigation, /PRIMARY_MOBILE_TABS[^\n]*\["HOME", "OBSERVE", "PAPER", "SUPERVISE"\]/);
  assert.match(navigation, /export type SecondaryMobileTab = "MORE"/);
  assert.match(navigation, /if \(tab === "CONTROL"\) return "PAPER"/);
  assert.match(navigation, /if \(tab === "SETTINGS"\) return "MORE"/);
});
