const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("HOME keeps the canonical terrain compact and tablet-aware", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  assert.match(home, /const tablet = width >= 768;/);
  assert.match(home, /testID="home-decision-stage"/);
  assert.match(home, /maxWidth: tablet \? Math\.max\(profile\.screen\.maxWidth, 980\) : profile\.screen\.maxWidth/);
  assert.match(home, /\.slice\(0, tablet \? 5 : 3\);/);
});

test("HOME canonical hierarchy places decision and safety truth before market exploration", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const ai = home.indexOf('testID="ai-card"');
  const terrain = home.indexOf('testID="home-decision-stage"');
  const learning = home.indexOf('testID="home-paper-learning"');
  const metrics = home.indexOf('testID="home-market-pulse"');
  assert.ok(ai >= 0, "NUSA AI decision card must exist");
  assert.ok(terrain >= 0, "signal terrain must exist");
  assert.ok(learning >= 0, "PAPER learning route must remain available");
  assert.ok(metrics >= 0, "major market indicator panel must exist");
  assert.ok(ai < terrain, "AI decision must lead terrain");
  assert.ok(terrain < learning, "terrain must lead the safety/learning truth rail");
  assert.ok(learning < metrics, "safety/learning truth must precede market exploration");
});
