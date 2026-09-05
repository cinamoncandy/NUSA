const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("HOME keeps the canonical signal terrain substantial and tablet-aware", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  assert.match(home, /const tablet = width >= 768;/);
  assert.match(home, /contentContainerStyle=\{\[styles\.content, \{ maxWidth: tablet \? 980 : 620 \}\]\}/);
  assert.match(home, /signalBody: \{[^\n]*minHeight: 250/);
  assert.match(home, /terrainWrap: \{[^\n]*minHeight: 250/);
  assert.match(home, /\.slice\(0, tablet \? 5 : 3\)/);
  assert.match(home, /testID="home-signal-trace"/);
});

test("HOME canonical hierarchy places AI decision terrain before terminal market and learning panels", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const ai = home.indexOf('testID="ai-card"');
  const terrain = home.indexOf('testID="home-signal-trace"');
  const market = home.indexOf('testID="home-market-pulse"');
  const terminalGrid = home.indexOf('testID="home-terminal-grid"');
  const learning = home.indexOf('title="▤  LEARNING"');
  assert.ok(ai >= 0, "AI INSIGHT card must exist");
  assert.ok(terrain >= 0, "signal terrain must exist");
  assert.ok(market >= 0, "market pulse must exist");
  assert.ok(terminalGrid >= 0, "terminal grid must exist");
  assert.ok(learning >= 0, "learning panel must remain available");
  assert.ok(ai < terrain, "AI decision must lead terrain");
  assert.ok(terrain < market, "terrain must lead market pulse");
  assert.ok(market < terminalGrid, "market pulse must lead lower terminal panels");
  assert.ok(terminalGrid < learning, "learning must live inside the lower terminal rail");
});
