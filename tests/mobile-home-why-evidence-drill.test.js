const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("HOME AI judgment drills into verified evidence without creating a dead control", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  assert.match(home, /aiThesis: ai\?\.status === "AVAILABLE" \? ai\.thesis : null/);
  assert.match(home, /aiEvidenceCount: ai\?\.status === "AVAILABLE" \? ai\.evidenceReferences\.length : 0/);
  assert.match(home, /const signalAvailable = decision\.aiInsightAvailable/);
  assert.match(home, /onPress=\{\(\)\s*=>\s*props\.onNavigate\("Signals"\)\}/);
  assert.match(home, /testID="home-ai-judgement"/);
  // The approved layout has no WHY/RESULT/RISK rows on HOME. d9226f33 kept the strings alive in a
  // 1x1 opacity-0 node under testID="home-supervisor-learning", which satisfied the old assertions
  // while showing the owner nothing; that node is now gone. This test is named for dead controls, so
  // what it asserts instead is that the drill leads somewhere real: AI SIGNAL renders the thesis.
  assert.doesNotMatch(home, /position:"absolute",width:1,height:1,opacity:0/);
  const ai = read("apps/mobile/src/aiView.tsx");
  assert.match(ai, /testID="ai-why"><AnalysisRow label="WHY"/);
});

test("HOME keeps the approved evidence-first scan order and authority footer", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const hero = home.indexOf('testID="account-hero-card"');
  const ai = home.indexOf('testID="home-ai-judgement"');
  const capital = home.indexOf('testID="home-capital-limits"');
  const learning = home.indexOf('testID="home-paper-learning"');
  const riskAuthority = home.indexOf('testID="home-risk-authority"');
  assert.ok([hero, ai, capital, learning, riskAuthority].every((index) => index >= 0));
  // The authority footer stays last: it is the claim the whole screen is bounded by.
  assert.ok(hero < ai && ai < capital && capital < learning && learning < riskAuthority);
  assert.doesNotMatch(home, /<TruthCell label="WHY"/);
  assert.match(home, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
});
