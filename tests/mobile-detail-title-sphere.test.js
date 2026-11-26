const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const frame = fs.readFileSync(path.join(root, "apps/mobile/src/screenFrame.tsx"), "utf8");

test("detail-screen titles use the 기록 head: index line, one big title, still corner sphere", () => {
  assert.match(frame, /<InstrumentHero index=\{detail \?\? "NUSA"\} lines=\{\[\{ text: title \}\]\} label=\{title\} \/>/);
  assert.match(frame, /<LatticeSphere decisionCount=\{null\} orderCount=\{null\} live=\{false\} still width=\{CORNER_SIZE\}/);
  assert.match(frame, /testID="screen-title-sphere"/);
});

test("the corner sphere never turns, lights nothing and is hidden from touch", () => {
  assert.match(frame, /pointerEvents="none"/);
  assert.doesNotMatch(frame, /decisionCount=\{[1-9]/);
  assert.doesNotMatch(frame, /live=\{true\}/);
  assert.doesNotMatch(frame, /#[0-9a-fA-F]{6}/);
});

test("the three users of ScreenTitle keep their title and detail text", () => {
  const perf = fs.readFileSync(path.join(root, "apps/mobile/src/performanceView.tsx"), "utf8");
  const more = fs.readFileSync(path.join(root, "apps/mobile/src/moreDetailView.tsx"), "utf8");
  assert.match(perf, /<ScreenTitle title="성과" detail="PAPER · 읽기 전용" \/>/);
  assert.match(more, /<ScreenTitle title=\{item\.title\} detail="더보기 · 읽기 전용" \/>/);
});
