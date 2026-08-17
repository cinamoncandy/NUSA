const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("master UI uses shared tokens and common production components", () => {
  const components = read("apps/mobile/src/components.tsx");
  const app = read("apps/mobile/App.tsx");
  const home = read("apps/mobile/src/homeView.tsx");
  const design = read("apps/mobile/src/designSystem.ts");

  assert.match(design, /export interface Theme/);
  assert.match(components, /export function BottomNavigation/);
  assert.match(components, /export function AIInsight/);
  assert.match(components, /export function SafetyNotice/);
  assert.match(components, /theme\.radii/);
  assert.match(components, /theme\.spacing/);
  assert.match(app, /<BottomNavigation/);
  assert.match(home, /<AIInsight/);
  assert.match(home, /<SafetyNotice/);
});

test("master UI preserves paper-only safety semantics", () => {
  const app = read("apps/mobile/App.tsx");
  const home = read("apps/mobile/src/homeView.tsx");
  assert.match(app, /PAPER ONLY/);
  assert.match(app, /LIVE NONE/);
  assert.match(read("apps/mobile/src/components.tsx"), /READ ONLY/);
  assert.match(home, /killSwitchActive/);
  assert.match(home, /productionMutationAllowed/);
});
