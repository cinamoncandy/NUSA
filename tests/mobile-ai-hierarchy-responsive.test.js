const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mobileRoot = path.join(__dirname, "..", "apps", "mobile");
const readMobile = (relative) => fs.readFileSync(path.join(mobileRoot, relative), "utf8");
const readRepo = (relative) => fs.readFileSync(path.join(__dirname, "..", relative), "utf8");

function assertOrdered(source, markers) {
  let previous = -1;
  for (const marker of markers) {
    const index = source.indexOf(marker);
    assert.ok(index >= 0, `missing marker: ${marker}`);
    assert.ok(index > previous, `marker out of order: ${marker}`);
    previous = index;
  }
}

test("AI screen keeps decision trust evidence risk authority action research learning hierarchy", () => {
  const ai = readMobile("src/aiView.tsx");
  assertOrdered(ai, [
    'testID="ai-now"',
    'testID="ai-confidence"',
    'testID="ai-why"',
    'testID="ai-risk"',
    'testID="ai-zero-authority-status"',
    'testID="ai-next-action"',
    'testID="ai-result"',
    'testID="ai-learning"',
  ]);
  assert.match(ai, /판단 → 신뢰도 → 근거 → 리스크 → PAPER 검토/);
  assert.match(ai, /PAPER에서만 검토 · LIVE 실행 없음/);
  assert.match(ai, /사용자 확인 없이 주문·출금·운영 변경을 수행하지 않습니다/);
  assert.doesNotMatch(ai, /placeOrder\(|submitOrder\(|withdraw\(|productionMutationAllowed\s*=\s*true/);
});

test("AI responsive contract explicitly covers 360 390 and 430 px", () => {
  const profile = readMobile("src/mobileViewportProfile.ts");
  const ai = readMobile("src/aiView.tsx");
  assert.match(profile, /MOBILE_ACCEPTANCE_WIDTHS = \[360, 390, 430\] as const/);
  assert.match(profile, /MOBILE_COMPACT_MAX_WIDTH = 430/);
  assert.match(profile, /MOBILE_NARROW_MAX_WIDTH = 360/);
  assert.match(profile, /MOBILE_MIN_TOUCH_TARGET = 48/);
  assert.match(profile, /narrow: width <= MOBILE_NARROW_MAX_WIDTH/);
  assert.match(ai, /useWindowDimensions/);
  assert.match(ai, /getMobileViewportProfile\(width\)/);
  assert.match(ai, /viewport\.narrow \? styles\.metricGridNarrow : null/);
  assert.match(ai, /viewport\.narrow \? styles\.metricCellNarrow : null/);
});

test("operational status text has redundant non-color semantics", () => {
  const rail = readMobile("src/homeStatusRail.ts");
  for (const cue of [
    "LIVE · 시장 온라인",
    "STALE · 시장 대기",
    "BLOCKED · PAPER 중단",
    "DEGRADED · PAPER 저하",
    "CHECK · PAPER 미연결",
    "CHECK · PAPER 확인 불가",
    "PAPER · 정상",
  ]) {
    assert.ok(rail.includes(cue), `missing semantic status cue: ${cue}`);
  }

  const ai = readMobile("src/aiView.tsx");
  assert.match(ai, /ERROR · AI 상태를 표시할 수 없습니다/);
  assert.match(ai, /CHECK · AI 상태를 불러오는 중/);
  assert.match(ai, /CAUTION · AI 분석은 판단 보조입니다/);
});

test("Android acceptance physically enters AI and verifies zero authority before returning home", () => {
  const workflow = readRepo(".github/workflows/android-product-ux-acceptance.yml");
  assert.match(workflow, /tap "tab-AiSignal"; capture 12-ai/);
  assert.match(workflow, /scroll_until_visible "ai-zero-authority-status"; capture 13-ai-authority/);
  assert.match(workflow, /grep -q "ai-screen" qa\/android-product-ux\/12-ai\.xml/);
  assert.match(workflow, /grep -q "ai-zero-authority-status" qa\/android-product-ux\/13-ai-authority\.xml/);
  assert.match(workflow, /tap "tab-Home"; capture 14-home-return/);
  assert.match(workflow, /ai_navigation=PASS/);
  assert.match(workflow, /ai_zero_authority=PASS/);
});
