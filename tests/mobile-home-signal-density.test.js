const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("HOME MASTER keeps verified market observation substantial and tablet-aware", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  assert.match(home, /const tablet = width >= 768;/);
  assert.match(home, /maxWidth: tablet \? 980 : 720/);
  assert.match(home, /\.slice\(0, tablet \? 5 : 3\)/);
  assert.match(home, /MARKET PULSE/);
  assert.match(home, /testID="home-decision-stage"/);
  assert.match(home, /selectHomeMarketData\(props\.publicMarkets, props\.snapshot\?\.markets \?\? \[\]\)/);
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
  // Order follows the approved consumer design, which leads with the market snapshot and then the
  // signal terrain. The earlier operator-console hierarchy (AI terrain first) is superseded: the
  // brief states the previous HOME MASTER terminal layout is no longer the standard.
  assert.ok(observe < ai, "market snapshot must lead the AI signal terrain");
  assert.ok(ai < paper, "AI terrain must lead PAPER performance");
  assert.ok(paper < learning, "PAPER performance must lead the learning evidence rail");
  assert.ok(learning <= risk, "learning evidence must reach the final risk authority block");
});
