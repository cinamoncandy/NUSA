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

test("settings, order history, assets, AI, markets and notifications opt in; the 주문 form (tradingViewLegacy) never does; text, chips and actions are unchanged", () => {
  assert.match(src("settingsView.tsx"), /<ScreenHeader sphere eyebrow="앱 설정" title="설정"/);
  assert.match(src("orderHistoryView.tsx"), /<ScreenHeader sphere \{\.\.\.HEAD_TEXT\}/);
  assert.match(src("orderHistoryView.tsx"), /HEAD_TEXT = \{ eyebrow: "PAPER 주문 기록", title: "주문 이력"/);
  assert.match(src("portfolioView.tsx"), /<ScreenLead sphere eyebrow="포트폴리오" title="모의투자 자산과 결과"/);
  assert.match(src("aiView.tsx"), /<ScreenHeader sphere eyebrow="NUSA INTELLIGENCE" title="AI" description="현재 관찰과 근거를 읽기 전용으로 제공합니다\. AI는 주문 권한이 없습니다\." statusLabel="READ ONLY"/);
  assert.match(src("marketsView.tsx"), /<ScreenLead sphere eyebrow="MARKETS" title=\{selectedMarket\} detail="NUSA가 관측하는 공개 가격 흐름과 데이터 신선도입니다\." badge="MARKETS"/);
  assert.match(src("notificationView.tsx"), /<ScreenHeader sphere eyebrow="기기 알림" title="알림" description="실제로 연결된 이벤트만 표시합니다\." statusLabel="미연결"/);
  assert.doesNotMatch(src("tradingViewLegacy.tsx"), /<Screen(Header|Lead) sphere/);
  assert.doesNotMatch(src("tradingView.tsx"), /sphere/);
});
