const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("HOME keeps verified market observation substantial and tablet-aware", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  assert.match(home, /const tablet = width >= 768;/);
  assert.match(home, /contentContainerStyle=\{\[styles\.content, \{ maxWidth: tablet \? 1080 : 720 \}\]\}/);
  assert.match(home, /\.slice\(0, tablet \? 5 : 3\)/);
  assert.match(home, /QUICK ACCESS/);
  assert.match(home, /testID="home-decision-stage"/);
  assert.match(home, /selectHomeMarketData\(publicMarkets, snapshot\?\.markets \?\? \[\]\)/);
  assert.match(home, /PUBLIC READ ONLY/);
});

test("HOME content-first hierarchy places glanceable workspaces before progressive decision and risk detail", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const ai = home.indexOf('testID="ai-card"');
  const risk = home.indexOf('testID="home-risk-status"');
  const observe = home.indexOf('testID="home-decision-stage"');
  const paper = home.indexOf('testID="home-paper-performance"');
  const learning = home.indexOf('testID="home-paper-learning"');
  assert.ok(ai >= 0, "AI detail must exist");
  assert.ok(risk >= 0, "risk detail must exist");
  assert.ok(observe >= 0, "observation workspace must exist");
  assert.ok(paper >= 0, "PAPER workspace must exist");
  assert.ok(learning >= 0, "learning workspace must exist");
  assert.ok(observe < paper, "observation workspace must lead PAPER supervision");
  assert.ok(paper < learning, "PAPER supervision must lead learning");
  assert.ok(learning < ai, "workspace actions must precede progressive AI detail");
  assert.ok(ai < risk, "decision basis must precede detailed risk evidence");
});
