const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const cockpit = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/paperShadowMonitorView.tsx"), "utf8");

test("PAPER tab mode labels are plain Korean and each mode explains itself", () => {
  assert.match(cockpit, /PAPER: "운영", SYSTEM: "학습", SHADOW: "재현", REAL: "실계좌"/);
  assert.match(cockpit, /testID="paper-shadow-monitor-hint">\{HINT\[mode\]\}/);
  assert.match(cockpit, /REAL: "실제 계좌를 읽기만 한 결과 · 주문 없음"/);
});

test("the read-only tag is visible in Korean and keeps its canonical accessible name", () => {
  assert.match(cockpit, /accessibilityLabel="READ ONLY">읽기 전용</);
  assert.match(cockpit, /switch: \{ minHeight: 44,/, "tab targets meet the 44pt touch size");
});
