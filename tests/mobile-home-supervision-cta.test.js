const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const home = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "homeView.tsx"), "utf8");
const decisionSurface = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "homeDecisionSurface.ts"), "utf8");

test("HOME carries degraded PAPER connection truth into the canonical decision surface", () => {
  const ai = home.indexOf('testID="ai-card"');
  const terrain = home.indexOf('testID="home-decision-stage"');
  const why = home.indexOf('testID="home-supervisor-why"');
  const markets = home.indexOf('testID="home-market-pulse"');

  assert.ok(ai >= 0 && terrain >= 0 && why >= 0 && markets >= 0, "canonical HOME supervision flow must exist");
  assert.ok(ai < terrain && terrain < why && why < markets, "decision terrain and supervision truth must lead market exploration");
  assert.match(home, /buildHomeDecisionSurface\(\{/);
  assert.match(home, /disconnected,/);
  assert.match(home, /readOnlyError: readOnlyError != null/);
  assert.match(home, /case "SETTINGS": return onGoSettings\(\)/);
  assert.match(home, /testID="home-supervisor-primary-action"/);

  assert.match(decisionSurface, /const WATCH_RUNTIME_STATES = new Set\(\["DEGRADED", "STOPPED", "STOPPING"\]\)/);
  assert.match(decisionSurface, /runtimeNeedsSupervision\s*\n\s*\? "SUPERVISE PAPER"/);
});

test("connection and runtime failure truth wins over stale AI output", () => {
  const whyStart = decisionSurface.indexOf("const why = input.disconnected");
  const degradedIndex = decisionSurface.indexOf(': runtimeState === "DEGRADED"', whyStart);
  const aiInsightIndex = decisionSurface.indexOf(": aiInsightAvailable", whyStart);
  assert.notEqual(whyStart, -1);
  assert.notEqual(degradedIndex, -1);
  assert.notEqual(aiInsightIndex, -1);
  assert.ok(degradedIndex < aiInsightIndex, "runtime failure WHY must win before AI thesis in the safety model");
  assert.match(decisionSurface, /PAPER runtime 상태가 저하되어 감독자의 확인이 필요합니다/);
  assert.match(home, /testID="home-supervisor-now">\{decisionSurface\.now\}/);
  assert.match(home, /const supervisorWhy = decisionSurface\.why/);
  assert.match(home, /const supervisorResult = decisionSurface\.result/);
  assert.match(home, /const supervisorRisk = decisionSurface\.risk/);
  assert.match(home, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
});
