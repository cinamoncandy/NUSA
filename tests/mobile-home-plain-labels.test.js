const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const home = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/homeView.tsx"), "utf8");

test("the no-order reason is its own card directly under the HOME hero", () => {
  const hero = home.indexOf('testID="home-now"');
  const card = home.indexOf('testID="home-order-reason-card"');
  const rail = home.indexOf('testID="home-status-rail"');
  assert.ok(hero > 0 && card > hero && rail > card, "hero -> reason card -> status rail");
  assert.match(home, /주문하지 않은 이유/);
});

test("HOME section labels are plain Korean instead of internal codes", () => {
  for (const code of ["MARKET CANVAS", "NUSA LOOP", "01 · OBSERVE", "02 · TEST", "03 · LEARN", ">INVESTABLE<"]) {
    assert.equal(home.includes(code), false, code);
  }
});

test("the reason card heading only says 'no order' for no-order categories and hidden hooks stay out of TalkBack", () => {
  assert.match(home, /orderReason\.category === "FILLED" \? "최근 체결" : orderReason\.category === "UNKNOWN" \? "최근 판단 결과" : "주문하지 않은 이유"/);
  assert.match(home, /accessibilityElementsHidden importantForAccessibility="no-hide-descendants"/);
  assert.match(home, /onNavigate\("More"\)[\s\S]{0,900}>성과와 기록</);
});
