const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mobile = path.join(__dirname, "..", "apps", "mobile");
const read = (relative) => fs.readFileSync(path.join(mobile, relative), "utf8");

test("canonical primary navigation keeps internal routes while rendering easy Korean labels", () => {
  const contract = read("src/navigationContract.ts");
  assert.match(contract, /PRIMARY_DESTINATIONS = \["Home", "Paper", "Live", "More"\]/);
  assert.match(contract, /Home: "홈"/);
  assert.match(contract, /Paper: "모의투자"/);
  assert.match(contract, /Live: "실거래 준비"/);
  assert.match(contract, /More: "더보기"/);
});

test("cinematic intelligence field uses continuous ribbons instead of orbit or node clusters", () => {
  const field = read("src/intelligenceField.tsx");
  assert.match(field, /ribbonBandA/);
  assert.match(field, /ribbonBandB/);
  assert.match(field, /focusLine/);
  assert.doesNotMatch(field, /DOTS_PER_ARM|ParticleLayer|buildFieldGeometry|buildStrandPaths|orbitRotate/);
});

test("PAPER and LIVE request distinct semantic visual fields", () => {
  const paper = read("src/paperLearningMonitorView.tsx");
  const live = read("src/liveReadinessMonitorView.tsx");
  assert.match(paper, /buildPaperFieldHeader/);
  assert.match(live, /buildLiveFieldHeader/);
  assert.match(live, /liveAuthority=NONE/);
  assert.match(live, /productionMutationAllowed=false/);
});

test("MORE is a typographic intelligence index rather than a generic Surface card list", () => {
  const more = read("src/moreMenuView.tsx");
  assert.match(more, /판단 · 자산 · 시스템/);
  assert.match(more, /전략/);
  assert.match(more, /포트폴리오/);
  assert.match(more, /시스템 상태/);
  assert.match(more, /borderBottomWidth: StyleSheet\.hairlineWidth/);
  assert.doesNotMatch(more, /<Surface|<NusaCard/);
});

test("HOME hero is flattened onto the canvas instead of a rounded finance card", () => {
  const home = read("src/homeView.tsx");
  assert.match(home, /borderRadius: 0/);
  assert.match(home, /borderTopWidth: StyleSheet\.hairlineWidth/);
  assert.match(home, /borderBottomWidth: StyleSheet\.hairlineWidth/);
});
