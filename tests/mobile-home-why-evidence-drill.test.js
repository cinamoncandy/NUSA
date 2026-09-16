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
  assert.match(home, /aiInsightAvailable \? <Pressable onPress=\{\(\) => onNavigate\("AiSignal"\)\}/);
  assert.match(home, /testID="ai-card"/);
  assert.match(home, /DECISION BASIS/);
  assert.match(home, /\{why\}/);
});

test("HOME keeps glanceable workspaces ahead of progressive AI judgment and risk detail", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const ai = home.indexOf('testID="ai-card"');
  const risk = home.indexOf('testID="home-risk-status"');
  const terrain = home.indexOf('testID="home-decision-stage"');
  const paperPerformance = home.indexOf('testID="home-paper-performance"');
  const learning = home.indexOf('testID="home-paper-learning"');
  assert.ok(ai >= 0 && risk >= 0 && terrain >= 0 && paperPerformance >= 0 && learning >= 0, "canonical Intelligence OS decision flow must exist");
  assert.ok(terrain < paperPerformance && paperPerformance < learning && learning < ai && ai < risk, "HOME scan order must remain observe → supervise → learn → decision basis → risk detail");
  assert.doesNotMatch(home, /<TruthCell label="WHY"/);
  assert.match(home, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
});
