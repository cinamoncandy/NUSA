const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("HOME keeps verified market observation substantial and tablet-aware", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  assert.match(home, /const tablet = width >= 768;/);
  assert.match(home, /contentContainerStyle=\{\[styles\.content, \{ maxWidth: tablet \? 980 : 720 \}\]\}/);
  assert.match(home, /\.slice\(0, tablet \? 5 : 3\)/);
  assert.match(home, /testID="home-market-pulse"/);
  assert.match(home, /testID="home-market-breadth"/);
  assert.match(home, /testID="home-decision-stage"/);
  assert.match(home, /selectHomeMarketData\(props\.publicMarkets, props\.snapshot\?\.markets \?\? \[\]\)/);
  assert.match(home, /UPBIT PUBLIC/);
});

test("HOME approved intelligence hierarchy remains content-first and evidence-backed", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const pulse = home.indexOf('testID="home-market-pulse"');
  const ai = home.indexOf('testID="ai-card"');
  const terrain = home.indexOf('testID="home-decision-stage"');
  const breadth = home.indexOf('testID="home-market-breadth"');
  const signals = home.indexOf('testID="home-top-signals"');
  const paper = home.indexOf('testID="home-paper-performance"');
  const capital = home.indexOf('testID="home-capital-limits"');
  const learning = home.indexOf('testID="home-paper-learning"');
  assert.ok([pulse, ai, terrain, breadth, signals, paper, capital, learning].every((index) => index >= 0));
  assert.ok(pulse < ai && ai < terrain && terrain < breadth && breadth < signals && signals < paper && paper < capital && capital < learning);
});
