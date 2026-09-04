const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("HOME keeps the canonical terrain compact and tablet-aware", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  assert.match(home, /const tablet = width >= 768;/);
  assert.match(home, /terrainFrame: \{ height: 206,/);
  assert.match(home, /const contentWidth = tablet \? 760 : 520;/);
  assert.match(home, /\.slice\(0, 3\);/);
});

test("HOME canonical hierarchy places decision terrain before major indicators", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const ai = home.indexOf('testID="ai-card"');
  const terrain = home.indexOf('testID="home-decision-stage"');
  const metrics = home.indexOf('testID="home-market-pulse"');
  const learning = home.indexOf('testID="home-paper-learning"');
  assert.ok(ai >= 0, "NUSA AI decision card must exist");
  assert.ok(terrain >= 0, "signal terrain must exist");
  assert.ok(metrics >= 0, "major indicator row must exist");
  assert.ok(learning >= 0, "PAPER learning route must remain available");
  assert.ok(ai < terrain, "AI decision must lead terrain");
  assert.ok(terrain < metrics, "terrain must lead major indicators");
  assert.ok(metrics < learning, "major indicators must precede the safety/learning rail");
});
