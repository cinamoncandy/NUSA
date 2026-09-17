const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("HOME MASTER AI judgment drills into verified evidence without a dead control", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  assert.match(home, /aiThesis: ai\?\.status === "AVAILABLE" \? ai\.thesis : null/);
  assert.match(home, /aiEvidenceCount: ai\?\.status === "AVAILABLE" \? ai\.evidenceReferences\.length : 0/);
  assert.match(home, /aiInsightAvailable,/);
  assert.match(home, /onPress=\{aiInsightAvailable \? \(\) => onNavigate\("AiSignal"\) : undefined\}/);
  assert.match(home, /testID="ai-card"/);
  assert.match(home, /<TruthCell label="WHY"/);
  assert.match(home, /value=\{supervisorWhy\}/);
});

test("HOME MASTER scan order is AI terrain → evidence → market/PAPER → risk authority", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const ai = home.indexOf('testID="ai-card"');
  const why = home.indexOf('label="WHY"');
  const market = home.indexOf('testID="home-market-pulse"');
  const paper = home.indexOf('testID="home-paper-performance"');
  const risk = home.indexOf('testID="home-risk-authority"');
  assert.ok(ai >= 0 && why >= 0 && market >= 0 && paper >= 0 && risk >= 0);
  assert.ok(ai < why && why < market && market < paper && paper < risk);
  assert.match(home, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
});
