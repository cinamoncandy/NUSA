const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mobile = path.join(__dirname, "..", "apps", "mobile");
const read = (relative) => fs.readFileSync(path.join(mobile, relative), "utf8");

test("canonical primary navigation renders HOME PAPER LIVE MORE literally", () => {
  const contract = read("src/navigationContract.ts");
  assert.match(contract, /Home: "HOME"/);
  assert.match(contract, /Paper: "PAPER"/);
  assert.match(contract, /Live: "LIVE"/);
  assert.match(contract, /More: "MORE"/);
});

test("cinematic intelligence field uses continuous ribbons instead of orbit or node clusters", () => {
  const components = read("src/components.tsx");
  assert.match(components, /ribbonBandA/);
  assert.match(components, /authorityBoundaryPlane/);
  assert.match(components, /variant === "authority"/);
  assert.doesNotMatch(components, /intelligenceOrbitOuter/);
  assert.doesNotMatch(components, /latticeNodeA/);
  assert.doesNotMatch(components, /intelligenceCoreHalo/);
});

test("PAPER and LIVE request distinct semantic visual fields", () => {
  const paper = read("src/paperLearningMonitorView.tsx");
  const live = read("src/liveReadinessMonitorView.tsx");
  assert.match(paper, /variant="flow"/);
  assert.match(live, /variant="authority"/);
  assert.match(live, /liveAuthority=NONE/);
  assert.match(live, /productionMutationAllowed=false/);
});

test("MORE is a typographic intelligence index rather than a generic Surface card list", () => {
  const more = read("src/moreMenuView.tsx");
  assert.match(more, /INTELLIGENCE/);
  assert.match(more, /CAPITAL/);
  assert.match(more, /SYSTEM/);
  assert.match(more, /architectureField/);
  assert.doesNotMatch(more, /<Surface/);
});

test("HOME hero is flattened onto the canvas instead of a rounded finance card", () => {
  const home = read("src/homeView.tsx");
  assert.match(home, /borderRadius: 0/);
  assert.match(home, /borderTopWidth: StyleSheet\.hairlineWidth/);
  assert.match(home, /borderBottomWidth: StyleSheet\.hairlineWidth/);
});
