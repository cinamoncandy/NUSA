const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("HOME AI judgment drills into delivered verified evidence without creating a dead control", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  assert.match(home, /const aiAvailable = !unavailable && ai\?\.status === "AVAILABLE"/);
  assert.match(home, /ai\.evidenceReferences\.slice\(0, 2\)/);
  assert.match(home, /ai\.counterEvidence\.slice\(0, 2\)/);
  assert.match(home, /testID="home-ai-detail-action"/);
  assert.match(home, /onPress=\{\(\) => onNavigate\("AiSignal"\)\}/);
  assert.match(home, />판단 근거 상세 보기  →<\/Text>/);
  assert.match(home, />근거<\/Text>/);
  assert.match(home, /검증된 AI projection이 없어 근거를 표시하지 않습니다/);
});

test("HOME orders runtime truth, judgment, evidence validation, then secondary contexts", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const runtime = home.indexOf('testID="home-status-rail"');
  const judgment = home.indexOf('testID="home-intelligence-reveal"');
  const evidence = home.indexOf('>근거</Text>');
  const validation = home.indexOf('>불확실성 / 검증</Text>');
  const market = home.indexOf('testID="home-market-canvas-reveal"');
  const paper = home.indexOf('testID="home-capital-reveal"');
  const learning = home.indexOf('testID="home-paper-learning"');

  assert.ok(runtime >= 0 && judgment >= 0 && evidence >= 0 && validation >= 0 && market >= 0 && paper >= 0 && learning >= 0, "canonical Runtime Canvas decision flow must exist");
  assert.ok(runtime < judgment && judgment < evidence && evidence < validation && validation < market && market < paper && paper < learning, "HOME scan order must remain runtime truth → judgment → evidence → validation → market → PAPER → learning");
  assert.match(home, /PAPER ONLY/);
  assert.match(home, /LIVE NONE · MUTATION FALSE · AI ZERO AUTHORITY/);
  assert.doesNotMatch(home, /OBSERVE → REASON → VERIFY → DECIDE/);
});
