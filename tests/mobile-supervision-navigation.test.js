const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/App.tsx"), "utf8");
const navigation = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/mobileNavigation.ts"), "utf8");

test("visible mobile navigation exposes supervision and AI jobs while retaining existing screen routes", () => {
  assert.match(app, /const tabs = \["Home", "Market", "Signals", "Strategies", "More"\]/);
  assert.match(app, /Home: "Home", Market: "Market", Signals: "Signals", Strategies: "Strategies", More: "More"/);
  assert.match(app, /Home: "현재 NUSA 상태", Market: "공개 시장 환경", Signals: "AI 판단과 근거", Strategies: "검증된 연구 전략", More: "더 깊은 화면과 설정"/);
  assert.match(app, /testID="primary-navigation"/);
  assert.doesNotMatch(app, /Markets: "MARKET", Paper: "TRADE"/);
});

test("navigation contract keeps utility navigation secondary to product primary navigation", () => {
  assert.match(navigation, /PRIMARY_MOBILE_TABS[^\n]*\["HOME", "OBSERVE", "PAPER", "SUPERVISE"\]/);
  assert.match(navigation, /export type SecondaryMobileTab = "MORE"/);
  assert.match(navigation, /if \(tab === "CONTROL"\) return "PAPER"/);
  assert.match(navigation, /if \(tab === "SETTINGS"\) return "MORE"/);
});
