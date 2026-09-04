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
  const markets = home.indexOf('testID="home-market-pulse"');

  assert.ok(notice >= 0, "PAPER operational notice must exist");
  assert.ok(ai >= 0 && terrain >= 0 && markets >= 0, "canonical HOME decision flow must exist");
  assert.ok(notice < ai && ai < terrain && terrain < markets, "connection truth must lead the canonical exploration flow");
  assert.match(home, /"PAPER 연결 오류"/);
  assert.match(home, /"PAPER 연결 필요"/);
  assert.match(home, /onPress=\{onGoSettings\}/);
  assert.doesNotMatch(home, /testID="home-supervisor-primary-action"/);

  assert.match(decisionSurface, /const WATCH_RUNTIME_STATES = new Set\(\["DEGRADED", "STOPPED", "STOPPING"\]\)/);
  assert.match(decisionSurface, /runtimeNeedsSupervision\s*\n\s*\? "SUPERVISE PAPER"/);
});

test("HOME connection failure copy wins over stale AI output while fail-closed supervisor logic remains available", () => {
  assert.match(home, /const fallbackJudgement = notConfigured[\s\S]*\? "PAPER 연결이 필요합니다\."[\s\S]*: readOnlyError[\s\S]*\? "연결 상태를 확인하고 있습니다\."/);
  assert.match(home, /const judgement = aiInsightAvailable \? \(ai\?\.thesis \?\? fallbackJudgement\) : fallbackJudgement/);

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