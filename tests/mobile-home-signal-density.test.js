const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("HOME keeps verified signal observation substantial and tablet-aware", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  assert.match(home, /const tablet = width >= 768;/);
  assert.match(home, /contentContainerStyle=\{\[styles\.content, \{ maxWidth: tablet \? 980 : 680 \}\]\}/);
  assert.match(home, /\.slice\(0, tablet \? 5 : 3\)/);
  assert.match(home, /kicker="SIGNAL TERRAIN"/);
  assert.match(home, /testID="home-decision-stage"/);
  assert.match(home, /NO QUALIFIED SIGNAL/);
  assert.match(home, /selectHomeMarketData\(publicMarkets, snapshot\?\.markets \?\? \[\]\)/);
});

test("HOME canonical hierarchy places decision and risk before observation, PAPER result, and learning", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const ai = home.indexOf('testID="ai-card"');
  const risk = home.indexOf('testID="home-risk-status"');
  const terrain = home.indexOf('testID="home-decision-stage"');
  const paper = home.indexOf('testID="home-paper-performance"');
  const learning = home.indexOf('testID="home-paper-learning"');
  assert.ok(ai >= 0, "AI insight must exist");
  assert.ok(risk >= 0, "risk gate must exist");
  assert.ok(terrain >= 0, "verified observation stage must exist");
  assert.ok(paper >= 0, "PAPER performance must exist");
  assert.ok(learning >= 0, "learning stage must exist");
  assert.ok(ai < terrain, "reason must lead observation");
  assert.ok(risk < terrain, "risk gate must lead observation");
  assert.ok(terrain < paper, "observation must lead PAPER result");
  assert.ok(paper < learning, "PAPER result must lead learning");
});
