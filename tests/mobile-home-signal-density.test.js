const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("HOME keeps the signal terrain compact on phones while preserving tablet depth", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  assert.match(home, /const tablet = width >= 768;/);
  assert.match(home, /styles\.terrainHero, \{ height: tablet \? 300 : 220 \}/);
});

test("HOME AI-first hierarchy leads with signal terrain before the evidence truth rail", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const terrain = home.indexOf('testID="home-decision-stage"');
  const why = home.indexOf('testID="home-supervisor-why"');
  const learning = home.indexOf('testID="home-supervisor-learning"');
  assert.ok(terrain >= 0, "signal terrain must exist");
  assert.ok(why >= 0, "WHY evidence cell must exist");
  assert.ok(learning >= 0, "LEARNING evidence cell must exist");
  assert.ok(terrain < why, "AI-first signal terrain must lead the evidence truth rail");
  assert.ok(why < learning, "evidence truth rail must preserve WHY before LEARNING");
});
