const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const home = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "homeView.tsx"), "utf8");
const decisionSurface = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "homeDecisionSurface.ts"), "utf8");

test("HOME surfaces degraded PAPER connection states before exploration without restoring legacy supervisor chrome", () => {
  const notice = home.indexOf('testID="home-operational-notice"');
  const ai = home.indexOf('testID="ai-card"');
  const terrain = home.indexOf('testID="home-decision-stage"');
  const paperPerformance = home.indexOf('testID="home-paper-performance"');
  const learning = home.indexOf('testID="home-paper-learning"');

  assert.ok(notice >= 0, "PAPER operational notice must exist");
  assert.ok(ai >= 0 && terrain >= 0 && paperPerformance >= 0 && learning >= 0, "canonical HOME intelligence flow must exist");
  assert.ok(notice < ai && ai < terrain && terrain < paperPerformance && paperPerformance < learning, "connection truth must lead the canonical intelligence flow");
  assert.match(home, /"PAPER 연결 오류"/);
  assert.match(home, /"PAPER 연결 필요"/);
  assert.match(home, /onPress=\{onGoSettings\}/);
  assert.doesNotMatch(home, /testID="home-supervisor-primary-action"/);

  assert.match(decisionSurface, /const WATCH_RUNTIME_STATES = new Set\(\["DEGRADED", "STOPPED", "STOPPING"\]\)/);
  assert.match(decisionSurface, /runtimeNeedsSupervision\s*\n\s*\? "SUPERVISE PAPER"/);
});

test("HOME connection failure copy wins over stale AI output while fail-closed supervisor logic remains available", () => {
  assert.match(home, /const disconnected = notConfigured != null/);
  assert.match(home, /const decisionSurface = buildHomeDecisionSurface\(\{[\s\S]*disconnected,[\s\S]*readOnlyError: readOnlyError != null/);
  assert.match(home, /const aiInsightAvailable = decisionSurface\.aiInsightAvailable && !disconnected && readOnlyError == null/);
  assert.match(home, /const posture = disconnected[\s\S]*\? "PAPER 서버 연결이 필요합니다\."[\s\S]*: readOnlyError[\s\S]*\? "PAPER 상태를 확인하고 있습니다\."/);
  assert.match(home, /const why = aiInsightAvailable \? decisionSurface\.why : disconnected \? "Cloud PAPER 상태가 연결되기 전에는 판단 근거를 확정하지 않습니다\." : decisionSurface\.why/);

  const whyStart = decisionSurface.indexOf("const why = input.disconnected");
  const degradedIndex = decisionSurface.indexOf(': runtimeState === "DEGRADED"', whyStart);
  const aiInsightIndex = decisionSurface.indexOf(": aiInsightAvailable", whyStart);
  assert.notEqual(whyStart, -1);
  assert.notEqual(degradedIndex, -1);
  assert.notEqual(aiInsightIndex, -1);
  assert.ok(degradedIndex < aiInsightIndex, "runtime failure WHY must win before AI thesis in the safety model");
  assert.match(decisionSurface, /PAPER runtime 상태가 저하되어 감독자의 확인이 필요합니다/);
  assert.match(home, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
});
