const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("HOME keeps the white mint supervisory hero responsive and compact", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  assert.match(home, /const tablet = width >= 768;/);
  assert.match(home, /maxWidth: tablet \? 920 : 620/);
  assert.match(home, /hero:\{[^}]*minHeight:360/);
  assert.match(home, /accessibilityLabel="NUSA white mint supervisory orb"/);
  assert.match(home, /orbOuter:\{[^}]*width:150[^}]*height:150/);
});

test("HOME white mint hierarchy leads with supervisory state before evidence", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const now = home.indexOf('testID="home-supervisor-now"');
  const why = home.indexOf('testID="home-supervisor-why"');
  const learning = home.indexOf('testID="home-supervisor-learning"');
  assert.ok(now >= 0, "NOW supervisory state must exist");
  assert.ok(why >= 0, "WHY evidence must exist");
  assert.ok(learning >= 0, "LEARNING evidence must exist");
  assert.ok(now < why, "supervisory NOW must lead evidence");
  assert.ok(why < learning, "WHY must precede LEARNING");
  assert.doesNotMatch(home, /AI INSIGHT \/ SIGNAL TERRAIN/);
});
