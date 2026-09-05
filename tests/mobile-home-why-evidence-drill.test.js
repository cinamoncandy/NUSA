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
  assert.match(home, /const aiInsightAvailable = decisionSurface\.aiInsightAvailable && !disconnected && readOnlyError == null/);
  assert.match(home, /onPress=\{aiInsightAvailable \? \(\) => onNavigate\("AiSignal"\) : undefined\}/);
  assert.match(home, /testID="ai-card"/);
  assert.match(home, /const judgement = aiInsightAvailable \? \(ai\?\.thesis \?\? fallbackJudgement\) : fallbackJudgement/);
});

test("HOME keeps verified AI judgment ahead of terrain and major indicators", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const ai = home.indexOf('testID="ai-card"');
  const terrain = home.indexOf('testID="home-decision-stage"');
  const metrics = home.indexOf('testID="home-market-pulse"');
  assert.ok(ai >= 0 && terrain >= 0 && metrics >= 0, "canonical AI decision flow must exist");
  assert.ok(ai < terrain && terrain < metrics, "HOME scan order must remain AI judgment → terrain → major indicators");
  assert.doesNotMatch(home, /<TruthCell label="WHY"/);
  assert.match(home, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
});
