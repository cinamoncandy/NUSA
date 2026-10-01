const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, "apps/mobile/src", file), "utf8");

test("contour core runs only native-driver transforms and stops under reduce-motion", () => {
  const view = read("contourCore.tsx");
  assert.doesNotMatch(view, /useNativeDriver: false/);
  assert.match(view, /const animate = !reducedMotion && decisionCount != null/);
  assert.match(view, /if \(!animate\) return undefined/);
});

test("the alignment pulse fires only when the real decision count increases", () => {
  const view = read("contourCore.tsx");
  assert.match(view, /if \(previous == null \|\| decisionCount == null \|\| decisionCount <= previous\) return;/);
  assert.doesNotMatch(view, /setInterval|setTimeout/, "no invented decision cadence");
});

test("the HOME hero renders the contour core with the canonical count", () => {
  const rings = read("decisionRings.tsx");
  assert.match(rings, /<ContourCore decisionCount=\{model\.decisionCount\} reducedMotion=\{reducedMotion\}/);
  assert.match(rings, /testID="home-decision-rings-orders"/);
});

test("turning reduce-motion on mid-pulse stops the in-flight pulse and settles the rings", () => {
  const view = read("contourCore.tsx");
  assert.match(view, /if \(!animate\) \{\s*\/\/[^\n]*\n\s*pulseAnimation\.current\?\.stop\(\);/);
  assert.match(view, /useEffect\(\(\) => \(\) => \{ pulseAnimation\.current\?\.stop\(\); \}, \[\]\);/);
});

test("rings copy describes the contour, not a spiral", () => {
  const model = fs.readFileSync(path.join(root, "apps/mobile/src/decisionRingsModel.ts"), "utf8");
  assert.doesNotMatch(model, /나선으로 쌓|가운데에 생깁니다/);
});
