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

test("HOME signal terrain remains downstream of the supervisor decision spine", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const learning = home.indexOf('testID="home-supervisor-learning"');
  const terrain = home.indexOf('testID="home-decision-stage"');
  assert.ok(learning >= 0, "supervisor LEARNING row must exist");
  assert.ok(terrain >= 0, "signal terrain must exist");
  assert.ok(learning < terrain, "decision spine must stay ahead of the visual signal terrain");
});
