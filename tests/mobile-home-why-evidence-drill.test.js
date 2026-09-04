const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("HOME AI judgment drills into verified evidence without creating a dead control", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const surface = read("apps/mobile/src/homeDecisionSurface.ts");

  assert.match(home, /buildHomeDecisionSurface\(\{/);
  assert.match(home, /aiThesis: ai\?\.status === "AVAILABLE" \? ai\.thesis : null/);
  assert.match(home, /aiEvidenceCount: ai\?\.status === "AVAILABLE" \? ai\.evidenceReferences\.length : 0/);
  assert.match(home, /aiInsightAvailable,/);
  assert.match(home, /testID="ai-card"/);
  assert.match(home, /case "AI_SIGNAL": return onNavigate\("AiSignal"\)/);
  assert.match(surface, /const aiThesis = input\.aiThesis\?\.trim\(\) \?\? ""/);
  assert.match(surface, /const aiInsightAvailable = aiThesis\.length > 0 && input\.aiEvidenceCount > 0/);
});

test("HOME keeps verified AI judgment and WHY evidence ahead of market exploration", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const ai = home.indexOf('testID="ai-card"');
  const terrain = home.indexOf('testID="home-decision-stage"');
  const why = home.indexOf('testID="home-supervisor-why"');
  const metrics = home.indexOf('testID="home-market-pulse"');
  assert.ok(ai >= 0 && terrain >= 0 && why >= 0 && metrics >= 0, "canonical AI decision and WHY evidence flow must exist");
  assert.ok(ai < terrain && terrain < why && why < metrics, "HOME scan order must remain AI judgment → terrain → WHY evidence → major indicators");
  assert.match(home, /<TruthCell label="WHY"/);
  assert.match(home, /const supervisorWhy = decisionSurface\.why/);
  assert.match(home, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
});
