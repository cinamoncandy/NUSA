const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const home = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "homeView.tsx"), "utf8");
const decisionSurface = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "homeDecisionSurface.ts"), "utf8");

test("HOME surfaces degraded PAPER connection truth before market/PAPER exploration without restoring supervisor chrome", () => {
  const notice = home.indexOf('testID="home-operational-notice"');
  const runtime = home.indexOf('testID="home-status-rail"');
  const judgment = home.indexOf('testID="home-intelligence-reveal"');
  const validation = home.indexOf('testID="home-confidence-evidence-quality"');
  const market = home.indexOf('testID="home-market-canvas-reveal"');
  const paperPerformance = home.indexOf('testID="home-paper-performance"');
  const learning = home.indexOf('testID="home-paper-learning"');

  assert.ok(notice >= 0, "PAPER operational notice must exist");
  assert.ok(runtime >= 0 && judgment >= 0 && validation >= 0 && market >= 0 && paperPerformance >= 0 && learning >= 0, "canonical Runtime Canvas flow must exist");
  assert.ok(runtime < judgment && judgment < validation && validation < notice && notice < market && market < paperPerformance && paperPerformance < learning);
  assert.match(home, /Cloud PAPER 연결을 검증해야 합니다/);
  assert.match(home, /관측 오류로 현재 판단을 확정하지 않습니다/);
  assert.match(home, /onPress=\{onGoSettings\}/);
  assert.doesNotMatch(home, /testID="home-supervisor-primary-action"|testID="home-risk-status"|testID="home-decision-stage"/);

  assert.match(decisionSurface, /const WATCH_RUNTIME_STATES = new Set\(\["DEGRADED", "STOPPED", "STOPPING"\]\)/);
  assert.match(decisionSurface, /runtimeNeedsSupervision\s*\n\s*\? "SUPERVISE PAPER"/);
});

test("HOME connection failure copy wins over stale AI output while fail-closed decision logic remains reusable", () => {
  assert.match(home, /const disconnected = notConfigured != null/);
  assert.match(home, /if \(disconnected\) return "PAPER 연결이 없어 판단을 확정하지 않습니다\."/);
  assert.match(home, /if \(readOnlyError != null\) return "관측 오류로 현재 판단을 확정하지 않습니다\."/);
  assert.match(home, /const aiAvailable = !unavailable && ai\?\.status === "AVAILABLE"/);

  const whyStart = decisionSurface.indexOf("const why = input.disconnected");
  const degradedIndex = decisionSurface.indexOf(': runtimeState === "DEGRADED"', whyStart);
  const aiInsightIndex = decisionSurface.indexOf(": aiInsightAvailable", whyStart);
  assert.notEqual(whyStart, -1);
  assert.notEqual(degradedIndex, -1);
  assert.notEqual(aiInsightIndex, -1);
  assert.ok(degradedIndex < aiInsightIndex, "runtime failure WHY must win before AI thesis in the safety model");
  assert.match(decisionSurface, /PAPER runtime 상태가 저하되어 감독자의 확인이 필요합니다/);
  assert.match(home, /PAPER ONLY · LIVE NONE · MUTATION FALSE · AI ZERO AUTHORITY/);
});
