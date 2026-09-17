const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("HOME MASTER keeps verified market observation substantial and tablet-aware", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  assert.match(home, /const tablet = width >= 768;/);
  assert.match(home, /maxWidth: tablet \? Math\.max\(profile\.screen\.maxWidth, 980\) : profile\.screen\.maxWidth/);
  assert.match(home, /\.slice\(0, tablet \? 5 : 3\)/);
  assert.match(home, /MARKET PULSE/);
  assert.match(home, /testID="home-decision-stage"/);
  assert.match(home, /selectHomeMarketData\(publicMarkets, snapshot\?\.markets \?\? \[\]\)/);
  assert.match(home, /UPBIT PUBLIC/);
});

test("HOME MASTER places AI terrain and evidence before dense truthful supervision modules", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const ai = home.indexOf('testID="ai-card"');
  const observe = home.indexOf('testID="home-market-pulse"');
  const paper = home.indexOf('testID="home-paper-performance"');
  const learning = home.indexOf('testID="home-paper-learning"');
  const risk = home.indexOf('testID="home-risk-authority"');
  assert.ok(ai >= 0, "AI terrain must exist");
  assert.ok(observe >= 0, "market pulse must exist");
  assert.ok(paper >= 0, "PAPER performance must exist");
  assert.ok(learning >= 0, "learning evidence must exist");
  assert.ok(risk >= 0, "risk authority must exist");
  assert.ok(ai < learning, "AI terrain must lead evidence rail");
  assert.ok(learning < observe, "evidence rail must lead market terminal modules");
  assert.ok(observe < paper, "market observation must lead PAPER performance");
  assert.ok(paper < risk, "PAPER supervision must lead final risk authority block");
});
