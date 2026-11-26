const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const src = (f) => fs.readFileSync(path.join(path.resolve(__dirname, ".."), "apps/mobile/src", f), "utf8");

test("the corner sphere is still, lights nothing, ignores touch and is hidden from screen readers", () => {
  const s = src("cornerSphere.tsx");
  assert.match(s, /decisionCount=\{null\} orderCount=\{null\} live=\{false\} still/);
  assert.match(s, /pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"/);
  assert.match(s, /CORNER_SPHERE_SIZE = 76/);
  assert.match(s, /CORNER_SPHERE_RESERVE = CORNER_SPHERE_SIZE \+ 8/);
  assert.match(s, /CORNER_SPHERE_HEAD_MIN_HEIGHT = CORNER_SPHERE_RESERVE/);
  assert.doesNotMatch(s, /#[0-9a-fA-F]{6}/);
});

test("ScreenHeader and ScreenLead take the sphere only when asked and keep their text clear of it", () => {
  const ux = src("uxPrimitives.tsx"), os = src("intelligenceOs.tsx");
  assert.match(ux, /sphere = false/);
  assert.match(ux, /\{sphere \? <CornerSphere testID="screen-header-sphere" \/> : null\}/);
  assert.match(ux, /paddingRight: CORNER_SPHERE_RESERVE/);
  assert.match(ux, /minHeight: CORNER_SPHERE_HEAD_MIN_HEIGHT/);
  assert.match(ux, /headerActionsSphere: \{[^}]*paddingRight: CORNER_SPHERE_RESERVE/);
  assert.match(os, /sphere = false/);
  assert.match(os, /\{sphere \? <CornerSphere testID="screen-lead-sphere" \/> : null\}/);
});

test("only settings, order history and the portfolio (assets) opt in; text, chips and actions are unchanged", () => {
  assert.match(src("settingsView.tsx"), /<ScreenHeader sphere eyebrow="앱 설정" title="설정"/);
  assert.match(src("orderHistoryView.tsx"), /<ScreenHeader sphere \{\.\.\.HEAD_TEXT\}/);
  assert.match(src("orderHistoryView.tsx"), /HEAD_TEXT = \{ eyebrow: "PAPER 주문 기록", title: "주문 이력"/);
  assert.match(src("portfolioView.tsx"), /<ScreenLead sphere eyebrow="포트폴리오" title="모의투자 자산과 결과"/);
  for (const f of ["aiView.tsx", "marketsView.tsx", "notificationView.tsx", "tradingViewLegacy.tsx"]) assert.doesNotMatch(src(f), /<Screen(Header|Lead) sphere/);
});
