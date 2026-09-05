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
  assert.match(home, /actionLabel=\{aiInsightAvailable \? "근거 보기" : undefined\}/);
  assert.match(home, /onAction=\{aiInsightAvailable \? \(\) => onNavigate\("AiSignal"\) : undefined\}/);
  assert.match(home, /testID="ai-card"/);
  assert.match(home, /<Text style=\{\[styles\.primaryCopy, \{ color: theme\.colors\.text \}\]\}>\{why\}<\/Text>/);
});

test("HOME keeps verified AI judgment ahead of risk, terrain, PAPER result, and learning", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const ai = home.indexOf('testID="ai-card"');
  const risk = home.indexOf('testID="home-risk-status"');
  const terrain = home.indexOf('testID="home-decision-stage"');
  const paperPerformance = home.indexOf('testID="home-paper-performance"');
  const learning = home.indexOf('testID="home-paper-learning"');
  assert.ok(ai >= 0 && risk >= 0 && terrain >= 0 && paperPerformance >= 0 && learning >= 0, "canonical Intelligence OS decision flow must exist");
  assert.ok(ai < risk && risk < terrain && terrain < paperPerformance && paperPerformance < learning, "HOME scan order must remain WHY → risk → observation → PAPER result → learning");
  assert.doesNotMatch(home, /<TruthCell label="WHY"/);
  assert.match(home, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
});
